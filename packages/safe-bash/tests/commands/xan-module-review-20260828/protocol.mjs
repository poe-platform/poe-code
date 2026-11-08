import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, REPO, check, sha, exactJson, fingerprint } from './core.mjs';
import { gitBytes } from './supervisor.mjs';

export async function loadBinding() {
  const manifest = JSON.parse(await readFile(path.join(ROOT, 'BINDING.json'), 'utf8'));
  check(manifest.classification === 'POST_AUTHOR_RELEASE_PRE_PRODUCT_INSPECTION', 'TIMING_CLASS');
  return manifest;
}
export async function pinnedDocuments(binding) {
  const documents = {};
  for (const entry of binding.inputs) {
    const raw = await gitBytes(['show', `${entry.commit}:${entry.path}`], entry.bytes, REPO);
    check(raw.length === entry.bytes && sha(raw) === entry.sha256, 'PINNED_INPUT', entry.path);
    if (entry.path.startsWith(binding.diracPrefix) && entry.path.endsWith('.json')) documents[entry.path.slice(binding.diracPrefix.length)] = JSON.parse(raw.toString('utf8'));
  }
  return documents;
}
export async function verifySeal() {
  const seal = JSON.parse(await readFile(path.join(ROOT, 'RECIPE-SEAL.json'), 'utf8'));
  for (const entry of seal.files) {
    const actual = await fingerprint(path.join(ROOT, entry.path), entry.bytes);
    check(actual.bytes === entry.bytes && actual.sha256 === entry.sha256 && actual.mode === entry.mode, 'RECIPE_SEAL', entry.path);
  }
  for (const tool of seal.tools) {
    const actual = await fingerprint(tool.path, tool.bytes);
    check(actual.bytes === tool.bytes && actual.sha256 === tool.sha256, 'TOOL_SEAL');
  }
  return seal;
}
export async function readHandoff(filename, bytes, digest) {
  check(Number.isSafeInteger(bytes) && bytes > 0 && /^[a-f0-9]{64}$/.test(digest), 'HANDOFF_ARTIFACT_IDENTITY_REQUIRED');
  return exactJson(filename, { bytes, sha256: digest });
}
