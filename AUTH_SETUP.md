# Cognito integration

The application uses a public Cognito SPA client with the OpenID Connect authorization-code flow and PKCE. The `react-oidc-context` and `oidc-client-ts` libraries handle redirect state, token exchange, session loading, and refresh-token renewal. The locker appears only after the authentication client establishes a current session.

## Public configuration

`src/auth-config.js` contains:

| Setting | Value |
| --- | --- |
| Region | `us-east-2` |
| User pool | `us-east-2_uFg6KbLXG` |
| Public client | `4bm0b0hac4qikacbs3mtc88k5g` |
| Cognito domain | `https://us-east-2ufg6kblxg.auth.us-east-2.amazoncognito.com` |

These identifiers are public browser configuration, not AWS access credentials. Do not add a client secret, AWS access key, or AWS secret key to frontend code.

## Required AWS console settings

Open the user pool, then **App clients**, select the client above, and edit its **Login pages** settings:

- Client type: **Single-page application**, public client with no client secret.
- Identity provider: **Cognito user pool**.
- OAuth grant: **Authorization code grant** only. The frontend handles PKCE.
- Allowed scopes: **openid**, **email**, **profile**.
- Domain branding: **Managed login** on the existing Cognito domain.
- Add the following address to both **Allowed callback URLs** and **Allowed sign-out URLs**:

```text
https://digitallockerproject.github.io/digital_locker/
```

For local development, register this exact address in both lists too:

```text
http://127.0.0.1:5173/digital_locker/
```

If you use localhost, register `http://localhost:5173/digital_locker/` as well and open that address in the browser. Origins, ports, and trailing slashes must match. The frontend derives its return URL from the current origin and Vite base path, so GitHub Pages needs no `/callback` route.

Enable self-registration and email verification to allow users to create accounts through the hosted sign-in page. Password rules and MFA follow your pool settings; the application does not bypass them.

## Install and test

Use Node.js 24 and pnpm 11.25.0:

```sh
npm install --global pnpm@11.25.0
pnpm install --frozen-lockfile
pnpm dev
```

Open `http://127.0.0.1:5173/digital_locker/`, then choose **Sign in or create an account**. Complete the Cognito registration, email verification, and any MFA setup. Cognito should return to the same address and the app will open the locker.

For a production build, run `pnpm build`. The existing GitHub Actions workflow uses the updated pnpm lockfile. The included npm lockfile also supports `npm install`.

## Deploy this update

Upload all source files from the complete package into the root of `digitallockerproject/digital_locker`, including `.github`, `src/main.jsx`, and `pnpm-lock.yaml`. Merge the files into existing folders. Keep unchanged files when updating a folder. Commit to `main` to trigger the existing deployment workflow.

## Session handling

OIDC state and tokens use `sessionStorage` in the current browser tab. A page refresh keeps that local session. Closing the tab drops its local tokens, but does not by itself terminate Cognito's separate hosted sign-in cookie.

**Sign out** attempts refresh-token revocation, clears the local session, and visits Cognito's logout endpoint. The app clears code and state parameters from the address after successful sign-in. A failed callback shows a retry screen instead of the locker. Expired sessions require sign-in again if token renewal does not succeed.

## Upload backend

Private file uploads now have a separate backend. See [OWNER_SETUP.md](OWNER_SETUP.md) for deployment and [README.md](README.md) for the request flow. Existing Cognito identifiers and sign-in behavior are unchanged. The API verifies access tokens and uses the verified `sub` to separate document records.

There is no malware scanner or public sharing service. Uploaded files show **Not scanned**. Files and metadata persist in AWS; browser-only preferences and fictional sample records are no longer used by the active document screens.

## Troubleshooting

- **redirect_mismatch**: register the exact homepage URL in Cognito's callback list.
- **invalid_scope**: enable `openid`, `email`, and `profile` for this client.
- **A client-secret error**: verify the client is a public SPA client. If needed, create a public app client and update `clientId` in `src/auth-config.js`.
- **Sign-out does not return**: register the homepage in the allowed sign-out URLs.
- **No matching state or expired login**: start again from the website's sign-in button in the same tab. A console-generated login link is not an app-initiated PKCE session.

## References

- https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-client-apps.html
- https://docs.aws.amazon.com/cognito/latest/developerguide/using-pkce-in-authorization-code.html
- https://docs.aws.amazon.com/cognito/latest/developerguide/logout-endpoint.html
- https://github.com/authts/react-oidc-context
- https://authts.github.io/oidc-client-ts/
