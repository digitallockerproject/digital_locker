import { userManager } from './auth-config.js';

export const apiUrl = (import.meta.env.VITE_DOCUMENT_API_URL || '').replace(/\/$/, '');
export const maxFileBytes = 5 * 1024 * 1024;
export const fileTypes = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };

export function validateFile(file) {
  const extension = file?.name.split('.').pop().toLowerCase();
  if (!file || !fileTypes[extension]) throw new Error('Choose a PDF, PNG, or JPEG file.');
  if (!file.size || file.size > maxFileBytes) throw new Error('Choose a file between 1 byte and 5 MiB.');
  if (file.name.length > 120) throw new Error('Use a filename of 120 characters or fewer.');
  return fileTypes[extension];
}

async function request(path, body) {
  if (!apiUrl) throw new Error('Uploads are not connected yet. The AWS owner must finish setup.');
  const user = await userManager.getUser();
  if (!user || user.expired) throw new Error('Your session expired. Sign in again.');
  const response = await fetch(`${apiUrl}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${user.access_token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || (response.status === 401 ? 'Your session expired. Sign in again.' : 'The document service is unavailable. Try again.'));
  return data;
}

export const listDocuments = () => request('/documents');
export const completeUpload = id => request(`/documents/${encodeURIComponent(id)}/complete`, {});
export const downloadDocument = id => request(`/documents/${encodeURIComponent(id)}/download`);
export async function uploadDocument(file, category, onReserved) {
  const contentType = validateFile(file);
  const reservation = await request('/uploads', { name: file.name, size: file.size, contentType, category });
  onReserved(reservation.document);
  const form = new FormData();
  for (const [key, value] of Object.entries(reservation.upload.fields)) form.append(key, value);
  form.append('file', file); // S3 requires the file field last.
  const response = await fetch(reservation.upload.url, { method: 'POST', body: form, signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error('File transfer failed. The pending record is saved; choose the file again to make a new upload.');
  return completeUpload(reservation.document.id);
}
