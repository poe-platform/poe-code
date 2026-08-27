export const environment = Object.freeze({ LC_ALL: 'C', LANG: 'C', TERM: 'dumb', TZ: 'UTC' });
export const fixtures = {
  basic: [
    ['d', 'z-dir'], ['f', 'z-dir/deep.txt', 'deep\n'], ['d', 'b-dir'],
    ['f', 'b-dir/keep.txt', 'keep\n'], ['d', 'b-dir/nested'],
    ['f', 'b-dir/nested/last.txt', 'last\n'], ['f', 'b-dir/drop.bin', 'drop'],
    ['d', 'empty'], ['d', 'skip-dir'], ['f', 'skip-dir/hidden-by-filter.txt', 'skip'],
    ['f', 'zeta.txt', 'z'], ['f', 'Alpha.txt', 'a'], ['f', 'b.txt', 'b'],
    ['f', '.hidden.txt', 'h'], ['d', '.secret'], ['f', '.secret/private.txt', 'p'],
  ],
  controls: [
    ['f', 'z-last', 'z'], ['f', 'éclair.txt', 'u'], ['f', '雪.txt', 'u'],
    ['f', '😀.txt', 'u'], ['f', 'line\nbreak.txt', 'n'], ['f', 'tab\tname', 't'],
    ['f', 'escape\u001b[31m', 'e'], ['f', 'quote"name', 'q'],
    ['f', 'back\\slash', 'b'], ['f', 'carriage\rreturn', 'r'], ['f', '-leading', 'l'],
  ],
  links: [
    ['d', 'target'], ['f', 'target/leaf.txt', 'leaf'], ['l', 'alias-a', 'target'],
    ['l', 'alias-b', 'target'], ['l', 'dangling', 'missing'], ['l', 'file-link', 'target/leaf.txt'],
  ],
  cycle: [['d', 'inner'], ['f', 'inner/leaf.txt', 'leaf'], ['l', 'inner/back', '..']],
  rootlink: [['l', '', 'links/target']],
  finite: [['d', 'child'], ['d', 'child/grandchild'], ['f', 'child/grandchild/leaf-marker.txt', 'ok']],
  errors: [['d', 'a-good'], ['f', 'a-good/visible-before-error.txt', 'ok'], ['d', 'z-denied']],
  wide: Array.from({ length: 40 }, (_, index) => ['f', `entry-${String(index).padStart(3, '0')}-雪.txt`, 'x']),
};

const native = (id, title, root, options, features = [], comparison = 'bytes') => ({
  id, title, kind: 'native', root, argv: ['-n', '--charset=ASCII', ...options, root],
  requires: ['ascii-C-profile', ...features], comparison,
});
const adversarial = (id, title, scenario, requires = [], classification = 'required-invariant') => ({
  id, title, kind: 'adversarial', scenario, requires, classification,
});

export const cases = [
  native('N01', 'Unsorted creation, deterministic listing/report, real adapter', 'basic', []),
  native('N02', 'Hidden children and nested hidden directory', 'basic', ['-a'], ['hidden']),
  native('N03', 'Depth one boundary', 'basic', ['-L', '1'], ['depth']),
  native('N04', 'Depth two boundary', 'basic', ['-L', '2'], ['depth']),
  native('N05', 'Reverse combined with directories first', 'basic', ['-r', '--dirsfirst'], ['reverse', 'dirsfirst']),
  native('N06', 'Directories-only report', 'basic', ['-d'], ['directories-only']),
  native('N07', 'Include glob preserves traversable directories', 'basic', ['-P', '*.txt'], ['include-glob']),
  native('N08', 'Excluded directory is not descended', 'basic', ['-I', 'skip*'], ['exclude-glob']),
  native('N09', 'Prune after include filtering', 'basic', ['-P', '*.txt', '--prune'], ['include-glob', 'prune']),
  native('N10', 'No indentation, full paths, no report', 'basic', ['-i', '-f', '--noreport'], ['flat', 'full-path', 'no-report']),
  native('N11', 'Unicode and newline/tab/escape/control default escaping', 'controls', [], ['native-C-escaping']),
  native('N12', 'Explicit literal filename output', 'controls', ['-N'], ['literal-names']),
  native('N13', 'Directory/file/dangling symlinks without follow', 'links', [], ['symlinks']),
  native('N14', 'Follow sibling aliases independently', 'links', ['-l'], ['follow-links'], 'ancestor-alias-invariant'),
  native('N15', 'Follow ancestor cycle without unbounded recursion', 'cycle', ['-l'], ['follow-links']),
  native('N16', 'Symlink root operand without follow flag', 'rootlink', [], ['symlinks']),
  native('N17', 'File root and missing root error status', 'basic/Alpha.txt', ['missing-root'], [], 'status-and-diagnostic'),
  native('N18', 'Reject zero display depth', 'basic', ['-L', '0'], ['depth'], 'status-and-diagnostic'),
  native('N19', 'Native per-directory filelimit (not global budget)', 'basic', ['--filelimit', '2'], ['native-filelimit']),
  native('N20', 'JSON filename escaping and names round trip', 'controls', ['-J', '--noreport'], ['native-json-schema', 'no-report'], 'json'),
  adversarial('A21', 'Disjoint providers collide on scoped device/inode', 'scoped-collision'),
  adversarial('A22', 'Unknown/unscoped identity, realpath ENOTSUP, finite walk', 'unknown-finite'),
  adversarial('A23', 'Unknown identity and ancestor link: bounded not invented cycle', 'unknown-loop', ['follow-links', 'entry-limit']),
  adversarial('A24', 'Absent mandatory realpath method robustness', 'missing-realpath', [], 'nonconforming-provider-exploration'),
  adversarial('A25', 'Pathlike/dot/empty/NUL readdir entries cannot escape walk', 'malicious-names', [], 'provider-boundary-exploration'),
  adversarial('A26', 'Duplicate readdir entries remain bounded', 'duplicate-names', ['entry-limit'], 'provider-boundary-exploration'),
  adversarial('A27', 'Root permission failure retains path and failure', 'permission'),
  adversarial('A28', 'Late subtree EIO, preserve accepted output and failure', 'late-error'),
  adversarial('A29', 'Errno-shaped pre-abort is not swallowed', 'pre-abort'),
  adversarial('A30', 'Pending filesystem abort and observed late rejection', 'pending-fs'),
  adversarial('A31', 'Pending sink abort and observed late rejection', 'pending-sink'),
  adversarial('A32', 'Await sink backpressure; retain chunk ownership', 'backpressure'),
  adversarial('A33', 'Multibyte output budget and partial output policy', 'output-limit', ['output-limit']),
  adversarial('A34', 'Wide listing entry budget', 'entry-limit', ['entry-limit']),
  adversarial('A35', 'Signal propagation, metadata-only, VFS-only operation', 'signals', ['follow-links']),
  adversarial('A36', 'Real adapter traversal never consumes command stdin', 'stdin-unread'),
  adversarial('A37', 'Actual Shell JSON or text pipeline, redirect and stdin consumer', 'shell-pipeline'),
  adversarial('A38', 'Sink EPIPE after accepted prefix remains failure', 'sink-failure'),
];

export const rules = {
  freeze: 'No product execution/imports before explicit root resume and author candidate. Never change expectations to match candidate.',
  features: 'Root supplies a documented supported profile before execution. Missing optional features are unsupported, not pass. Required invariants are never feature-skipped.',
  providerBoundary: 'DirectoryEntry is only name:string/type in current contracts; absent realpath violates the required method shape. These probes characterize defensive handling, not universal native-parity failures. No deduplication or exact rejection diagnostic is mandated.',
  errors: 'Typed FsError factory injected only after resume. Human-readable diagnostics preserve meaning/path; stderr need not serialize errno. Accepted bytes cannot be undone. Partial output may be empty; success is forbidden after a genuine failure.',
  identity: 'Complete scope/dev/ino use reference identity. Different truthful backing universes may have equal numeric IDs. Unknown metadata is not cycle evidence; it may stop at an explicit bound rather than claim a detected cycle.',
  limits: 'Adapter maps existing documented limits only; no invented API names. Global entry limit is distinct from native --filelimit. Explicit positive budgets use broad ceilings without prescribing whether root counts.',
  cancellation: 'Prompt local settlement with exact reason, propagated signal, no new effects after abort, late rejection observed. Host work is deliberately uncooperative; cancellation is not host preemption.',
  native: 'Pinned 2.2.1 on Darwin arm64, LC_ALL=C LANG=C TERM=dumb TZ=UTC, -n --charset=ASCII, bounded temp fixtures. This is not latest-version or Linux behavior evidence.',
  nativeAliasDivergence: 'Original N14 bytes suppress alias-b as recursive although it is a sibling alias. Preserve those bytes as an oracle limitation. User ancestor-cycle requirement instead expects alias-a, alias-b, and target to each expose leaf.txt; N14 is not a native-byte-parity pass.',
  validation: 'Preparation checks only native fixtures and verifier harness. Product cases remain NOT RUN. No claimed parity, provider deployment, performance, subprocess audit, or full gate.',
};
