import React from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider } from 'react-oidc-context';
import SharedFile from './SharedFile.jsx';
import AuthGate from './AuthGate.jsx';
import { clearLoginParameters, userManager } from './auth-config.js';
import './styles.css';

const shareToken = new URLSearchParams(window.location.hash.slice(1)).get('share');
if (shareToken) window.history.replaceState(null, '', window.location.pathname + window.location.search);

createRoot(document.getElementById('root')).render(
  shareToken ? <SharedFile token={shareToken} /> :
  <AuthProvider userManager={userManager} onSigninCallback={clearLoginParameters}>
    <AuthGate />
  </AuthProvider>,
);
