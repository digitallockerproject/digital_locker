import React from 'react';
import Icon from '../components/Icon.jsx';
import Status from '../components/Status.jsx';

export default function Documents({ documents, onView, onShare, emptyMessage = 'No documents match your search.' }) {
  if (!documents.length) return <div className="empty-state"><Icon name="folder" size={32} /><h3>No documents found</h3><p>{emptyMessage}</p></div>;
  return <div className="table-scroll"><table className="document-table"><thead><tr><th>Document name</th><th>Category</th><th>Scan status</th><th>Added</th><th><span className="sr-only">Actions</span></th></tr></thead>
    <tbody>{documents.map(doc => <tr key={doc.id}>
      <td><button className="file-button" onClick={() => onView(doc)}><span className={`file-tile ${doc.extension === 'PNG' ? 'purple' : ''}`}><Icon name="file" size={21} /><span>{doc.extension}</span></span><span><strong>{doc.name}</strong><small>{doc.size}</small></span></button></td>
      <td><span className="category-label">{doc.category}</span></td><td><Status value={doc.status} /></td><td className="date-cell">{doc.date}</td>
      <td><button className="icon-button" aria-label={`Share ${doc.name}`} disabled={doc.status !== 'Clean'} title={doc.status === 'Clean' ? 'Configure a sharing link' : 'Only documents with a clean scan can be shared'} onClick={() => onShare(doc)}><Icon name="link" size={18} /></button></td>
    </tr>)}</tbody></table></div>;
}
