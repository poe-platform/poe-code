import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { createExecutionClient } from './materializations.js';
import type { DependencyManifest } from './protocol.js';

const bytes = (value: string) => Array.from(new TextEncoder().encode(value));
const manifest = (): DependencyManifest => ({ version: 1, sessionId: 's', epoch: 'e', namespaceId: 'original-tree', revision: 'original-revision', logicalRoot: bytes('/work'), cwd: bytes('/work'), sourceAuthorityId: 'selected-originals', entries: [] });
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

it.each(['duplicate', 'conflicting-parent', 'invalid-blob-handle', 'invalid-size', 'invalid-hash', 'sparse-path', 'session', 'epoch'])('preflights %s manifest admission before credentials or transport', async defect => {
  const original = manifest();
  const source = { authorityId: original.sourceAuthorityId, path: bytes('/original/clip'), freshness: 'immutable' as const, snapshotId: 'independent-upload', observedVersion: null, retainedIdentity: null };
  original.entries = [{ kind: 'file', path: [bytes('clip')], source, blob: { blobId: 'verified-upload', size: '4', sha256: createHash('sha256').update('clip').digest('hex') } }];
  const entry = original.entries[0];
  if (entry.kind !== 'file') throw new Error('Expected file fixture');
  if (defect === 'duplicate') original.entries.push(structuredClone(entry));
  if (defect === 'conflicting-parent') original.entries.push({ kind: 'directory', path: [bytes('clip'), bytes('child')], source });
  if (defect === 'invalid-blob-handle') entry.blob.blobId = '';
  if (defect === 'invalid-size') entry.blob.size = '-1';
  if (defect === 'invalid-hash') entry.blob.sha256 = 'x'.repeat(64);
  if (defect === 'sparse-path') delete entry.path[0][1];
  if (defect === 'session') original.sessionId = 'unauthorized-session';
  if (defect === 'epoch') original.epoch = 'old-epoch';
  const before = structuredClone(original);
  const token = vi.fn(() => 'token');
  const transport = vi.fn(async () => Response.json({ manifestId: 'stored', revision: original.revision, sha256: digest(original) }, { headers: { 'Execution-Epoch': 'e' } }));
  const client = createExecutionClient({ baseUrl: 'https://identity.test', sessionId: 's', epoch: 'e', token, fetch: transport });
  await expect(client.putManifest(original)).rejects.toBeInstanceOf(TypeError);
  expect(token).not.toHaveBeenCalled();
  expect(transport).not.toHaveBeenCalled();
  expect(original).toEqual(before);
});
function fixture(change: Record<string, unknown>, inspection = false) {
  const original = manifest();
  const client = createExecutionClient({ baseUrl: 'https://identity.test', sessionId: 's', epoch: 'e', token: () => 'token', fetch: async url => Response.json(String(url).endsWith('/manifests')
    ? { manifestId: 'stored', revision: original.revision, sha256: digest(original), ...(!inspection ? change : {}) }
    : { ...original, ...change }, { headers: { 'Execution-Epoch': 'e' } }) });
  return { client, original };
}

it.each([{ manifestId: '' }, { revision: 'replacement' }, { sha256: '0'.repeat(64) }])('rejects an unverified manifest receipt %j', async change => {
  const { client, original } = fixture(change);
  await expect(client.putManifest(original)).rejects.toBeInstanceOf(TypeError);
});

it.each([{ sessionId: 'another-session' }, { epoch: 'old' }, { revision: 'replacement' }, { namespaceId: 'another-tree' }, { sourceAuthorityId: 'another-authority' }, { entries: [{}] }])('rejects a substituted or malformed manifest inspection %j', async change => {
  const { client, original } = fixture(change, true);
  await client.putManifest(original);
  await expect(client.inspectManifest('stored')).rejects.toBeInstanceOf(TypeError);
});

it('admits an unchanged original manifest and receipt', async () => {
  const { client, original } = fixture({}, true);
  expect(await client.putManifest(original)).toEqual({ manifestId: 'stored', revision: original.revision, sha256: digest(original) });
  expect(await client.inspectManifest('stored')).toEqual(original);
});

it('pins exact JSON bytes on first inspection across reconnects', async () => {
  const original = manifest();
  let content = JSON.stringify(original, null, 2);
  const client = createExecutionClient({ baseUrl: 'https://identity.test', sessionId: 's', epoch: 'e', token: () => 'token', fetch: async () => new Response(content, { headers: { 'Execution-Epoch': 'e' } }) });
  expect(await client.inspectManifest('stored')).toEqual(original);
  expect(await client.inspectManifest('stored')).toEqual(original);
  content = JSON.stringify(original);
  await expect(client.inspectManifest('stored')).rejects.toThrow('Manifest inspection identity mismatch');
});
