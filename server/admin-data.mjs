import { ApiError } from './errors.mjs';

// This read model never returns invitation payloads, share capabilities, auth
// records, private notes, or availability windows. Status follows Model.status;
// the integration contract compares every branch with that owning boundary.
const statuses = ['waiting', 'host_review', 'guest_review', 'confirmed', 'details', 'cancelled', 'declined'];
const modes = ['open', 'host', 'fixed', 'flexible'];
const invalid = () => new ApiError(422, 'INVALID_ADMIN_QUERY', '请检查查询条件。');
function queryFields(query, allowed) {
  if (!query || typeof query !== 'object' || Array.isArray(query) ||
      Object.keys(query).some(key => !allowed.includes(key)) ||
      Object.values(query).some(value => typeof value !== 'string')) throw invalid();
}
function integer(value, fallback, max) {
  if (value === undefined) return fallback;
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > max) throw invalid();
  return Number(value);
}
function pageQuery(query, extras = []) {
  queryFields(query, ['page', 'pageSize', 'search', ...extras]);
  const page = integer(query.page, 1, 100_000), pageSize = integer(query.pageSize, 20, 100);
  const search = (query.search ?? '').trim();
  if (search.length > 200 || /[\u0000-\u001f\u007f]/.test(search)) throw invalid();
  // LIKE wildcard characters are ordinary text in the search box.
  return { page, pageSize, search: `%${search.replace(/[\\%_]/g, '\\$&')}%`, offset: (page - 1) * pageSize };
}
const iso = value => new Date(value).toISOString();
const number = value => Number(value ?? 0);
const has = (proposal, key) => `(${proposal} ? '${key}')`;
const full = proposal => `(${has(proposal, 'timeOptions')} OR ${has(proposal, 'placeOptions')})`;
function complete(proposal) {
  const p = proposal;
  const text = key => `(jsonb_typeof(${p}->'${key}')='string' AND btrim(${p}->>'${key}')<>'')`;
  return `(${['date', 'time', 'place'].map(text).join(' AND ')} AND
    (NOT ${has(p, 'activities')} OR (
      ${text('activity')} AND jsonb_typeof(${p}->'activities')='array' AND
      (${p}->'activities') @> jsonb_build_array(${p}->>'activity') AND
      (NOT ${full(p)} OR (
        jsonb_typeof(${p}->'timeOptions')='array' AND
        (${p}->'timeOptions') @> jsonb_build_array(jsonb_build_object('date',${p}->>'date','time',${p}->>'time')) AND
        jsonb_typeof(${p}->'placeOptions')='array' AND (${p}->'placeOptions') @> jsonb_build_array(${p}->>'place') AND
        jsonb_typeof(${p}->'preferences'->'details'->(${p}->>'activity'))='array' AND
        CASE WHEN ${p}->'preferences'->'details'->(${p}->>'activity')='[]'::jsonb
          THEN ${p}->'preferences'->>'detail'=''
          ELSE (${p}->'preferences'->'details'->(${p}->>'activity')) @> jsonb_build_array(${p}->'preferences'->>'detail') END
      ))
    )))`;
}
function approved(state) {
  // JSON equality preserves the model's strict numeric version comparison.
  return `(${state}->'approvals'->'host'=${state}->'version' AND ${state}->'approvals'->'guest'=${state}->'version')`;
}
function status(state) {
  const p = `(${state}->'proposal')`, host = `${state}->'approvals'->'host'=${state}->'version'`;
  return `CASE
    WHEN COALESCE(${state}->>'closed','false') NOT IN ('false','') THEN CASE WHEN ${state}->>'closed'='cancelled' THEN 'cancelled' ELSE 'declined' END
    WHEN ${p} IS NULL OR ${p}='null'::jsonb THEN 'waiting'
    WHEN ${full(p)} THEN CASE
      WHEN ${state}->>'mode'='host' AND COALESCE(${state}->>'responded','false')<>'true' THEN 'waiting'
      WHEN ${approved(state)} AND ${complete(p)} THEN 'confirmed'
      WHEN ${host} THEN 'guest_review' ELSE 'host_review' END
    WHEN ${has(p, 'activities')} AND COALESCE(${p}->>'activity','')='' THEN 'host_review'
    WHEN ${approved(state)} THEN CASE WHEN ${complete(p)} THEN 'confirmed' ELSE 'details' END
    WHEN ${state}->>'responded'='true' THEN CASE WHEN ${host} THEN 'guest_review' ELSE 'host_review' END
    ELSE 'waiting' END`;
}
const summary = `WITH invitation_summary AS (
  SELECT i.id,i.owner_id,i.created_at,i.updated_at,
    i.state->>'from' AS sender,i.state->>'to' AS recipient,
    COALESCE(i.state->>'mode','open') AS mode,
    COALESCE(i.state->>'timePolicy','free') AS time_policy,
    COALESCE((i.state->>'durationMinutes')::integer,120) AS duration_minutes,
    ${status('i.state')} AS status,
    COALESCE(i.state->>'responded','false')='true' AS responded,
    (${approved('i.state')} AND ${complete("(i.state->'proposal')")} OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(i.state->'history')='array' THEN i.state->'history' ELSE '[]'::jsonb END) h
      WHERE ${approved('h')} AND ${complete("(h->'proposal')")}
    )) IS TRUE AS ever_confirmed,
    EXISTS(SELECT 1 FROM invitation_guest_accounts g WHERE g.invitation_id=i.id) AS guest_bound
  FROM invitations i
)`;
const userCounts = `SELECT owner_id,count(*) AS invitations,
  count(*) FILTER(WHERE responded OR ever_confirmed) AS responded_invitations,
  count(*) FILTER(WHERE status='confirmed') AS confirmed_invitations
  FROM invitation_summary GROUP BY owner_id`;
const userColumns = `u.id,u.name,u.email,u."emailVerified",u."createdAt",
  COALESCE(c.invitations,0) AS invitations,COALESCE(c.responded_invitations,0) AS responded_invitations,
  COALESCE(c.confirmed_invitations,0) AS confirmed_invitations,
  EXISTS(SELECT 1 FROM user_schedules s WHERE s.user_id=u.id) AS schedule_configured`;
function userRow(row) {
  return { id: row.id, name: row.name, email: row.email, emailVerified: row.emailVerified,
    joinedAt: iso(row.createdAt), invitations: number(row.invitations), respondedInvitations: number(row.responded_invitations),
    confirmedInvitations: number(row.confirmed_invitations), scheduleConfigured: row.schedule_configured };
}
function invitationRow(row) {
  return { id: row.id, owner: { id: row.owner_id, name: row.owner_name, email: row.owner_email },
    from: row.sender ?? '', to: row.recipient ?? '', mode: row.mode, status: row.status,
    responded: row.responded || row.ever_confirmed, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
    timePolicy: row.time_policy, durationMinutes: row.duration_minutes, guestBound: row.guest_bound,
    ...(row.role ? { role: row.role } : {}) };
}

export function createAdminDataService({ pool, now = () => new Date() }) {
  async function snapshot(run) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const result = await run(client);
      await client.query('COMMIT');
      return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  return {
    async overview(query = {}) {
      queryFields(query, ['days']);
      const days = integer(query.days, 30, 90);
      if (![7, 30, 90].includes(days)) throw invalid();
      const asOf = iso(now()), to = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(asOf));
      const from = new Date(Date.parse(`${to}T00:00:00Z`) - (days - 1) * 86_400_000).toISOString().slice(0, 10);
      return snapshot(async client => {
        const totalsRow = (await client.query(`${summary} SELECT
          (SELECT count(*) FROM "user") AS users,count(*) AS invitations,
          count(*) FILTER(WHERE responded OR ever_confirmed) AS responded_invitations,
          count(*) FILTER(WHERE status='confirmed') AS confirmed_invitations,
          count(*) FILTER(WHERE status='cancelled') AS cancelled_invitations,
          count(*) FILTER(WHERE status='waiting') AS waiting_invitations,
          count(*) FILTER(WHERE status='host_review') AS host_review_invitations,
          count(*) FILTER(WHERE status='guest_review') AS guest_review_invitations,
          count(*) FILTER(WHERE status='details') AS details_invitations,
          count(*) FILTER(WHERE status='declined') AS declined_invitations,
          (SELECT count(*) FROM user_schedules) AS scheduled_users,
          (SELECT count(DISTINCT invitation_id) FROM calendar_reservations WHERE kind='booking' AND ends_at>$1::timestamptz) AS upcoming_bookings,
          (SELECT count(DISTINCT user_id) FROM invitation_guest_accounts) AS bound_guests
          FROM invitation_summary`, [asOf])).rows[0];
        const totals = Object.fromEntries(Object.entries(totalsRow).map(([key, value]) => [key.replace(/_([a-z])/g, (_, c) => c.toUpperCase()), number(value)]));
        const daily = (await client.query(`WITH dates AS (
          SELECT generate_series($1::date,$2::date,interval '1 day')::date AS date
        ), registrations AS (
          SELECT ("createdAt" AT TIME ZONE 'Asia/Shanghai')::date AS date,count(*) AS n FROM "user"
          WHERE "createdAt">=($1::date::timestamp AT TIME ZONE 'Asia/Shanghai') AND "createdAt"<(($2::date+1)::timestamp AT TIME ZONE 'Asia/Shanghai') GROUP BY 1
        ), created AS (
          SELECT (created_at AT TIME ZONE 'Asia/Shanghai')::date AS date,count(*) AS n FROM invitations
          WHERE created_at>=($1::date::timestamp AT TIME ZONE 'Asia/Shanghai') AND created_at<(($2::date+1)::timestamp AT TIME ZONE 'Asia/Shanghai') GROUP BY 1
        ) SELECT to_char(d.date,'YYYY-MM-DD') AS date,COALESCE(r.n,0) AS registrations,COALESCE(c.n,0) AS invitations
        FROM dates d LEFT JOIN registrations r USING(date) LEFT JOIN created c USING(date) ORDER BY d.date`, [from, to])).rows
          .map(row => ({ date: row.date, registrations: number(row.registrations), invitations: number(row.invitations) }));
        const cohort = (await client.query(`${summary} SELECT count(*) AS invitations,
          count(*) FILTER(WHERE responded OR ever_confirmed) AS responded,
          count(*) FILTER(WHERE ever_confirmed) AS ever_confirmed FROM invitation_summary
          WHERE created_at>=($1::date::timestamp AT TIME ZONE 'Asia/Shanghai') AND created_at<(($2::date+1)::timestamp AT TIME ZONE 'Asia/Shanghai')`, [from, to])).rows[0];
        return { timeZone: 'Asia/Shanghai', asOf, period: { days, from, to }, totals, daily,
          funnel: { invitations: number(cohort.invitations), responded: number(cohort.responded), everConfirmed: number(cohort.ever_confirmed) } };
      });
    },
    async users(query = {}) {
      const { page, pageSize, search, offset } = pageQuery(query, ['hasInvitations']);
      if (query.hasInvitations !== undefined && !['true', 'false'].includes(query.hasInvitations)) throw invalid();
      const where = `(u.email ILIKE $1 ESCAPE '\\' OR u.name ILIKE $1 ESCAPE '\\') AND
        ($2::boolean IS NULL OR EXISTS(SELECT 1 FROM invitations i WHERE i.owner_id=u.id)=$2)`;
      const params = [search, query.hasInvitations === undefined ? null : query.hasInvitations === 'true'];
      return snapshot(async client => {
        const total = number((await client.query(`SELECT count(*) AS n FROM "user" u WHERE ${where}`, params)).rows[0].n);
        const rows = (await client.query(`${summary}, user_counts AS (${userCounts})
          SELECT ${userColumns} FROM "user" u LEFT JOIN user_counts c ON c.owner_id=u.id
          WHERE ${where} ORDER BY u."createdAt" DESC,u.id DESC LIMIT $3 OFFSET $4`, [...params, pageSize, offset])).rows;
        return { items: rows.map(userRow), page, pageSize, total };
      });
    },
    async user(id) {
      if (typeof id !== 'string' || !id.length || id.length > 128 || /[\u0000-\u001f\u007f]/.test(id)) throw invalid();
      return snapshot(async client => {
        const selected = await client.query(`${summary}, user_counts AS (${userCounts})
          SELECT ${userColumns} FROM "user" u LEFT JOIN user_counts c ON c.owner_id=u.id WHERE u.id=$1`, [id]);
        if (!selected.rowCount) throw new ApiError(404, 'ADMIN_USER_NOT_FOUND', '没有找到这个用户。');
        const counts = (await client.query(`SELECT
          (SELECT count(*) FROM invitation_guest_accounts WHERE user_id=$1) AS bound_invitations,
          (SELECT count(*) FROM calendar_reservations WHERE user_id=$1 AND kind='booking' AND ends_at>$2::timestamptz) AS upcoming_bookings,
          (SELECT count(*) FROM calendar_reservations WHERE user_id=$1 AND kind='busy' AND ends_at>$2::timestamptz) AS manual_busy_blocks,
          (SELECT count(*) FROM invitations i WHERE owner_id=$1 OR EXISTS(SELECT 1 FROM invitation_guest_accounts g WHERE g.invitation_id=i.id AND g.user_id=$1)) AS invitations_total`, [id, iso(now())])).rows[0];
        const rows = (await client.query(`${summary} SELECT s.*,u.name AS owner_name,u.email AS owner_email,
          CASE WHEN s.owner_id=$1 THEN 'host' ELSE 'guest' END AS role FROM invitation_summary s JOIN "user" u ON u.id=s.owner_id
          WHERE s.owner_id=$1 OR EXISTS(SELECT 1 FROM invitation_guest_accounts g WHERE g.invitation_id=s.id AND g.user_id=$1)
          ORDER BY s.updated_at DESC,s.id DESC LIMIT 50`, [id])).rows;
        return { user: userRow(selected.rows[0]), summary: { boundInvitations: number(counts.bound_invitations), upcomingBookings: number(counts.upcoming_bookings), manualBusyBlocks: number(counts.manual_busy_blocks) },
          invitations: rows.map(invitationRow), invitationsTotal: number(counts.invitations_total) };
      });
    },
    async invitations(query = {}) {
      const { page, pageSize, search, offset } = pageQuery(query, ['status', 'mode']);
      if (query.status !== undefined && !statuses.includes(query.status) || query.mode !== undefined && !modes.includes(query.mode)) throw invalid();
      const where = `(u.email ILIKE $1 ESCAPE '\\' OR s.sender ILIKE $1 ESCAPE '\\' OR s.recipient ILIKE $1 ESCAPE '\\')
        AND ($2::text IS NULL OR s.status=$2) AND ($3::text IS NULL OR s.mode=$3)`;
      const params = [search, query.status ?? null, query.mode ?? null];
      return snapshot(async client => {
        const total = number((await client.query(`${summary} SELECT count(*) AS n FROM invitation_summary s JOIN "user" u ON u.id=s.owner_id WHERE ${where}`, params)).rows[0].n);
        const rows = (await client.query(`${summary} SELECT s.*,u.name AS owner_name,u.email AS owner_email
          FROM invitation_summary s JOIN "user" u ON u.id=s.owner_id WHERE ${where}
          ORDER BY s.created_at DESC,s.id DESC LIMIT $4 OFFSET $5`, [...params, pageSize, offset])).rows;
        return { items: rows.map(invitationRow), page, pageSize, total };
      });
    },
  };
}
