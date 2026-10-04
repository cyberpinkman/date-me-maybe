CREATE TABLE invitations (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  guest_token_hash text NOT NULL UNIQUE,
  guest_token_encrypted text NOT NULL,
  state jsonb NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((state->>'id')::uuid = id),
  CHECK ((state->>'version')::integer = version)
);
CREATE INDEX invitations_owner_updated_idx ON invitations(owner_id, updated_at DESC);

CREATE TABLE invitation_requests (
  invitation_id uuid NOT NULL REFERENCES invitations(id) ON DELETE CASCADE,
  actor text NOT NULL CHECK (actor IN ('host', 'guest')),
  request_id uuid NOT NULL,
  request_hash text NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (invitation_id, actor, request_id)
);

CREATE TABLE invitation_creations (
  owner_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  request_hash text NOT NULL,
  invitation_id uuid NOT NULL REFERENCES invitations(id) ON DELETE CASCADE,
  PRIMARY KEY (owner_id, request_id)
);

CREATE TABLE app_rate_limits (
  key_hash text PRIMARY KEY,
  window_start timestamptz NOT NULL,
  count integer NOT NULL
);

-- These tables are private application storage. No browser/PostgREST grants.
REVOKE ALL ON invitations, invitation_requests, invitation_creations, app_rate_limits FROM PUBLIC;
