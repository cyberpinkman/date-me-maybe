# Operations data contract

The admin read model is available only behind the independent, verified admin session authorization in the HTTP adapter. The data service itself is private server code; it does not authorize browser callers. Every read uses a read-only, repeatable-read PostgreSQL transaction. SQL query values are parameterized. Pagination is performed by the database and ordered by timestamp plus ID; each page and its total share one snapshot.

## Queries

- `overview({days})`: `days` is `7`, `30`, or `90`, default `30`. Returns `timeZone`, `asOf`, inclusive local-date `period`, all-time `totals`, zero-filled `daily`, and creation-cohort `funnel`.
- `users({page,pageSize,search,hasInvitations})`: default page 1, page size 20; maximum page size 100. Search is a literal case-insensitive substring of email or name; `%`, `_`, and `\` do not become SQL wildcards. `hasInvitations` is the string `true` or `false` when present.
- `user(id)`: a bounded Better Auth text identifier, not necessarily a UUID. Returns `user`, `summary`, up to 50 most recently updated related invitation records, and `invitationsTotal`. Guest relationships must be explicitly bound; nickname/email similarity never links people.
- `invitations({page,pageSize,search,status,mode})`: search covers owner email and displayed sender/recipient nicknames. Status values: `waiting`, `host_review`, `guest_review`, `confirmed`, `details`, `cancelled`, `declined`. Mode values: `host`, `open`, legacy `fixed`, legacy `flexible`.

Unknown query keys, repeated/array values, control characters, invalid enumerations, unbounded search, and invalid pagination are rejected. Optional filters are omitted rather than sent as `all` or an empty string.

## Metric definitions

All daily dates use **Asia/Shanghai**, independently of the database/server timezone. The period includes today and the preceding N−1 local calendar dates. Daily data measures stored registrations and invitation creations; no page views, DAU, unique anonymous recipients, deliveries, or opens are inferred.

- `users`: current account rows, including the operator's account and any remaining test accounts. Records are not heuristically excluded.
- `invitations`: stored invitation records, whether or not they were actually shared externally.
- `respondedInvitations`: records whose persisted `responded` flag is true or whose complete proposal was ever confirmed. The latter makes old confirmed records consistent with the response funnel even if a legacy flag was absent/false.
- `confirmedInvitations`: **currently** confirmed under the same versioned consent and completeness rules as `InviteModel.status`. Changing a confirmed arrangement may move it to a review status, despite retaining its previous reservation.
- `waitingInvitations`, `hostReviewInvitations`, `guestReviewInvitations`, `detailsInvitations`, `cancelledInvitations`, `declinedInvitations`: mutually exclusive current model status counts. These plus `confirmedInvitations` sum to all invitations.
- `scheduledUsers`: users with a saved schedule record, including a deliberately empty schedule. This is the same boundary as `schedule.configured`.
- `upcomingBookings`: **distinct invitation IDs** with a booking reservation whose end is in the future. Includes a currently ongoing meeting and the retained old booking during rescheduling. A date bound to two accounts is counted once; private busy blocks are excluded.
- `boundGuests`: **distinct account IDs** that explicitly bound at least one received invitation. Anonymous visitors are not counted as identified users.
- `funnel`: invitations **created within the selected period** → those that have responded → those that have **ever** held a complete, mutually confirmed proposal. Ever-confirmed uses the current proposal and the preserved full proposal history, so later cancellation/rescheduling does not erase successful historical conversion. This is a creation cohort, not a count of actions performed during the period. Invitations still awaiting a reply can mature later.

User list counts concern invitations that user **initiated**, not invitations received. Detail `boundInvitations` counts explicit received-invitation bindings; `upcomingBookings` counts that user's ongoing/future booking reservations; `manualBusyBlocks` is only a count of ongoing/future private busy entries. Detail shows both initiated and explicitly bound invitations, with a `host`/`guest` role.

## Response projection and privacy

Users expose ID, name, email, verified state, registration time, initiated-invitation counts, and whether a schedule has been configured. Invitations expose ID, owner ID/name/email, displayed sender/recipient nicknames, mode, current status, responded flag, creation/update times, time policy, duration, and whether the recipient is bound. Detail additionally exposes the user's role.

The service never returns full invitation state, invitation text, preference hints, locations, exact meeting times, weekly/date availability windows, private busy labels, invitation histories, guest tokens/hashes/encrypted tokens, share URLs, auth sessions, OTPs, IPs, or OAuth credentials. Last-login timestamps are omitted because existing session records are not a durable login history.

The SQL status projection is deliberately checked against the shared model's status function across current and legacy states in the isolated PostgreSQL contract test. Any future change to model consent/completeness rules must update this read model and its contract together.
