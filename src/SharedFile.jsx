import React, { useState } from 'react';
import Icon from '../components/Icon.jsx';
import { redeemShare } from './document-api.js';

export default function SharedFile({ token }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function download() {
    setBusy(true); setMessage('');
    try {
      const result = await redeemShare(token);
      const link = document.createElement('a');
      link.href = result.url; link.rel = 'noreferrer'; link.click();
      setMessage('Your download has started. This counts as one link use.');
    } catch (error) { setMessage(error.message + ' If a request was interrupted, it may still have counted as a use.'); }
    finally { setBusy(false); }
  }
  return <main className="auth-page"><section className="auth-card" style={{ margin: 'auto', maxWidth: 520 }}><span className="auth-lock"><Icon name="file" size={30} /></span><h1>A document was shared with you</h1><p>The owner set an expiry and use limit. Clicking Download uses the link once. No sign-in is needed.</p><p>Files are released only after a malware scan finds no threats. Use care when opening downloads.</p>{message && <p className="inline-notice" role="status">{message}</p>}<button className="button primary full" disabled={busy} onClick={download}>{busy ? 'Checking link…' : 'Download document'}</button><p><a href={import.meta.env.BASE_URL}>Open your own locker</a></p></section></main>;
}
