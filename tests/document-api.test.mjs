import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Load the browser module with a fake session and endpoint. No AWS requests.
let source = await readFile(new URL('../src/document-api.js', import.meta.url), 'utf8');
source = source.replace("import { userManager } from './auth-config.js';", 'const userManager = { getUser: async () => globalThis.testSession };');
source = source.replaceAll('import.meta.env', JSON.stringify({ VITE_DOCUMENT_API_URL: 'https://api.example' }));
const api = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; delete globalThis.testSession; });
const pdf = Object.assign(new Blob(['%PDF-1.7 test'], { type: 'application/pdf' }), { name: 'paper.pdf' });

test('file validation rejects unsupported, empty, oversized and long filenames', () => {
  for (const file of [{ name: 'a.exe', size: 10 }, { name: 'a.pdf', size: 0 }, { name: 'a.pdf', size: 5242881 }, { name: 'a'.repeat(121) + '.pdf', size: 1 }]) {
    assert.throws(() => api.validateFile(file));
  }
  assert.equal(api.validateFile(pdf), 'application/pdf');
});

test('expired sessions never make requests', async () => {
  globalThis.testSession = { expired: true };
  globalThis.fetch = () => assert.fail('Must not fetch');
  await assert.rejects(api.listDocuments(), /session expired/);
});

test('requests use access tokens rather than ID tokens', async () => {
  globalThis.testSession = { access_token: 'access', id_token: 'id' };
  globalThis.fetch = async (url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer access');
    assert.equal(url, 'https://api.example/documents');
    return Response.json({ documents: [] });
  };
  assert.deepEqual(await api.listDocuments(), { documents: [] });
});

test('successful upload reserves, transfers file last, then confirms', async () => {
  globalThis.testSession = { access_token: 'access' };
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push(url);
    if (url.endsWith('/uploads')) return Response.json({ document: { id: 'one' }, upload: { url: 'https://s3.example', fields: { key: 'private/one' } } });
    if (url === 'https://s3.example') {
      assert.equal(options.headers, undefined);
      assert.deepEqual([...options.body.keys()], ['key', 'file']);
      return new Response(null, { status: 204 });
    }
    return Response.json({ document: { id: 'one', status: 'Not scanned' } });
  };
  let reserved;
  const result = await api.uploadDocument(pdf, 'Academic', item => { reserved = item; });
  assert.equal(reserved.id, 'one');
  assert.equal(result.document.status, 'Not scanned');
  assert.deepEqual(calls, ['https://api.example/uploads', 'https://s3.example', 'https://api.example/documents/one/complete']);
});

test('failed transfer is never marked complete', async () => {
  globalThis.testSession = { access_token: 'access' };
  const calls = [];
  globalThis.fetch = async url => {
    calls.push(url);
    if (url.endsWith('/uploads')) return Response.json({ document: { id: 'one' }, upload: { url: 'https://s3.example', fields: {} } });
    return new Response(null, { status: 403 });
  };
  await assert.rejects(api.uploadDocument(pdf, 'Academic', () => {}), /transfer failed/);
  assert.equal(calls.length, 2);
});

test('backend errors reach the user', async () => {
  globalThis.testSession = { access_token: 'access' };
  globalThis.fetch = async () => Response.json({ error: 'The demo upload limit has been reached.' }, { status: 409 });
  await assert.rejects(api.listDocuments(), /upload limit/);
});
