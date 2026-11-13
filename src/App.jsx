import React, { useEffect, useRef, useState } from 'react';
import Icon from '../components/Icon.jsx';
import Modal from '../components/Modal.jsx';
import Status from '../components/Status.jsx';
import { categories } from './data.js';
import { apiUrl, listDocuments, uploadDocument, completeUpload, downloadDocument, deleteDocument, createShare, listShares, revokeShare } from './document-api.js';

const navigation = [['Dashboard', 'dashboard'], ['My documents', 'folder'], ['Settings', 'settings']];
const describe = item => ({ ...item, size: `${(item.sizeBytes / 1024).toFixed(1)} KB`, date: new Date(item.createdAt).toLocaleDateString(), extension: item.name.split('.').pop().toUpperCase() });

export default function App({ account, onSignOut }) {
  const [page, setPage] = useState('Dashboard');
  const [documents, setDocuments] = useState([]);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(null);
  const [selected, setSelected] = useState(null);
  const [shares, setShares] = useState([]);
  const [shareUrl, setShareUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    if (apiUrl) {
      setLoading(true);
      listDocuments().then(data => { if (alive.current) setDocuments(data.documents.map(describe)); })
        .catch(err => { if (alive.current) setError(err.message); })
        .finally(() => { if (alive.current) setLoading(false); });
    }
    return () => { alive.current = false; };
  }, []);

  async function refresh() {
    setError(''); setLoading(true);
    try { const data = await listDocuments(); if (alive.current) setDocuments(data.documents.map(describe)); }
    catch (err) { if (alive.current) setError(err.message); }
    finally { if (alive.current) setLoading(false); }
  }
  function update(item) {
    const doc = describe(item);
    setDocuments(items => [doc, ...items.filter(existing => existing.id !== doc.id)].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    return doc;
  }
  async function submit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true); setError(''); setMessage('Uploading your file…');
    try {
      const result = await uploadDocument(form.get('file'), form.get('category'), item => { if (alive.current) update(item); });
      if (!alive.current) return;
      update(result.document); setModal(null); setPage('My documents'); setMessage('File saved privately. Downloads unlock after the malware scan passes.');
    } catch (err) { if (alive.current) { setError(err.message); setMessage(''); } }
    finally { if (alive.current) setBusy(false); }
  }
  async function finish(doc) {
    setBusy(true); setError('');
    try {
      const result = await completeUpload(doc.id);
      if (alive.current) { setSelected(update(result.document)); setMessage(`Scan status: ${result.document.status}.`); }
    } catch (err) { if (alive.current) setError(err.message); }
    finally { if (alive.current) setBusy(false); }
  }
  async function download(doc) {
    setBusy(true); setError('');
    try {
      const result = await downloadDocument(doc.id);
      if (!alive.current) return;
      const link = document.createElement('a'); link.href = result.url; link.rel = 'noreferrer'; link.click();
      setMessage('Your private download link expires in 60 seconds.');
    } catch (err) { if (alive.current) setError(err.message); }
    finally { if (alive.current) setBusy(false); }
  }
  async function openShares(doc) {
    setSelected(doc); setModal('share'); setShareUrl(''); setShares([]); setError(''); setBusy(true);
    try { const data = await listShares(doc.id); if (alive.current) setShares(data.shares); }
    catch (err) { if (alive.current) setError(err.message); }
    finally { if (alive.current) setBusy(false); }
  }
  async function share(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true); setError(''); setShareUrl('');
    try {
      const data = await createShare(selected.id, { expiresMinutes: Number(form.get('expires')), maxUses: Number(form.get('uses')) });
      if (alive.current) {
        const url = new URL(import.meta.env.BASE_URL, window.location.origin);
        url.hash = new URLSearchParams({ share: data.token }).toString();
        setShareUrl(url.href); setShares(items => [...items, data.share]);
      }
    } catch (err) { if (alive.current) setError(err.message); }
    finally { if (alive.current) setBusy(false); }
  }
  async function revoke(link) {
    setBusy(true); setError('');
    try {
      await revokeShare(selected.id, link.id);
      if (alive.current) { setShares(items => items.map(item => item.id === link.id ? { ...item, revoked: true } : item)); setShareUrl(''); }
    } catch (err) { if (alive.current) setError(err.message); }
    finally { if (alive.current) setBusy(false); }
  }
  async function remove(doc) {
    setBusy(true); setError('');
    try {
      await deleteDocument(doc.id);
      if (alive.current) {
        setDocuments(items => items.filter(item => item.id !== doc.id));
        setModal(null); setSelected(null); setMessage('Document deleted.');
      }
    } catch (err) { if (alive.current) setError(err.message); }
    finally { if (alive.current) setBusy(false); }
  }
  // Poll only while a scan is pending, and stop after a bounded wait.
  const scanning = documents.some(doc => doc.status === 'Scanning');
  useEffect(() => {
    if (!scanning) return;
    let cancelled = false;
    let attempts = 0;
    const timer = setInterval(async () => {
      if (document.hidden) return;
      if (++attempts >= 30) clearInterval(timer);
      try {
        const data = await listDocuments();
        if (!cancelled && alive.current) setDocuments(data.documents.map(describe));
      } catch { clearInterval(timer); }
    }, 10000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [scanning]);
  const current = documents.find(doc => doc.id === selected?.id) || selected;
  const visible = documents.filter(doc => doc.name.toLowerCase().includes(search.toLowerCase()));
  const completed = documents.filter(doc => doc.status === 'Clean');
  const openUpload = () => { setError(''); setMessage(''); setModal('upload'); };
  const feedback = <>{error && <p className="inline-notice warning" role="alert">{error}</p>}{message && <p className="inline-notice" role="status">{message}</p>}</>;
  return <div className="app-shell">
    <a className="skip-link" href="#main">Skip to content</a>
    <aside id="sidebar" className={`sidebar ${menuOpen ? 'open' : ''}`}>
      <a className="brand" href={import.meta.env.BASE_URL}><span className="brand-mark"><Icon name="lock" size={23} /></span><span>digital<span className="brand-light">locker</span><small>YOUR PERSONAL DOCUMENT SPACE</small></span></a>
      <p className="nav-label">WORKSPACE</p>
      <nav aria-label="Main navigation">{navigation.map(([label, icon]) => <button key={label} className={`nav-item ${page === label ? 'selected' : ''}`} aria-current={page === label ? 'page' : undefined} onClick={() => { setPage(label); setMenuOpen(false); }}><Icon name={icon} /><span>{label}</span></button>)}</nav>
      <div className="sidebar-bottom"><p className="student-note">Files are private unless you share a link.</p></div>
    </aside>
    <div className="workspace">
      <header className="topbar"><div className="breadcrumbs"><button className="icon-button mobile-menu" aria-label="Toggle navigation" aria-expanded={menuOpen} aria-controls="sidebar" onClick={() => setMenuOpen(!menuOpen)}><Icon name="menu" /></button><strong>{page}</strong></div><button className="button secondary small" onClick={onSignOut}>Sign out</button></header>
      <main id="main">
        <div className="page-heading"><div><p className="eyebrow">YOUR PERSONAL DOCUMENT SPACE</p><h1>{page === 'Dashboard' ? 'Everything important. One place.' : page}</h1><p>Upload and retrieve your own documents.</p></div><button className="button primary" disabled={!apiUrl || busy} onClick={openUpload}><Icon name="plus" size={19} /> Add document</button></div>
        {!apiUrl && <p className="inline-notice" role="status">Document storage is temporarily unavailable.</p>}
        {!modal && feedback}
        <p className="inline-notice"><Icon name="info" size={16} /> Files stay private. Downloads unlock only after a malware scan finds no threats. A clean scan cannot guarantee a file is safe.</p>
        {page === 'Dashboard' && <section className="stats-grid" aria-label="Locker overview">{[['Clean files', completed.length], ['Pending or blocked', documents.length - completed.length], ['Storage used', `${(documents.reduce((total, doc) => total + doc.sizeBytes, 0) / 1048576).toFixed(1)} MiB`]].map(([label, value]) => <div className="stat-card" key={label}><span>{label}</span><strong className="stat-number">{value}</strong></div>)}</section>}
        {page !== 'Settings' && <section className="panel"><div className="panel-heading"><div><h2>Your documents</h2><p>PDF, PNG, or JPEG · maximum 5 MiB each</p></div><button className="button secondary" disabled={!apiUrl || loading || busy} onClick={refresh}>{loading ? 'Loading…' : 'Refresh'}</button></div><div className="document-toolbar"><label className="search-field"><Icon name="search" /><input aria-label="Search documents" placeholder="Search your documents…" value={search} onChange={event => setSearch(event.target.value)} /></label></div>
          {!visible.length ? <div className="empty-state"><Icon name="folder" size={32} /><h3>{loading ? 'Loading documents…' : 'No documents found'}</h3><p>{search ? 'Try a different search.' : 'Your saved documents will appear here.'}</p></div> : <div className="table-scroll"><table className="document-table"><thead><tr><th>Document name</th><th>Category</th><th>Status</th><th>Added</th></tr></thead><tbody>{visible.map(doc => <tr key={doc.id}><td><button className="file-button" onClick={() => { setSelected(doc); setModal('details'); }}><span className="file-tile"><Icon name="file" /><span>{doc.extension}</span></span><span><strong>{doc.name}</strong><small>{doc.size}</small></span></button></td><td>{doc.category}</td><td><Status value={doc.status} /></td><td>{doc.date}</td></tr>)}</tbody></table></div>}
        </section>}
        {page === 'Settings' && <section className="panel settings-panel"><h2>Your account</h2><div className="account-fields"><label>Display name<input value={account.name} readOnly /></label><label>Email address<input value={account.email} readOnly /></label></div><p>Demo limits: 20 upload reservations per user, 100 across the app, and 100 MiB total reserved storage. Failed uploads count toward these limits.</p><p>Files and records stay in AWS across refreshes and sign-outs. You can delete files from their details. Deletion is permanent; share links can expire, limit uses, or be revoked.</p><button className="button secondary" onClick={onSignOut}>Sign out</button></section>}
        <footer className="workspace-footer">Digital Locker · Private document upload demo</footer>
      </main>
    </div>
    {modal === 'upload' && <Modal title="Add document" onClose={() => { if (!busy) setModal(null); }}><p className="modal-description">Choose a PDF, PNG, or JPEG, up to 5 MiB. Your file stays private and cannot be downloaded until the malware scan passes.</p>{feedback}<form onSubmit={submit}><label>File<input name="file" type="file" accept=".pdf,.png,.jpg,.jpeg" required disabled={busy} autoFocus /></label><label>Category<select name="category" disabled={busy}>{categories.map(category => <option key={category}>{category}</option>)}</select></label><div className="modal-actions"><button type="button" className="button secondary" disabled={busy} onClick={() => setModal(null)}>Cancel</button><button className="button primary" disabled={busy}>{busy ? 'Uploading…' : 'Upload document'}</button></div></form></Modal>}
    {modal === 'details' && current && <Modal title="Document details" onClose={() => { if (!busy) setModal(null); }}>{feedback}<div className="document-preview"><Icon name="file" size={44} /><strong>{current.name}</strong><span>{current.size}</span></div><dl className="detail-list"><div><dt>Category</dt><dd>{current.category}</dd></div><div><dt>Status</dt><dd><Status value={current.status} /></dd></div></dl><p className="inline-notice">{current.status === 'Clean' ? 'The malware scan found no threats. Always use care when opening downloaded files.' : current.status === 'Flagged' ? 'Malware was detected. Download is blocked. Delete this file.' : current.status === 'Scan unavailable' ? 'A successful scan is not available. Download is blocked. Try checking again or upload a new copy.' : current.status === 'Deleting' ? 'Deletion did not finish. Retry deleting this file.' : 'Your file is locked while the upload or scan is pending. Scans normally take a few minutes.'}</p><div className="modal-actions"><button className="button secondary" disabled={busy || current.status === 'Deleting'} onClick={() => finish(current)}>{busy ? 'Please wait…' : 'Check status'}</button><button className="button primary" disabled={busy || current.status !== 'Clean'} onClick={() => download(current)}>Download file</button></div><button className="button secondary full" disabled={busy || current.status !== 'Clean'} onClick={() => openShares(current)}>Share document</button><button className="button secondary full" disabled={busy} onClick={() => { setError(''); setModal('delete'); }}>Delete document</button></Modal>}
    {modal === 'share' && current && <Modal title="Share document" onClose={() => { if (!busy) setModal(null); }}>{feedback}<p>Anyone with the link can download <strong>{current.name}</strong>. Each click can issue one download URL, valid for up to 15 seconds. Revoking or expiring a link cannot take back downloaded copies.</p><form onSubmit={share}><label>Link expires in<select name="expires" disabled={busy}><option value="15">15 minutes</option><option value="60">1 hour</option><option value="1440">1 day</option><option value="10080">7 days</option></select></label><label>Maximum link uses<input name="uses" type="number" min="1" max="10" defaultValue="1" required disabled={busy} /></label><button className="button primary full" disabled={busy || current.status !== 'Clean'}>{busy ? 'Please wait…' : 'Create link'}</button></form>{shareUrl && <label>Copy this link before closing. It is shown only once.<input aria-label="Share link" value={shareUrl} readOnly onFocus={event => event.target.select()} /><button className="button secondary" onClick={async () => { try { await navigator.clipboard.writeText(shareUrl); setMessage('Link copied.'); } catch { setError('Select and copy the link above.'); } }}>Copy link</button></label>}<h3>Your links</h3><button className="button secondary small" disabled={busy} onClick={async () => { setBusy(true); setError(''); try { const data = await listShares(current.id); if (alive.current) setShares(data.shares); } catch (err) { if (alive.current) setError(err.message); } finally { if (alive.current) setBusy(false); } }}>Refresh usage</button>{!shares.length && <p>No links yet.</p>}{shares.map(link => <div key={link.id} className="inline-notice"><span>{link.uses}/{link.maxUses} uses · {link.revoked ? 'Revoked' : link.expiresAt * 1000 <= Date.now() ? 'Expired' : link.uses >= link.maxUses ? 'Used up' : 'Active'}<br />Expires {new Date(link.expiresAt * 1000).toLocaleString()}</span><button className="button secondary small" disabled={busy || link.revoked} onClick={() => revoke(link)}>Revoke</button></div>)}<p>The demo allows 20 links per account and 100 across the app. Expired and revoked links still count.</p></Modal>}
    {modal === 'delete' && current && <Modal title="Delete document?" onClose={() => { if (!busy) setModal('details'); }}>{feedback}<p>This permanently deletes <strong>{current.name}</strong> and cannot be undone. Wait at least five minutes after uploading before deleting. Upload reservations remain counted toward the demo limit.</p><div className="modal-actions"><button className="button secondary" disabled={busy} onClick={() => setModal('details')}>Keep file</button><button className="button primary" disabled={busy} onClick={() => remove(current)}>{busy ? 'Deleting…' : 'Permanently delete'}</button></div></Modal>}
  </div>;
}
