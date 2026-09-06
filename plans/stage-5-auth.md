# Stage 5: Auth extras

**Goal**

Passkey (WebAuthn) login and Google OAuth, both configured entirely from the admin UI. Email+password stays as the fallback.

**Decisions**

- Passkeys first, they need zero third-party config. Hand-rolled WebAuthn: registration and assertion verification with node:crypto (ES256 and RS256 only, packed/none attestation ignored, we authenticate, we do not attest). Challenge kept in the session row. `credentials` table in core.db: user_id, credential_id, public_key, counter, transports.
- Passkey UI: "Add a passkey" on a new account page for the admin user; login page shows a "Use passkey" button when credentials exist (conditional mediation where available).
- Google OAuth: client id and secret entered in global settings (encrypted), enabling the "Continue with Google" button only when both are set. Standard code flow with PKCE, no googleapis dependency, plain fetch to token and userinfo endpoints. Only the existing admin's email may log in v1 (single admin rule holds); anyone else gets a clear error.
- Secure cookie flag + trust-proxy setting land here (carried from stage 1 note): `TRUST_PROXY=1` env or global setting makes cookies `Secure` and honors `x-forwarded-proto`.
- Sessions unchanged; both flows end in the same signed session cookie.

**Checklist**

- [ ] migrations/002_credentials.sql (core.db) + account page (change password, list/add/remove passkeys).
- [ ] WebAuthn registration: options endpoint, client JS (native browser API, no lib), verify + store.
- [ ] WebAuthn login: assertion options, verify signature and counter, session issue.
- [ ] Google OAuth code flow with PKCE, gated on settings presence, email must match the admin.
- [ ] Secure cookie / trust-proxy handling.
- [ ] Smoke: password unchanged paths still green; WebAuthn verify functions unit-checked with fixture vectors (full browser flow is manual).
- [ ] pnpm css rebuild, README auth section.

**Verification**

- pnpm smoke green.
- Manual: register a passkey and log in with it; configure Google OAuth and log in; wrong Google account rejected.
