import { BASE, TOOLS, HASHES, OBSERVER_ARGS, OBSERVER_ENV, LIMITS, sha256 } from './finite.mjs';
import { renderFence, historicalPairs } from './fence.mjs';

export function preparationData(records) {
  const root = `${BASE}/owned/os-review-01`;
  const nativeRoot = `${BASE}/owned/native-A01-00000000-0000-0000-0000-000000000001`;
  const entry = `${root}/entry.mjs`, fixture = `${root}/allowed.bin`;
  const profile = ['(version 1)', '(deny default)', '(deny network*)', '(deny file-write*)',
    `(allow file-read-data (literal "${TOOLS.node}") (literal "${entry}") (literal "${fixture}"))`,
    `(allow file-read-metadata (literal "${TOOLS.node}") (literal "${entry}") (literal "${fixture}") (literal "${root}"))`,
    `(allow process-exec (literal "${TOOLS.node}"))`, ''].join('\n');
  const cases = [
    { id: 'OS01', operation: 'one allowed read and one denied owned foreign-canary read', positiveAttempts: 1, negativeAttempts: 1 },
    { id: 'OS02', operation: 'deny fixture write, owned foreign-canary write, instruction-basename creation; filenames only', positiveAttempts: 0, negativeAttempts: 3 },
    { id: 'OS03', operation: 'one denied child spawn of this exact Node and entry with OS03-CHILD; no other executable', positiveAttempts: 0, negativeAttempts: 1 },
    { id: 'OS04', operation: 'one denied IPv4 listen on 127.0.0.1 port 0; no connection to foreign service', positiveAttempts: 0, negativeAttempts: 1 },
    { id: 'OS05', operation: 'exact constructed environment and empty config/hook/pager role declaration; no Git semantics', positiveAttempts: 1, negativeAttempts: 0 },
    { id: 'OS06', operation: 'owned Node cooperative 20-second delay, expect 10-second deadline and <=5-second closure', positiveAttempts: 0, negativeAttempts: 1 },
  ].map(item => ({ ...item, executable: TOOLS.sandbox, executableSha256: HASHES.sandbox,
    argv: ['-f', `${root}/qualifier.sb`, TOOLS.node, '--no-warnings', entry, item.id],
    cwd: root, env: { ...OBSERVER_ENV, HOME: `${root}/empty/home`, TMPDIR: `${root}/tmp` },
    stdio: ['ignore', 'pipe', 'pipe'], profileSha256: sha256(profile), timeoutMs: LIMITS.workflowMs, cleanupMs: LIMITS.cleanupMs,
    expected: 'UNEXECUTED; startup denial is unavailable, never an intended-control PASS' }));
  return {
    schema: 'git-native-bridge-v4-preparation-data', classification: 'DATA_ONLY_NO_GO',
    nativeA01: renderFence(nativeRoot, records), nativeA01Sha256: sha256(renderFence(nativeRoot, records)),
    qualifierProfile: profile, qualifierProfileSha256: sha256(profile),
    historicalPairs: historicalPairs(records), sharedCacheFileIdentities: [],
    qualifier: { cases, nodeSha256: HASHES.node,
      observer: { executable: TOOLS.ps, executableSha256: HASHES.ps, argv: [...OBSERVER_ARGS], env: { ...OBSERVER_ENV }, timeoutMs: 2000, maximumCallsPerCase: 160, maximumBufferBytes: 65536 },
      childCeiling: { wrapperThenNodeSamePID: 6, ps: 960, unexpectedOS03ChildRescue: 1, totalOwnedChildren: 967, externalCollectorAlreadyOwned: 1 },
      overallMs: 120000, combinedAllChildStreamBytes: 65536, reservePerCaseMs: 15000,
      entrySource: 'NOT_IMPLEMENTED: exact OS operations above require an owned-child host binding unavailable in this preparation; stubs.json is not executable entry code.',
      staging: [entry, fixture, `${root}/foreign/canary.bin`, `${root}/foreign/aGeNtS.Md`, `${root}/qualifier.sb`, `${root}/empty/global.config`, `${root}/empty/system.config`],
      publication: `${root}/capture/terminal.json`,
      diagnostic: 'First authorized OS01 startup only under this exact conservative profile; if startup fails preserve stdout/stderr/exit plus known child closure. No broadening or discovery retry. Return exact requested missing path from authorized error metadata if available; otherwise unavailable. Never read private/current-repo or enumerate unknown cache paths.',
      qualification: 'NOT_DISPATCH_READY: no qualified cache mapping, current host/tool revalidation, owned-sync-ps binding, or executable OS entry. Recipe review is not GO.',
    },
  };
}
