import React, { useEffect, useState } from 'react';
import { useAuth } from 'react-oidc-context';
import App from './App.jsx';
import Icon from '../components/Icon.jsx';
import { clearLoginParameters, signOut, userManager } from './auth-config.js';

export default function AuthGate() {
  const auth = useAuth();
  const [sessionEnded, setSessionEnded] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    const expireSession = () => {
      setSessionEnded(true);
      void auth.removeUser().catch(() => {
        setActionError('Your session ended. Reload this page to sign in again.');
      });
    };
    auth.events.addAccessTokenExpired(expireSession);
    return () => auth.events.removeAccessTokenExpired(expireSession);
  }, [auth.events, auth.removeUser]);

  async function startSignIn() {
    setActionError('');
    setSessionEnded(false);
    try {
      // Remove an old error/code from the URL before starting a fresh request.
      clearLoginParameters();
      await auth.removeUser();
      await userManager.clearStaleState();
      await auth.signinRedirect();
    } catch {
      setActionError('We could not open the sign-in page. Check your connection and try again.');
    }
  }

  async function endSession() {
    setSigningOut(true);
    try {
      await signOut();
    } catch {
      setSigningOut(false);
      setActionError('We could not finish signing out. Reload the page and try again.');
    }
  }

  const loading = auth.isLoading || auth.activeNavigator === 'signinRedirect' || signingOut;
  const hasError = Boolean(auth.error || actionError);

  if (!loading && !hasError && auth.isAuthenticated && auth.user && !auth.user.expired) {
    const claims = auth.user.profile;
    const email = typeof claims.email === 'string' ? claims.email : '';
    const name = (typeof claims.name === 'string' && claims.name.trim())
      || (typeof claims.preferred_username === 'string' && claims.preferred_username.trim())
      || email.split('@')[0]
      || 'Student';

    return <App key={claims.sub} account={{ name, email }} onSignOut={endSession} />;
  }

  let message = 'Sign in or create an account to open your locker.';
  if (sessionEnded) message = 'Your session ended. Sign in again to continue.';
  if (auth.error) message = 'We could not complete sign-in. Start again using the button below.';
  if (actionError) message = actionError;
  if (loading) message = signingOut ? 'Closing your session…' : 'Checking your sign-in session…';

  return <main className="auth-page">
    <a className="auth-brand" href={import.meta.env.BASE_URL} aria-label="Digital Locker home">
      <span className="brand-mark"><Icon name="lock" size={24} /></span>
      <span>digital<span className="brand-light">locker</span></span>
    </a>
    <section className="auth-layout" aria-labelledby="welcome-title">
      <div className="auth-introduction">
        <p className="eyebrow">YOUR PERSONAL DOCUMENT SPACE</p>
        <h1 id="welcome-title">Everything important.<br /><span>One place.</span></h1>
        <p>A little order for the paperwork that matters.<br />Your student document space starts here.</p>
        <div className="auth-feature"><Icon name="folder" /><span>A home for your important documents</span></div>
        <div className="auth-feature"><Icon name="link" /><span>Sharing on your terms</span></div>
      </div>
      <div className="auth-card">
        <span className="auth-lock"><Icon name="lock" size={30} /></span>
        <h2>{loading ? (signingOut ? 'Signing out' : 'Opening your locker') : 'Welcome to your locker'}</h2>
        <p className={hasError ? 'auth-message error' : 'auth-message'} role={hasError ? 'alert' : 'status'}>{message}</p>
        <button className="button primary full auth-sign-in" disabled={loading} onClick={startSignIn}>
          {loading ? <><span className="auth-spinner" aria-hidden="true" /> Please wait</> : <>Sign in or create an account <Icon name="arrow" size={18} /></>}
        </button>
        <p className="auth-help">You’ll continue to our account sign-in page.<br />Email verification and password recovery are available there.</p>
      </div>
    </section>
    <footer className="auth-footer">Digital Locker · Built for the important stuff.</footer>
  </main>;
}
