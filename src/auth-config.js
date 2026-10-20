import { UserManager, WebStorageStateStore } from 'oidc-client-ts';

// These identify a public browser application. They are not AWS credentials.
export const cognito = Object.freeze({
  region: 'us-east-2',
  userPoolId: 'us-east-2_uFg6KbLXG',
  clientId: '4bm0b0hac4qikacbs3mtc88k5g',
  domain: 'https://us-east-2ufg6kblxg.auth.us-east-2.amazoncognito.com',
});

// Keep callbacks at the existing homepage so GitHub Pages needs no route rewrite.
export const returnUrl = new URL(import.meta.env.BASE_URL, window.location.origin).href;

export const userManager = new UserManager({
  authority: `https://cognito-idp.${cognito.region}.amazonaws.com/${cognito.userPoolId}`,
  client_id: cognito.clientId,
  redirect_uri: returnUrl,
  response_type: 'code',
  scope: 'openid email profile',
  automaticSilentRenew: true,
  monitorSession: false,
  loadUserInfo: false,
  // A session belongs to this browser tab. Refreshing the page keeps it;
  // closing the tab drops its local tokens. The library handles PKCE and state.
  userStore: new WebStorageStateStore({ store: window.sessionStorage }),
  stateStore: new WebStorageStateStore({ store: window.sessionStorage }),
});

export function clearLoginParameters() {
  window.history.replaceState({}, document.title, returnUrl);
}

export async function signOut() {
  userManager.stopSilentRenew();
  let timeout;
  try {
    // Attempt refresh-token revocation, but always clear the local session and
    // visit Cognito's logout endpoint even if the network request fails.
    await Promise.race([
      userManager.revokeTokens(['refresh_token']).catch(() => undefined),
      new Promise(resolve => { timeout = setTimeout(resolve, 4000); }),
    ]);
  } finally {
    clearTimeout(timeout);
    await userManager.removeUser();
    const logoutUrl = new URL('/logout', cognito.domain);
    logoutUrl.searchParams.set('client_id', cognito.clientId);
    logoutUrl.searchParams.set('logout_uri', returnUrl);
    window.location.assign(logoutUrl.href);
  }
}
