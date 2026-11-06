import React, { useEffect, useRef, useState } from 'react';
import Icon from '../components/Icon.jsx';
import Modal from '../components/Modal.jsx';
import Status from '../components/Status.jsx';
import { categories } from './data.js';
import { apiUrl, listDocuments, uploadDocument, completeUpload, downloadDocument } from './document-api.js';

const navigation = [['Dashboard', 'dashboard'], ['My documents', 'folder'], ['Settings', 'settings']];
const describe = item => ({ ...item, size: `${(item.sizeBytes / 1024).toFixed(1)} KB`, date: new Date(item.createdAt).toLocaleDateString(), extension: item.name.split('.').pop().toUpperCase() });

export default function App({ account, onSignOut }) {
  const [page, setPage] = useState('Dashboard');
  const [documents, setDocuments] = useState([]);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(null);
  const [selected, setSelected] = useState(null);
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
      update(result.document); setModal(null); setPage('My documents'); setMessage('File saved privately. It has not been scanned for malware.');
    } catch (err) { if (alive.current) { setError(err.message); setMessage(''); } }
    finally { if (alive.current) setBusy(false); }
  }
  async function finish(doc) {
    setBusy(true); setError('');
    try {
      const result = await completeUpload(doc.id);
      if (alive.current) { setSelected(update(result.document)); setMessage('Upload confirmed. The file has not been scanned.'); }
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
  const visible = documents.filter(doc => doc.name.toLowerCase().includes(search.toLowerCase()));
  const completed = documents.filter(doc => doc.status === 'Not scanned');
  const openUpload = () => { setError(''); setMessage(''); setModal('upload'); };
  const feedback = <>{error && <p className="inline-notice warning" role="alert">{error}</p>}{message && <p className="inline-notice" role="status">{message}</p>}</>;
  return <div className="app-shell">
    <a className="skip-link" href="#main">Skip to content</a>
    <aside id="sidebar" className={`sidebar ${menuOpen ? 'open' : ''}`}>
      <a className="brand" href={import.meta.env.BASE_URL}><span className="brand-mark"><Icon name="lock" size={23} /></span><span>digital<span className="brand-light">locker</span><small>YOUR PERSONAL DOCUMENT SPACE</small></span></a>
      <p className="nav-label">WORKSPACE</p>
      <nav aria-label="Main navigation">{navigation.map(([label, icon]) => <button key={label} className={`nav-item ${page === label ? 'selected' : ''}`} aria-current={page === label ? 'page' : undefined} onClick={() => { setPage(label); setMenuOpen(false); }}><Icon name={icon} /><span>{label}</span></button>)}</nav>
      <div className="sidebar-bottom"><p className="student-note">Files are private to your signed-in account.</p></div>
    </aside>
    <div className="workspace">
      <header className="topbar"><div className="breadcrumbs"><button className="icon-button mobile-menu" aria-label="Toggle navigation" aria-expanded={menuOpen} aria-controls="sidebar" onClick={() => setMenuOpen(!menuOpen)}><Icon name="menu" /></button><strong>{page}</strong></div><button className="button secondary small" onClick={onSignOut}>Sign out</button></header>
      <main id="main">
        <div className="page-heading"><div><p className="eyebrow">YOUR PERSONAL DOCUMENT SPACE</p><h1>{page === 'Dashboard' ? 'Everything important. One place.' : page}</h1><p>Upload and retrieve your own documents.</p></div><button className="button primary" disabled={!apiUrl || busy} onClick={openUpload}><Icon name="plus" size={19} /> Add document</button></div>
        {!apiUrl && <p className="inline-notice" role="status">Document storage is temporarily unavailable.</p>}
        {!modal && feedback}
        <p className="inline-notice"><Icon name="info" size={16} /> Files are stored privately. Malware scanning and public sharing are not enabled. Use non-sensitive test files for this demo.</p>
        {page === 'Dashboard' && <section className="stats-grid" aria-label="Locker overview">{[['Saved files', completed.length], ['Pending uploads', documents.length - completed.length], ['Storage used', `${(documents.reduce((total, doc) => total + doc.sizeBytes, 0) / 1048576).toFixed(1)} MiB`]].map(([label, value]) => <div className="stat-card" key={label}><span>{label}</span><strong className="stat-number">{value}</strong></div>)}</section>}
        {page !== 'Settings' && <section className="panel"><div className="panel-heading"><div><h2>Your documents</h2><p>PDF, PNG, or JPEG · maximum 5 MiB each</p></div><button className="button secondary" disabled={!apiUrl || loading || busy} onClick={refresh}>{loading ? 'Loading…' : 'Refresh'}</button></div><div className="document-toolbar"><label className="search-field"><Icon name="search" /><input aria-label="Search documents" placeholder="Search your documents…" value={search} onChange={event => setSearch(event.target.value)} /></label></div>
          {!visible.length ? <div className="empty-state"><Icon name="folder" size={32} /><h3>{loading ? 'Loading documents…' : 'No documents found'}</h3><p>{search ? 'Try a different search.' : 'Your saved documents will appear here.'}</p></div> : <div className="table-scroll"><table className="document-table"><thead><tr><th>Document name</th><th>Category</th><th>Status</th><th>Added</th></tr></thead><tbody>{visible.map(doc => <tr key={doc.id}><td><button className="file-button" onClick={() => { setSelected(doc); setModal('details'); }}><span className="file-tile"><Icon name="file" /><span>{doc.extension}</span></span><span><strong>{doc.name}</strong><small>{doc.size}</small></span></button></td><td>{doc.category}</td><td><Status value={doc.status} /></td><td>{doc.date}</td></tr>)}</tbody></table></div>}
        </section>}
        {page === 'Settings' && <section className="panel settings-panel"><h2>Your account</h2><div className="account-fields"><label>Display name<input value={account.name} readOnly /></label><label>Email address<input value={account.email} readOnly /></label></div><p>Demo limits: 20 upload reservations per user, 100 across the app, and 100 MiB total reserved storage. Failed uploads count toward these limits.</p><p>Files and records stay in AWS across refreshes and sign-outs. This version does not include deletion or public sharing.</p><button className="button secondary" onClick={onSignOut}>Sign out</button></section>}
        <footer className="workspace-footer">Digital Locker · Private document upload demo</footer>
      </main>
    </div>
    {modal === 'upload' && <Modal title="Add document" onClose={() => { if (!busy) setModal(null); }}><p className="modal-description">Choose a PDF, PNG, or JPEG, up to 5 MiB. The file will be saved privately without a malware scan.</p>{feedback}<form onSubmit={submit}><label>File<input name="file" type="file" accept=".pdf,.png,.jpg,.jpeg" required disabled={busy} autoFocus /></label><label>Category<select name="category" disabled={busy}>{categories.map(category => <option key={category}>{category}</option>)}</select></label><div className="modal-actions"><button type="button" className="button secondary" disabled={busy} onClick={() => setModal(null)}>Cancel</button><button className="button primary" disabled={busy}>{busy ? 'Uploading…' : 'Upload document'}</button></div></form></Modal>}
    {modal === 'details' && selected && <Modal title="Document details" onClose={() => setModal(null)}>{feedback}<div className="document-preview"><Icon name="file" size={44} /><strong>{selected.name}</strong><span>{selected.size}</span></div><dl className="detail-list"><div><dt>Category</dt><dd>{selected.category}</dd></div><div><dt>Status</dt><dd><Status value={selected.status} /></dd></div></dl><p className="inline-notice">{selected.status === 'Pending upload' ? 'If the file transfer succeeded but confirmation failed, check the upload below. Incomplete transfers require a new upload.' : 'This file has not been scanned for malware. Only download files you trust.'}</p><button className="button primary full" disabled={busy} onClick={() => selected.status === 'Pending upload' ? finish(selected) : download(selected)}>{busy ? 'Please wait…' : selected.status === 'Pending upload' ? 'Check upload' : 'Download your file'}</button></Modal>}
  </div>;
}
