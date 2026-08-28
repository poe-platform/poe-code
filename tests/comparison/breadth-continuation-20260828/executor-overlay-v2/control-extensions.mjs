import assert from 'node:assert/strict';
import { publicAdmission } from './admission.mjs';
import { assessNamespace } from './namespace.mjs';
import { requireThat } from '../executor-preparation-v1/core.mjs';

export function namespaceCountercontrols(profile) {
  const positive = [...profile.scaffolding, { path: '/fixture', type: 'directory', mode: 493 }];
  assessNamespace(positive, profile);
  const rejects = (entries, expected) => {
    try { assessNamespace(entries, profile); assert.fail(`Expected ${expected}`); }
    catch (error) { assert.equal(error.code, expected); return { code: error.code, message: error.message }; }
  };
  const overflow = [...positive, ...Array.from({ length: 64 }, (_, index) => ({ path: `/fixture/output-${index}`, type: 'directory', mode: 493 }))];
  const unlisted = structuredClone(positive);
  const replace = unlisted.find(entry => entry.path !== '/' && entry.path !== '/fixture');
  replace.path = '/unlisted';
  const changed = structuredClone(positive);
  changed.find(entry => entry.path === '/').mode ^= 1;
  return [rejects(overflow, 'WORKFLOW_ENTRY_CAP'), rejects(unlisted, 'UNLISTED_SCAFFOLD'), rejects(changed, 'SCAFFOLD_CHANGED')];
}
export async function actualAdmissionCountercontrol(library, authorization) {
  requireThat(authorization?.rootGo === true && authorization?.differentFreeze && authorization?.loadedCandidate === '67eab12e315054907ef4ef435c6bbca2f59e0c36', 'ROOT_GO_REQUIRED', 'C11 requires a supervised authenticated product worker, not the preparation process.');
  const observations = [];
  const positive = new library.Shell({ fs: library.createMemoryFileSystem() });
  let release;
  let announce;
  const gate = new Promise(resolve => { release = resolve; });
  const entered = new Promise(resolve => { announce = resolve; });
  const expectedNames = ['breadth-control-only'];
  positive.use({ name: 'controlled-admission', async setup(host) {
    announce(); await gate;
    host.commands.register({ name: expectedNames[0], execute: () => ({ exitCode: 0 }) });
  } });
  let pending;
  try {
    pending = publicAdmission(positive, expectedNames, event => observations.push(event));
    pending.catch(() => {});
    await entered;
    assert(!observations.some(event => event.kind === 'admission-barrier'));
    release(); await pending;
    assert(observations.some(event => event.kind === 'admission-barrier'));
  } finally { release(); if (pending) await pending.catch(() => {}); await positive.dispose(); }
  const marker = new Error('breadth C11 prior setup rejection');
  const negative = new library.Shell({ fs: library.createMemoryFileSystem() });
  negative.use({ name: 'rejecting-admission', setup() { throw marker; } });
  const rejectedEvents = [];
  let observed;
  try {
    observed = await publicAdmission(negative, [], event => rejectedEvents.push(event)).then(() => null, error => error);
    assert.equal(observed, marker);
    assert(!rejectedEvents.some(event => event.kind === 'admission-barrier'));
    assert(rejectedEvents.some(event => event.kind === 'setup-exec-rejected' && event.message === marker.message));
  } finally { await negative.dispose(); }
  return { actualShell: true, separateSetupExecs: 2, semanticExecs: 0, observations, rejectedEvents, rejectionIdentity: observed === marker, shellsDisposed: 2 };
}
