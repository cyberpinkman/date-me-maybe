-- Operations uses the same verified user identity, but independent one-time
-- challenges and sessions. A front-site code cannot sign into the console.
CREATE TABLE admin_session (
  id text PRIMARY KEY,
  "expiresAt" timestamptz NOT NULL,
  token text NOT NULL UNIQUE,
  "createdAt" timestamptz NOT NULL,
  "updatedAt" timestamptz NOT NULL,
  "ipAddress" text,
  "userAgent" text,
  "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
);
CREATE INDEX admin_session_user_id_idx ON admin_session("userId");
CREATE TABLE admin_verification (
  id text PRIMARY KEY,
  identifier text NOT NULL,
  value text NOT NULL,
  "expiresAt" timestamptz NOT NULL,
  "createdAt" timestamptz NOT NULL,
  "updatedAt" timestamptz NOT NULL
);
CREATE INDEX admin_verification_identifier_idx ON admin_verification(identifier);
REVOKE ALL ON admin_session, admin_verification FROM PUBLIC;
