import React, { useEffect, useRef, useState } from 'react';
import Icon from '../components/Icon.jsx';
import Modal from '../components/Modal.jsx';
import Status from '../components/Status.jsx';
import Documents from '../pages/Documents.jsx';
import { categories, initialDocuments, initialLinks, initialActivity } from './data.js';

const navigation = [ ['Dashboard', 'dashboard'], ['My documents', 'folder'], ['Shared links', 'link'], ['Activity', 'activity'], ['Settings', 'settings'] ];

export default function App() {
  const [page, setPage] = useState('Dashboard');
  const [documents, setDocuments] = useState(initialDocuments);
  const [links, setLinks] = useState(initialLinks);
  const [activity, setActivity] = useState(initialActivity);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All categories');
  const [status, setStatus] = useState('All statuses');
  const [sort, setSort] = useState('Recent first');
  const [modal, setModal] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const selected = documents.find(doc => doc.id === selectedId);
  const [toast, setToast] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [profile, setProfile] = useState({ name: 'Alex Morgan', email: 'alex@example.com' });
  const [notifications, setNotifications] = useState(true);
  const toastTimer = useRef();
  const scanTimers = useRef([]);
  const mainHeading = useRef(null);
  const notify = (message, type = 'success') => {
    clearTimeout(toastTimer.current);
    setToast({ message, type });
    toastTimer.current = setTimeout(() => setToast(null), 6500);
  };
  useEffect(() => () => { clearTimeout(toastTimer.current); scanTimers.current.forEach(clearTimeout); }, []);
  useEffect(() => { mainHeading.current?.focus(); }, [page]);
  const go = next => { setPage(next); setMenuOpen(false); setSearch(''); };
  const addActivity = (title, detail, icon = 'info') => setActivity(items => [{ id: crypto.randomUUID(), title, detail, icon, time: 'Just now · demo' }, ...items]);
  const openShare = doc => { setSelectedId(doc.id); setModal('share'); };
  const openDetails = doc => { setSelectedId(doc.id); setModal('details'); };
  const clean = documents.filter(doc => doc.status === 'Clean').length;
  const pending = documents.filter(doc => ['Quarantined', 'Scanning'].includes(doc.status)).length;
  const flagged = documents.filter(doc => doc.status === 'Flagged').length;
  const activeLinks = links.filter(link => link.status === 'Active').length;
  const used = documents.reduce((sum, doc) => sum + doc.sizeMb, 0).toFixed(1);
  const filtered = documents.filter(doc => doc.name.toLowerCase().includes(search.toLowerCase()) && (category === 'All categories' || doc.category === category) && (status === 'All statuses' || doc.status === status));
  const visibleDocuments = sort === 'Name A–Z' ? [...filtered].sort((a, b) => a.name.localeCompare(b.name)) : sort === 'Largest first' ? [...filtered].sort((a, b) => b.sizeMb - a.sizeMb) : filtered;

  function simulateUpload(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get('name')).trim();
    if (!name) return;
    const id = crypto.randomUUID();
    const flaggedResult = form.get('result') === 'Flagged';
    setDocuments(items => [{ id, name: /\.pdf$/i.test(name) ? name : `${name}.pdf`, category: form.get('category'), size: '1.0 MB', sizeMb: 1, status: 'Quarantined', date: 'Just now', extension: 'PDF' }, ...items]);
    setModal(null);
    go('My documents');
    notify('Sample added to quarantine. A simulated scan will begin shortly.', 'info');
    addActivity('A sample document entered quarantine', `${name} · no file was uploaded`, 'upload');
    scanTimers.current.push(setTimeout(() => {
      setDocuments(items => items.map(doc => doc.id === id ? { ...doc, status: 'Scanning' } : doc));
    }, 1300));
    scanTimers.current.push(setTimeout(() => {
      const result = flaggedResult ? 'Flagged' : 'Clean';
      setDocuments(items => items.map(doc => doc.id === id ? { ...doc, status: result } : doc));
      notify(flaggedResult ? 'Simulated warning: the sample was flagged. Sharing is unavailable.' : 'Simulated scan complete. Your sample is ready to share.', flaggedResult ? 'warning' : 'success');
      addActivity(`${name} received a simulated ${result.toLowerCase()} result`, 'Demo only · no malware scan or encryption was performed', flaggedResult ? 'alert' : 'shield');
    }, 3700));
  }

  function createLink(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + Number(form.get('days')));
    setLinks(items => [{ id: crypto.randomUUID(), documentId: selected.id, recipient: String(form.get('recipient')).trim(), expires: expiry.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }), views: 0, maxViews: Number(form.get('views')), status: 'Active' }, ...items]);
    addActivity('A demo sharing link was created', `${selected.name} · ${form.get('views')} view limit`, 'link');
    setModal(null);
    go('Shared links');
    notify('Demo link created. It is a visual example and cannot open a document.');
  }

  return <div className="app-shell">
    <a className="skip-link" href="#main">Skip to content</a>
    {menuOpen && <button className="sidebar-backdrop" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}
    <aside id="sidebar" className={`sidebar ${menuOpen ? 'is-open' : ''}`}>
      <a href="#dashboard" className="brand" onClick={event => { event.preventDefault(); go('Dashboard'); }}><span className="brand-mark"><Icon name="lock" size={23} /></span><span>digital<span className="brand-light">locker</span><small>YOUR PERSONAL DOCUMENT SPACE</small></span></a>
      <p className="nav-label">WORKSPACE</p>
      <nav aria-label="Main navigation">{navigation.map(([label, icon]) => <button key={label} className={`nav-item ${page === label ? 'selected' : ''}`} aria-current={page === label ? 'page' : undefined} onClick={() => go(label)}><Icon name={icon} /><span>{label}</span>{label === 'My documents' && <span className="nav-count">{documents.length}</span>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="student-note"><span className="small-icon"><Icon name="cap" /></span><strong>Made for student life.</strong><p>Less paperwork stress.<br />More room for what’s next.</p></div><button className="profile-button" onClick={() => go('Settings')}><span className="avatar">{profile.name.split(' ').map(part => part[0]).join('').slice(0, 2).toUpperCase() || 'AM'}</span><span><strong>{profile.name || 'Demo student'}</strong><small>Student workspace</small></span><Icon name="settings" size={17} /></button></div>
    </aside>
    <div className="workspace">
      <header className="topbar"><div className="breadcrumbs"><button className="icon-button mobile-menu" aria-label="Toggle navigation" aria-expanded={menuOpen} aria-controls="sidebar" onClick={() => setMenuOpen(!menuOpen)}><Icon name="menu" /></button><span>My workspace</span><span className="breadcrumb-divider">/</span><strong>{page}</strong></div><button className="demo-pill" onClick={() => setModal('about')}><span className="live-dot" /> Demo workspace <Icon name="info" size={14} /></button></header>
      <main id="main">
        <div className="page-heading"><div><p className="eyebrow">{page === 'Dashboard' ? 'A LITTLE MORE ORGANIZED' : 'YOUR PERSONAL DOCUMENT SPACE'}</p><h1 ref={mainHeading} tabIndex={-1}>{page === 'Dashboard' ? 'Everything important. One place.' : page}</h1><p>{ { Dashboard: 'Your documents, sharing links, and recent activity at a glance.', 'My documents': 'A little order for the paperwork that matters.', 'Shared links': 'Choose what you share and how long it stays available.', Activity: 'Keep track of what happens in your locker.', Settings: 'Make this sample workspace feel like yours.' }[page] }</p></div><button className="button primary" onClick={() => setModal('upload')}><Icon name="plus" size={19} /> Add document</button></div>
        <div className="demo-banner"><Icon name="info" size={17} /><span><strong>You’re exploring a prototype.</strong> Documents and security statuses are simulated. Nothing is uploaded or stored.</span><button onClick={() => setModal('about')}>About this demo <Icon name="arrow" size={15} /></button></div>

        {page === 'Dashboard' && <>
          <section className="stats-grid" aria-label="Locker overview">{[
            ['All documents', documents.length, 'Your paperwork, together', 'folder', 'blue'],
            ['Ready to share', clean, 'Example clean scan results', 'shield', 'green'],
            ['Active links', activeLinks, 'Sharing on your terms', 'link', 'purple'],
            ['Needs attention', flagged + pending, `${flagged} flagged · ${pending} awaiting a scan`, 'clock', 'amber'],
          ].map(([label, value, caption, icon, color]) => <div className="stat-card" key={label}><div><span>{label}</span><span className={`stat-icon ${color}`}><Icon name={icon} size={20} /></span></div><strong className="stat-number">{value.toString().padStart(2, '0')}</strong><small>{caption}</small></div>)}</section>
          <div className="dashboard-grid"><div className="main-column">
            <section className="panel"><div className="panel-heading"><div><h2>Recent documents</h2><p>The latest additions to your locker.</p></div><button className="text-button" onClick={() => go('My documents')}>View all <Icon name="arrow" size={16} /></button></div><Documents documents={documents.slice(0, 4)} onView={openDetails} onShare={openShare} /><div className="panel-footer"><Icon name="info" size={15} /> Select a document to explore its details.</div></section>
            <section className="panel activity-panel"><div className="panel-heading"><div><h2>A little activity</h2><p>What’s been happening lately.</p></div><button className="text-button" onClick={() => go('Activity')}>View all <Icon name="arrow" size={16} /></button></div><ActivityList items={activity.slice(0, 3)} /></section>
          </div><aside className="right-column">
            <section className="upload-card"><span className="upload-illustration"><Icon name="upload" size={29} /></span><span className="eyebrow">ROOM FOR THE IMPORTANT STUFF</span><h2>Give your paperwork<br />a place to call home.</h2><p>Transcripts, IDs, leases, and all the documents life asks for.</p><button className="button primary full" onClick={() => setModal('upload')}><Icon name="plus" size={18} /> Add a sample document</button><small>Try the upload flow · no real files needed</small></section>
            <section className="panel storage-panel"><div className="section-inline"><h2>Your space</h2><Icon name="folder" size={18} /></div><div className="storage-value"><strong>{used} MB</strong><span>of 1 GB · sample</span></div><div className="storage-track" role="meter" aria-label="Sample storage used" aria-valuemin={0} aria-valuemax={1000} aria-valuenow={Number(used)}><span style={{ width: `${Math.min(100, Number(used) / 10)}%` }} /></div><p>A small space for big milestones.</p></section>
            <div className="workflow-note"><Icon name="shield" size={21} /><div><strong>A safer path, by design</strong><p>Quarantine → scan → store.<br />Explore the planned document journey in this demo.</p></div></div>
          </aside></div>
        </>}

        {page === 'My documents' && <section className="panel"><div className="document-toolbar"><label className="search-field"><Icon name="search" size={19} /><input aria-label="Search documents" placeholder="Search your documents…" value={search} onChange={event => setSearch(event.target.value)} />{search && <button className="icon-button" aria-label="Clear search" onClick={() => setSearch('')}><Icon name="close" size={15} /></button>}</label><div className="filters"><label><span className="sr-only">Category</span><select value={category} onChange={event => setCategory(event.target.value)}><option>All categories</option>{categories.map(item => <option key={item}>{item}</option>)}</select></label><label><span className="sr-only">Scan status</span><select value={status} onChange={event => setStatus(event.target.value)}>{['All statuses', 'Clean', 'Flagged', 'Quarantined', 'Scanning'].map(item => <option key={item}>{item}</option>)}</select></label><label><span className="sr-only">Sort documents</span><select value={sort} onChange={event => setSort(event.target.value)}><option>Recent first</option><option>Name A–Z</option><option>Largest first</option></select></label></div></div><div className="results-caption" aria-live="polite">{visibleDocuments.length} {visibleDocuments.length === 1 ? 'document' : 'documents'}<button className="text-button" onClick={() => { setSearch(''); setCategory('All categories'); setStatus('All statuses'); setSort('Recent first'); }}>Reset filters</button></div><Documents documents={visibleDocuments} onView={openDetails} onShare={openShare} /></section>}

        {page === 'Shared links' && <section className="panel"><div className="panel-heading"><div><h2>Sharing, with boundaries</h2><p>Sample expiration dates and view limits. No public links are generated.</p></div><span className="count-pill">{activeLinks} active</span></div><div className="share-list">{links.map(link => {
          const doc = documents.find(item => item.id === link.documentId);
          return <article key={link.id} className="share-row"><span className="round-icon"><Icon name="link" /></span><div className="share-description"><h3>{doc?.name || 'Sample document'}</h3><p>For {link.recipient}</p><div className="share-meta"><span><Icon name="clock" size={14} /> Expires {link.expires}</span><span><Icon name="eye" size={14} /> {link.views} / {link.maxViews} views</span></div></div><Status value={link.status} /><button className="button secondary small" disabled={link.status !== 'Active'} onClick={() => { setLinks(items => items.map(item => item.id === link.id ? { ...item, status: 'Revoked' } : item)); notify('Demo link revoked. The sample status has been updated.'); addActivity('A demo sharing link was revoked', doc?.name || 'Sample document', 'link'); }}>Revoke</button></article>;
        })}</div><div className="panel-footer"><Icon name="info" size={16} /> To try creating a link, open a clean document and choose Share.</div></section>}

        {page === 'Activity' && <section className="panel"><div className="panel-heading"><div><h2>Your locker timeline</h2><p>Sample events and actions from this session.</p></div><span className="count-pill">{activity.length} events</span></div><ActivityList items={activity} /></section>}

        {page === 'Settings' && <div className="settings-grid"><section className="panel settings-panel"><h2>Sample profile</h2><p>Changes apply only to this demo session.</p><form onSubmit={event => { event.preventDefault(); notify('Sample profile updated for this session.'); }}><label>Display name<input value={profile.name} maxLength={50} required onChange={event => setProfile({ ...profile, name: event.target.value })} /></label><label>Email address<input type="email" value={profile.email} required onChange={event => setProfile({ ...profile, email: event.target.value })} /></label><button className="button primary" type="submit">Save demo profile</button></form></section><section className="panel settings-panel"><h2>Preferences</h2><p>A preview of your future locker settings.</p><label className="toggle-row"><span><strong>Activity notifications</strong><small>Visual preference only. No emails are sent.</small></span><input type="checkbox" className="switch" checked={notifications} onChange={event => { setNotifications(event.target.checked); notify(`Demo notifications ${event.target.checked ? 'enabled' : 'disabled'}.`); }} /></label><hr /><h3>Start fresh</h3><p>Restore the original fictional documents, links, and profile.</p><button className="button secondary" onClick={() => setModal('reset')}>Reset demo workspace</button></section></div>}
        <footer className="workspace-footer"><span><Icon name="lock" size={13} /> Digital Locker</span><span>Built for the important stuff. <span className="footer-demo">Prototype · sample data only</span></span></footer>
      </main>
    </div>

    {modal === 'about' && <Modal title="A look inside Digital Locker" onClose={() => setModal(null)}><p className="modal-description">This is a visual prototype for a student document locker. Explore the planned experience using fictional data.</p><div className="about-steps">{[['upload', 'Quarantine first', 'New documents wait in a separate area.'], ['shield', 'Scan before storing', 'Clean results allow sharing; flagged results block it.'], ['link', 'Share on your terms', 'Set an expiration and a maximum number of views.']].map(([icon, title, description]) => <div key={title}><span className="round-icon"><Icon name={icon} /></span><span><strong>{title}</strong><p>{description}</p></span></div>)}</div><div className="inline-notice">These are planned features. This demo has no authentication, uploads, malware scanning, encryption, storage, or real sharing. All changes disappear when you refresh.</div><button className="button primary full" onClick={() => setModal(null)}>Got it, let’s explore</button></Modal>}

    {modal === 'upload' && <Modal title="Add a sample document" onClose={() => setModal(null)}><p className="modal-description">Try the planned quarantine and scan flow with a fictional document. No file is selected or uploaded.</p><div className="upload-placeholder"><Icon name="upload" size={30} /><strong>Your real upload area will live here</strong><span>For now, create a sample below.</span></div><form onSubmit={simulateUpload}><label>Sample document name<input name="name" placeholder="e.g. Fall transcript.pdf" required maxLength={80} autoFocus /></label><div className="form-grid"><label>Category<select name="category">{categories.map(item => <option key={item}>{item}</option>)}</select></label><label>Simulated scan result<select name="result"><option>Clean</option><option>Flagged</option></select></label></div><div className="inline-notice"><Icon name="info" size={16} /> The status will change from Quarantined → Scanning → your chosen result.</div><div className="modal-actions"><button type="button" className="button secondary" onClick={() => setModal(null)}>Cancel</button><button type="submit" className="button primary"><Icon name="plus" size={17} /> Add sample</button></div></form></Modal>}

    {modal === 'details' && selected && <Modal title="Document details" onClose={() => setModal(null)}><div className="document-preview"><Icon name="file" size={44} /><strong>{selected.name}</strong><span>Fictional document · preview placeholder</span></div><dl className="detail-list"><div><dt>Category</dt><dd>{selected.category}</dd></div><div><dt>File size</dt><dd>{selected.size}</dd></div><div><dt>Added</dt><dd>{selected.date}</dd></div><div><dt>Sample scan status</dt><dd><Status value={selected.status} /></dd></div></dl><div className={`inline-notice ${selected.status === 'Flagged' ? 'warning' : ''}`}>{selected.status === 'Clean' ? 'This sample shows a clean result. No real scanning or encryption has taken place.' : selected.status === 'Flagged' ? 'This example is flagged. Sharing is blocked until a future backend verifies the document is safe.' : 'This sample is waiting for a clean result. Sharing is unavailable.'}</div><button className="button primary full" disabled={selected.status !== 'Clean'} onClick={() => openShare(selected)}><Icon name="link" size={17} /> {selected.status === 'Clean' ? 'Share this document' : 'Sharing unavailable'}</button></Modal>}

    {modal === 'share' && selected && <Modal title="Share a document" onClose={() => setModal(null)}><p className="selected-file"><Icon name="file" size={20} />{selected.name}</p><p className="modal-description">Preview the controls for a limited sharing link.</p><form onSubmit={createLink}><label>Who is this for?<input name="recipient" placeholder="e.g. Scholarship office" required maxLength={80} autoFocus /></label><div className="form-grid"><label>Expires after<select name="days"><option value="1">1 day</option><option value="7">7 days</option><option value="30">30 days</option></select></label><label>Maximum views<select name="views"><option value="1">1 view</option><option value="3">3 views</option><option value="5">5 views</option><option value="10">10 views</option></select></label></div><div className="inline-notice"><Icon name="info" size={16} /> This creates a sample sharing entry. It does not generate a working URL.</div><div className="modal-actions"><button className="button secondary" type="button" onClick={() => setModal(null)}>Cancel</button><button className="button primary" type="submit"><Icon name="link" size={17} /> Create demo link</button></div></form></Modal>}

    {modal === 'reset' && <Modal title="Reset this demo?" onClose={() => setModal(null)}><p className="modal-description">This removes your session changes and restores the original sample workspace.</p><div className="modal-actions"><button className="button secondary" onClick={() => setModal(null)}>Keep exploring</button><button className="button primary" onClick={() => { scanTimers.current.forEach(clearTimeout); scanTimers.current = []; setDocuments(initialDocuments); setLinks(initialLinks); setActivity(initialActivity); setProfile({ name: 'Alex Morgan', email: 'alex@example.com' }); setNotifications(true); setModal(null); setSearch(''); setCategory('All categories'); setStatus('All statuses'); setSort('Recent first'); notify('Demo workspace reset. A fresh start.'); }}>Reset demo</button></div></Modal>}
    <div className="toast-region" role="status" aria-live="polite" aria-atomic="true">{toast && <div className={`toast ${toast.type}`}><Icon name={toast.type === 'warning' ? 'alert' : toast.type === 'info' ? 'info' : 'check'} size={20} /><span>{toast.message}</span><button className="icon-button" aria-label="Dismiss notification" onClick={() => setToast(null)}><Icon name="close" size={17} /></button></div>}</div>
  </div>;
}

function ActivityList({ items }) {
  return <ol className="activity-list">{items.map(item => <li key={item.id}><span className={`activity-icon ${item.icon === 'alert' ? 'amber' : ''}`}><Icon name={item.icon} size={17} /></span><div><strong>{item.title}</strong><p>{item.detail}</p></div><time>{item.time}</time></li>)}</ol>;
}
