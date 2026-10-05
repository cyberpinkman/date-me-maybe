# Personal scheduling · v0.5.0

The v0.5.0 release adds personal availability and per-account booking conflict protection.

## Product rules

- In guest-led invitations, the sender selects `timePolicy: free` or `schedule`. The latter uses the sender's current availability, not a snapshot taken when the link was created.
- Each invitation has an immutable `durationMinutes`, default 120; accepted values are 30–720 in half-hour steps. Existing records default to 120 minutes.
- Weekly hours can contain multiple intervals. Date-specific overrides replace a day's weekly hours, including an empty list for a day off. Adjacent intervals form one continuous window. Availability rolls over the next 30 local calendar dates, starting today.
- Scheduled invitations expose half-hour start choices only when the whole duration fits. Free-time and sender-led invitations still check known account reservations.
- Candidates do not reserve time. Final mutual agreement reserves the full interval for the sender and any explicitly linked guest account. Boundaries are half-open: a meeting ending at 20:00 can be followed by one starting at 20:00.
- Pending rescheduling retains the previous confirmed reservation. Confirmation atomically replaces it for every known participant; a failed change leaves the original reservation intact. Cancellation after response closes the invitation and releases its reservations.
- Updating availability does not cancel existing bookings. Keeping the exact already-booked interval is allowed when reconfirming a location change after an availability edit.
- Manual busy entries block bookings in every invitation mode. Timed entries allow 1–1440 minutes; `allDay: true` covers local midnight to the following local midnight, including 23/25-hour daylight-saving days.

## Anonymous recipients and privacy

Opening or responding to an invitation requires only the existing unguessable guest capability. Reading a link never silently binds a signed-in account. After responding, the recipient can explicitly select “加入我的日程” and sign in if needed.

The host cannot bind themselves as their own guest. A guest binding cannot be replaced by another account. Binding an already-confirmed date checks the new participant's conflicts before recording either the binding or reservation. Anonymous recipients' other invitations and off-platform calendars are outside this protection; external calendar synchronization is not part of this version.

Public availability contains only candidate date/time pairs, availability flags, timezone and duration. It does not expose other invitations, account identifiers, email addresses or private busy labels. Personal calendar routes require a verified session and derive the account ID from it.

## Shared invariant

`calendar_reservations` owns the per-account non-overlap invariant. The PostgreSQL exclusion constraint protects ordinary reservations, including simultaneous independent transactions. A trigger also checks historical conflict rows. Calendar mutations acquire account transaction locks in sorted order; invitation transitions first lock the scoped invitation row. Consent changes, reservation replacement and idempotency snapshots commit together.

`server/scheduling.mjs` is the shared boundary for creation, proposal validation, final confirmation, guest binding, manual busy intervals and cancellation. Display filtering alone is never authoritative. Both response submission and final confirmation recheck current availability. The frontend refreshes stale availability and lets the author of the candidate range offer new times.

Wall times are resolved in the invitation's explicit IANA timezone and stored as actual UTC instants. Nonexistent and ambiguous daylight-saving wall times are rejected. The calendar's timezone may differ from the invitation's timezone; comparisons use instants, not displayed clock strings.

## HTTP contract

| Route | Access | Result / input |
| --- | --- | --- |
| `GET /api/schedule` | Verified account | Own schedule, manual busy intervals, confirmed reservations and migration issues |
| `POST /api/schedule` | Verified account | `{schedule:{timeZone,weekly,overrides}}`; weekly keys 0–6, intervals `{start,end}` |
| `POST /api/schedule/busy` | Verified account | `{date,time,durationMinutes,label?,requestId?}` or `{date,allDay:true,label?,requestId?}` |
| `POST /api/schedule/busy/:id/remove` | Entry owner | `{}` |
| `GET /api/invitations/:id/availability` | Invitation owner | `{slots,candidateSlots,timeZone,durationMinutes}` |
| `GET /api/guest/:token/availability` | Guest capability | Same limited public availability |
| `POST /api/guest/:token/bind` | Verified account + guest capability | `{}`; repeated binding to the same account is safe |
| Existing invitation action routes | Existing role checks | New `{type:"cancel",version,requestId}` action, only after a response |

Busy creation requests from the frontend use an idempotency key. The ledger survives removal of the busy record, so retrying a lost response cannot recreate a deleted interval. Invitation action replay includes the original public booking metadata, even after a later change.

## Upgrade and deployment

Migration `002_scheduling.sql` requires PostgreSQL `btree_gist`. It backfills the latest confirmed proposal, including a previous confirmed history entry when rescheduling is pending. Older durations default to two hours. Existing overlaps remain visible and block further overlapping bookings; the migration does not silently discard or move either date. Unresolvable historical dates become actionable review items and conservatively block new commitments until corrected or cancelled.

Migration `003_calendar_writer.sql` blocks invitation inserts and updates from older application versions that do not maintain calendar reservations. The shared invitation transaction sets a transaction-local `v1` marker; it cannot leak through a pooled connection. This is a writer compatibility gate, not an identity or authorization boundary.

All pending application migrations commit in one transaction. Before backfill, an `EXCLUSIVE` invitations lock drains in-flight old writers while allowing ordinary reads. Backfill and the writer gate become visible together; a failed migration rolls the batch back. The production migration preflight refuses a partially upgraded 002-without-003 database, because its intervening old writes require reconciliation. During the short interval between a successful migration and promotion, the old deployment cannot mutate invitations.

Apply the migration before serving this frontend/backend pair. After migration, old application versions must not write invitations: they do not maintain calendar reservations. Deployment acceptance must verify the new code and migration together; rolling back only the application is not a safe scheduling rollback.

## Verification

`npm test` covers model/validation, wall-time conversion, client identity reset, explicit binding intent and frontend flows. `npm run test:integration` serially runs the existing HTTP suite and a real PostgreSQL scheduling suite against the explicitly guarded isolated local test database. Scheduling and migration-cutover cases use a unique schema, which is removed after the suite; account-backed HTTP cases create and clean up unique test users.

The shared boundary tests cover raw SQL concurrent overlaps, independent invitations, weekly/date rules, duration, manual busy retries, stale candidates, account binding across roles, failed/successful rescheduling, cancellation, legacy migration and daylight-saving transitions. HTTP tests verify route authorization, anonymous access, public data minimization and atomic consent/booking behavior.
