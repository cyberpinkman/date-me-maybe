import { randomUUID } from 'node:crypto';
import Model from '../src/model.js';
import { ApiError, notFound } from './errors.mjs';
import { digest, fingerprint, createGuestToken, encryptToken, decryptToken, isGuestToken } from './crypto.mjs';
import { fields, isUuid, requestId, validateDraft, validateEvent, validateProposal } from './validation.mjs';
import { createSchedulingService } from './scheduling.mjs';

const modelErrorStatus = Object.freeze({
  INVALID_INPUT: 422, INVALID_ROLE: 422, STALE_VERSION: 409,
  INVITATION_CLOSED: 410, MISSING_PROPOSAL: 422, ALREADY_RESPONDED: 409,
  ACTIVITY_SELECTION_REQUIRED: 422, INVALID_ACTIVITY_SELECTION: 422,
  FINALIZATION_NOT_ALLOWED: 409,
  CANCELLATION_NOT_ALLOWED: 409,
});
function modelResult(run) {
  try { return run(); }
  catch (error) {
    if (error instanceof Model.RuleError && Object.hasOwn(modelErrorStatus, error.code)) {
      throw new ApiError(modelErrorStatus[error.code], error.code, error.message);
    }
    throw error;
  }
}

export function createInvitationService({ pool, config }) {
  const scheduling = createSchedulingService({ pool });
  const serialize = (row, owner = false, state = row.state) => {
    const result = { ...state, createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString() };
    if (owner) result.shareUrl = `${config.origin}/i/${decryptToken(row.guest_token_encrypted, config.shareSecret)}`;
    return result;
  };
  async function present(client, row, owner = false) {
    return serialize(row, owner, { ...row.state, ...await scheduling.getBinding(client, row) });
  }
  async function transaction(run) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Transaction-local: pooled sessions must never grant this capability to
      // an older deployment that does not synchronize calendar reservations.
      await client.query("SELECT set_config('opendater.calendar_writer','v1',true)");
      const result = await run(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }
  function where(access) {
    if (access.ownerId && isUuid(access.id)) return { clause: 'id=$1 AND owner_id=$2', params: [access.id, access.ownerId], role: 'host' };
    if (isGuestToken(access.token)) return { clause: 'guest_token_hash=$1', params: [digest(access.token)], role: 'guest' };
    throw notFound();
  }
  async function read(access) {
    const { clause, params, role } = where(access);
    const result = await pool.query(`SELECT * FROM invitations WHERE ${clause}`, params);
    if (!result.rowCount) throw notFound();
    return present(pool, result.rows[0], role === 'host');
  }
  async function create(ownerId, input) {
    fields(input, ['draft', 'requestId']);
    const key = requestId(input.requestId), draft = validateDraft(input.draft), hash = fingerprint(draft);
    return transaction(async client => {
      // The same creation retry may arrive in another Vercel worker.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`create:${ownerId}:${key}`]);
      const previous = await client.query('SELECT * FROM invitation_creations WHERE owner_id=$1 AND request_id=$2', [ownerId, key]);
      if (previous.rowCount) {
        if (previous.rows[0].request_hash !== hash) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', '这份邀请已经有变化，刷新页面后再试一次吧。');
        const stored = await client.query('SELECT * FROM invitations WHERE id=$1 AND owner_id=$2', [previous.rows[0].invitation_id, ownerId]);
        return present(client, stored.rows[0], true);
      }
      const id = randomUUID(), token = createGuestToken(), state = modelResult(() => Model.create({ ...draft, id }));
      const inserted = await client.query('INSERT INTO invitations(id,owner_id,guest_token_hash,guest_token_encrypted,state,version) VALUES($1,$2,$3,$4,$5,1) RETURNING *', [id, ownerId, digest(token), encryptToken(token, config.shareSecret), state]);
      await scheduling.assertProposal(client, inserted.rows[0], state, { type: 'create', proposal: draft.plan });
      await client.query('INSERT INTO invitation_creations(owner_id,request_id,request_hash,invitation_id) VALUES($1,$2,$3,$4)', [ownerId, key, hash, id]);
      return present(client, inserted.rows[0], true);
    });
  }
  async function transition(access, input) {
    const { clause, params, role } = where(access);
    const event = validateEvent(input, role), hash = fingerprint(event);
    return transaction(async client => {
      // Ownership/token lookup and locking share one boundary; no unscoped fetch by id.
      const selected = await client.query(`SELECT * FROM invitations WHERE ${clause} FOR UPDATE`, params);
      if (!selected.rowCount) throw notFound();
      const row = selected.rows[0];
      const previous = await client.query('SELECT * FROM invitation_requests WHERE invitation_id=$1 AND actor=$2 AND request_id=$3', [row.id, role, event.requestId]);
      if (previous.rowCount) {
        if (previous.rows[0].request_hash !== hash) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', '这份安排已经有变化，刷新页面后再试一次吧。');
        // Both UPDATE.updated_at and journal.created_at use PostgreSQL now()
        // in the same transaction. Replay that immutable response timestamp,
        // even if another action has since advanced the invitation row.
        return serialize({ ...row, updated_at: previous.rows[0].created_at }, role === 'host', previous.rows[0].response);
      }
      if (row.version !== event.version) throw new ApiError(409, 'STALE_VERSION', '安排已经更新，请查看最新安排后再确认。');
      if (row.state.closed) throw new ApiError(410, 'INVITATION_CLOSED', '这份邀请已经结束。');
      if (event.type === 'respond' && row.state.responded) throw new ApiError(409, 'ALREADY_RESPONDED', '这份邀请已经回应，请查看最新安排。');
      if (event.type === 'confirm' && !row.state.proposal) throw new ApiError(422, 'MISSING_PROPOSAL', '请先选一个时间。');
      const next = modelResult(() => Model.transition(row.state, { ...event, role }));
      // Validate the exact canonical proposal that will be persisted, after the
      // model enforces role/range rules and before either database write. A
      // confirmation also commits consent to its selected future schedule.
      if (event.type !== 'cancel') {
        validateProposal(next.proposal, row.state.timeZone || 'Asia/Shanghai', event.proposal ?? {});
        await scheduling.assertProposal(client, row, next, event);
      }
      // Invitation consent and every participant's reservation share a commit.
      // A pending revision retains its last confirmed reservation until replaced.
      await scheduling.syncConfirmed(client, row, next);
      const updated = await client.query('UPDATE invitations SET state=$1,version=$2,updated_at=now() WHERE id=$3 RETURNING *', [next, next.version, row.id]);
      const response = { ...next, ...await scheduling.getBinding(client, updated.rows[0]) };
      await client.query('INSERT INTO invitation_requests(invitation_id,actor,request_id,request_hash,response) VALUES($1,$2,$3,$4,$5)', [row.id, role, event.requestId, hash, response]);
      return serialize(updated.rows[0], role === 'host', response);
    });
  }
  return {
    create, read, transition, scheduling,
    async availability(access) {
      const { clause, params } = where(access);
      const selected = await pool.query(`SELECT * FROM invitations WHERE ${clause}`, params);
      if (!selected.rowCount) throw notFound();
      return scheduling.availability(selected.rows[0]);
    },
    async bindGuest(token, userId, input) {
      fields(input, []);
      const { clause, params } = where({ token });
      return transaction(async client => {
        const selected = await client.query(`SELECT * FROM invitations WHERE ${clause} FOR UPDATE`, params);
        if (!selected.rowCount) throw notFound();
        const row = selected.rows[0];
        await scheduling.bindGuest(client, row, userId);
        return present(client, row);
      });
    },
    async calendar(userId) {
      const [schedule, calendar] = await Promise.all([scheduling.getSchedule(userId), scheduling.listCalendar(userId)]);
      const ids = calendar.bookings.filter(item => item.role === 'guest').map(item => item.invitationId);
      if (ids.length) {
        const links = await pool.query('SELECT id,guest_token_encrypted FROM invitations WHERE id=ANY($1::uuid[])', [ids]);
        const urls = new Map(links.rows.map(row => [row.id, `${config.origin}/i/${decryptToken(row.guest_token_encrypted, config.shareSecret)}`]));
        calendar.bookings = calendar.bookings.map(item => item.role === 'guest' ? { ...item, guestUrl: urls.get(item.invitationId) } : item);
      }
      return { schedule, ...calendar };
    },
    async list(ownerId) {
      const result = await pool.query('SELECT * FROM invitations WHERE owner_id=$1 ORDER BY updated_at DESC,id DESC', [ownerId]);
      return Promise.all(result.rows.map(row => present(pool, row, true)));
    },
  };
}
