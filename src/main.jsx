import React from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider } from 'react-oidc-context';
import AuthGate from './AuthGate.jsx';
import { clearLoginParameters, userManager } from './auth-config.js';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <AuthProvider userManager={userManager} onSigninCallback={clearLoginParameters}>
    <AuthGate />
  </AuthProvider>,
);
