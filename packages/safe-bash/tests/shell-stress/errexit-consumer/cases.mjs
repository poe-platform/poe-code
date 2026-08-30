const seeded = { phase: { text: 'seed', mode: 0o644 } };
const fixture = (id, source, options = [], extra = {}) => ({ id, role: 'bash', options, source, name: 'public consumer', args: [], files: seeded, ...extra });
export const nativeCases = [
  fixture('startup-e-literal', 'printf "<%s>|<%s>\\n" "$0" "$1"; printf before > phase; false; printf forbidden >> phase', ['-e'], { args: ['; printf INJECTED'] }),
  fixture('sh-startup-e', 'printf sh-before; false; printf forbidden', ['-e'], { role: 'sh' }),
  fixture('set-e-stop', 'printf before > phase; set -e; false; printf forbidden >> phase'),
  fixture('plus-e-disables', 'false; printf option-off; set -e; set +e; false; printf runtime-off > phase', ['-e', '+e']),
  fixture('conditional-function', 'worker() { printf body; false; printf continued; }; if worker; then printf then; fi; printf done', ['-e']),
  fixture('conditional-source', 'if . ./consumer-lib; then printf source-ok; fi; printf done', ['-e'], { files: { ...seeded, 'consumer-lib': { text: 'printf before > phase\nfalse\nprintf after >> phase\n', mode: 0o644 } } }),
  fixture('eval-stop', 'eval \'printf evaluated; false; printf forbidden\'; printf forbidden > phase', ['-e']),
  fixture('pipeline-default', 'false | cat; printf after > phase; printf pipeline-ok', ['-e']),
  fixture('pipeline-pipefail', 'set -o pipefail; false | cat; printf forbidden > phase', ['-e']),
  fixture('child-option-isolation', 'bash -c \'false; printf child\'; false; printf forbidden > phase', ['-e']),
];
export const hostCases = [
  { id: 'literal-invoke-shared-budget', kind: 'budget', source: 'tick "$1"; tick second; tick forbidden', name: 'budget consumer', args: ['; printf injected'], maxCommands: 4, expectedCalls: [['; printf injected'], ['second']], expectedLimit: 'maxCommands' },
  { id: 'invoke-cancellation-identity', kind: 'cancel', source: 'waiter; tick forbidden', name: 'cancel consumer', args: [], expectedTickCalls: 0, expectedWaiterCalls: 1, reasonCode: 'ENOENT' },
];
export const policy = {
  primary: 'Whole GNU Bash5.3 profile; historical whole Bash3.2 profile, no per-case selection.',
  source: 'Exact source/name/positional arguments supplied to -c. Native --noprofile/--norc disable host startup only; product receives declared supported options without those harness flags.',
  roles: 'Native PATH contains only fixture bin symlinks bash/sh to selected profile and cat to /bin/cat. Product uses /consumer/bin with actual virtual registry/interpreter dispatch. No role prelude changes source lines.',
  mapping: 'Native canonical temporary cwd corresponds to /consumer; no stdout/stderr normalization. Relative entries include exact file bytes and modes, excluding native-only bin role infrastructure.',
  effects: 'Seeded phase mode0644; no new-file creation-mask oracle change or umask claim.',
  deferred: 'Consumer-specific env-shebang options await explicit ROOT design. No -S assumption, no existing env-single-row mutation, and no new ERR/inherit_errexit/umask API.',
};
