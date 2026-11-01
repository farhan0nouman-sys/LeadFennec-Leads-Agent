# Auth API contract

Task 04A. The machine-readable contract is `packages/shared/src/contracts/auth.ts`
(`@lead-fennec-ai/shared`): routes, zod schemas for every request and response, and the error
codes. The API validates against it, its tests parse every response with it, and the web app
will use the same schemas. Decisions and sources: `docs/decisions.md` D-04A-*.

## Conventions

- **JSON in, JSON out.** Every auth response has `Cache-Control: no-store`.
- **Same-origin access only.** The web app serves the API on its own origin (for example
  under `/api`, through the web server), so the session cookie is first-party.
  State-changing requests from any other origin are refused (`forbidden_origin`).
- **Errors** share one envelope:

  ```json
  { "error": { "code": "invalid_credentials", "message": "Email or password is incorrect." } }
  ```

  - `retryAfterSeconds` is added on `429`, together with a `Retry-After` header.
  - `issues` (`[{ path, message }]`) is added on `validation_failed`. It never repeats the
    input.
- **Passwords:**
  - at least 15 and at most 128 Unicode code points, counted after NFKC normalization;
  - any characters, including spaces and emoji;
  - no composition rules.

  Sign-in accepts any non-empty password up to the cap.

## Session cookie and CSRF

| Item | Value |
|---|---|
| Cookie | `__Host-lf_session`: `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, no `Domain`, no `Max-Age` (ends with the browser session) |
| Cookie value | A random 256-bit token. The server stores only its SHA-256. |
| Idle timeout | 30 minutes without a request (server-side) |
| Absolute timeout | 8 hours after sign-in, whatever the activity |
| CSRF | Authenticated mutations (logout today) need the `x-csrf-token` header. Its value is `csrfToken` from the login response or `GET /auth/session`. It stays the same for the whole session and changes at every sign-in. |
| Origin check | Every `POST` is refused when `Sec-Fetch-Site` is anything but `same-origin`/`none`, or when `Origin` is not the web app's origin (`WEB_APP_URL`). Clients that send neither header (curl, server-to-server) can't carry a victim's cookies and are allowed. |

**Client rules:**
- Never log `csrfToken`.
- Emailed links carry their token in the URL fragment (`#token=…`), which browsers never send to
  a server. Read it, remove it from the address bar (`history.replaceState`), then `POST` it.

## Routes

| Method and path | Body | Success | Errors |
|---|---|---|---|
| `POST /auth/register` | `{ email, password, displayName? }` | `202 { status: "accepted" }` | `400 validation_failed`, `403 forbidden_origin`, `429` |
| `POST /auth/verify-email` | `{ token }` | `200 { status: "verified" }` | `400 invalid_or_expired_token`, `400 validation_failed`, `403`, `429` |
| `POST /auth/verify-email/resend` | `{ email }` | `202 { status: "accepted" }` | `400`, `403`, `429` |
| `POST /auth/login` | `{ email, password }` | `200` session (below) and the cookie | `401 invalid_credentials`, `403 email_not_verified`, `429 too_many_requests`, `400`, `403 forbidden_origin` |
| `POST /auth/logout` | none; `x-csrf-token` header | `204`, cookie deleted | `401 unauthenticated` / `session_expired`, `403 csrf_failed`, `403 forbidden_origin` |
| `GET /auth/session` | none | `200` session (below) | `401 unauthenticated` / `session_expired` (cookie deleted) |
| `POST /auth/password-reset/request` | `{ email }` | `202 { status: "accepted" }` | `400`, `403`, `429` |
| `POST /auth/password-reset/confirm` | `{ token, newPassword }` | `200 { status: "password_reset" }` | `400 invalid_or_expired_token`, `400 validation_failed`, `403`, `429` |

**Session response:**

```json
{
  "user": { "id": "…", "email": "…", "displayName": null, "emailVerified": true },
  "session": { "idleExpiresAt": "2026-11-02T09:30:00.000Z", "absoluteExpiresAt": "2026-11-02T17:00:00.000Z" },
  "csrfToken": "…43 base64url characters…"
}
```

The session token itself is only ever in the `Set-Cookie` header.

## Behaviour that hides whether an account exists

| Request | Address unknown | Address known |
|---|---|---|
| Register | `202`; a new account and a verification email | `202`. Verified: an "already registered" email with no link token. Not verified: earlier links stop working and a "finish setup" link lets the inbox owner choose the password. |
| Resend verification | `202`, nothing sent | `202`; a new link if the account is not verified |
| Password reset request | `202`, nothing sent | `202`; a reset link |
| Sign-in | `401 invalid_credentials` after a full password check against a dummy hash | `401 invalid_credentials` for a wrong password or a disabled user. `403 email_not_verified` only with the right password. |

**Timing:**
- For register, resend and reset requests, the account-dependent work runs after the response
  is sent.
- Sign-in always runs one Argon2id verification.

## Links and limits

| Item | Value |
|---|---|
| Verification link | `<WEB_APP_URL>/verify-email#token=…`, single use, 24 hours |
| Reset and finish-setup link | `<WEB_APP_URL>/reset-password#token=…`, single use, 30 minutes |
| Issuing a new link | Revokes the previous unused one for the same purpose |
| A successful reset | Sets the password, verifies the address, ends every session, emails a notice and lifts a sign-in lock. The user then signs in. |
| Sign-in failures | 5 per address in 15 minutes, then the address is locked for 15 minutes (`429`), for existing and unknown addresses alike |
| Account emails | At most 3 verification or "already registered" emails, and 3 reset emails, per address and hour. Further requests still answer `202`. |
| Per client IP | At most 20 requests per minute to each auth `POST` route (`429`). `GET /auth/session` is not limited. Behind proxies, the client address depends on `TRUST_PROXY_HOPS` (D-04C-06). |

## Security audit events (task 04C)

Account events are written to `platform_audit_records` with the request id
(`docs/decisions.md` D-04C-03). They never contain a token, a password, a CSRF or session
token, or an email address.

| Action | When | Actor |
|---|---|---|
| `user.registered` | A new account was created | The user |
| `user.registration_repeated` | Someone registered an existing address (metadata `verified`) | System `auth` |
| `user.email_verified` | A confirmation link was used | The user |
| `user.sign_in_failed` | Wrong password, inactive account, or unconfirmed address (metadata `reason`); existing accounts only | System `auth` |
| `user.sign_in_locked` | The failure that started a lock (metadata `lockedSeconds`) | System `auth` |
| `user.signed_in`, `user.signed_out` | Target: the session | The user |
| `user.password_reset_requested` | A reset email was sent | System `auth` |
| `user.password_reset` | A new password was set | The user |
