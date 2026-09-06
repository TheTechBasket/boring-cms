-- WebAuthn passkeys for the admin user. public_key stored as JWK JSON.

CREATE TABLE credentials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Passkey',
  credential_id TEXT NOT NULL UNIQUE,   -- base64url
  public_key TEXT NOT NULL,             -- JWK JSON (EC P-256 or RSA)
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
