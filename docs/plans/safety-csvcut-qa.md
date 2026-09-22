# csvcut VFS resource and failure boundary QA

Use the archived package pattern at
`docs/plans/archive/safe-bash-command-package-pattern.md`. Preserve unrelated
edits; do not publish or extract held XAN sources. Native executables are manual
research controls only, never unit dependencies.

1. Run `npm run test:unit --workspace=safe-bash-command-csvcut`,
   `npm run lint --workspace=safe-bash-command-csvcut` and the shared CSV engine
   unit route. Verify independent selector/dialect controls, every byte split,
   hostile byte types, realm admission, quota exhaustion, cancelled reads and
   writes, exact failure identity, idempotent retirement and fresh invocations.
2. Run the maintained selected build closure:
   `npm run build:workspaces -- --workspace=@poe-platform/safe-bash`.
   After completion run the Shell csvcut wiring and boundary test files with
   Node/tsx. Verify VFS `.sh`, pipelines, redirects and SDK parity, conditional
   follow-up suppression on quota failure and resolved same-file/symlink aliases.
3. Run private bundling, package-safe and publication-boundary suites under
   Vitest. Inspect the bundled command runtime and declarations for unpublished
   bare imports; command manifest remains private with empty dependencies.
4. Manually import built public modules before denying host filesystem,
   executable, HTTP/socket/fetch and credential environment capabilities. Run
   CSV CLI and SDK on memory VFS, then absent host and URL operands. Verify no
   denied capability is used, restore instrumentation and dispose the Shell.
5. Capture and inspect actual Shell CSV projection and diagnostic terminal output
   with the maintained screenshot tool. No screenshot test or QA script.
   Store temporary evidence in `/out`; if unavailable, record the failure and
   use ignored task-owned `out/safety-csvcut`, then purge it.

Ordinary parser/selection/output-admission errors precede ordinary output, but
this is not atomic destination publication. Explicit BOM and sink failures can
leave partial output. Shell `>` truncates before reading, including same-file
symlink aliases; `&& cp` is success gating, not exclusive publication. csvcut
has no destination-writing SDK API, conditional/exclusive replacement primitive
or temporary storage. Safe atomic publication requires a separate VFS primitive.

Compatibility target: csvkit release 2.2.0/agate 1.14.2 on Python 3.9, with
source references csvkit 194c904256a09dc203c460944d35e9d414244503 and agate
34856488cfcbe9077af8e3e557cbf98a044fdd64. The current versioned reader and ASCII
selector profiles are candidates, not full compatibility. Sniffer, other codecs,
quoting modes 1/2, native character field limits and complete Python CSV/NUL
profiles remain unsupported/unqualified. Later-source ignore-unknown flag is
rejected. csvcut line numbering is distinct from csvgrep physical parser lines.
No inference, locale, null conversion or uniform row-width enforcement.

No original/checkpoint/replay implementation was changed; independent replay and
actual browser/workerd runtime qualification remain unverified. Deterministic
quota checks do not establish performance or exact JavaScript heap usage.

## Verification receipt

Candidate: dirty working tree based on HEAD
`ab1fa8d34101e1e7f61272973f3bc28a842043d8`, verified 2026-09-20.
No runtime implementation was changed: new independent tests validate the
existing implementation; the README makes destructive redirect guarantees clear.

| Candidate input | SHA256 |
| --- | --- |
| csvcut command | `d25753c55f6a3589c3231c8478fd0aeabc8e6a0f9e3cad8ef979a2d81108b8c2` |
| projection | `708abecbea8a5a03bbc2aa3dd3a22acc8f1ee7ca44d0e0ff62deaa8fcbf3210e` |
| shared CSV engine | `bfb710ddffb6cd7463ab024127e109c1c1f35e4d6ead33de068ef9b8a1c7e5a3` |
| command unit controls | `f5513979af6b3435ca0b52a999f81daa71b72febd14c01aa5115b2e58428f20c` |
| Shell boundary controls | `a8e6930855cd01d7287d07a4031678cb76205f2ce2cb05c16c182b4ed55baf93` |

Passed:

- Maintained csvcut workspace unit route: 98 passed, zero failures, skips or
  cancellations. New independent command cells exhaust each applicable quota,
  cancel blocked output with falsey reasons and preserve a sink failure after
  the header was written; cleanup retires input once and fresh invocation works.
  Existing cells cover split UTF-8/BOM/newlines, malicious byte properties/types,
  isolated realms, cooperative parse/input cancellation and grammar errors.
- Maintained workspace lint and source/test TypeScript checks; scoped ESLint for
  both Shell csvcut test files. Shared CSV engine unit route: 24 passed, no skips.
- Selected maintained safe-bash build closure completed, including guarded
  integration inputs and optional CLI postbuild; shared cache reported zero hits.
- Shell wiring/boundary selection: six passed, zero skips. Real pipelines,
  redirects, VFS script dispatch, SDK parity, pipefail, byte argv, denied fetch,
  missing host/URL operands and absent executable fallbacks executed.
- Four Vitest packaging/publication suites: 224 passed, zero skips. Includes
  memory-VFS packed csvcut declarations and Buffer-free isolated realm runtime
  with canonical contracts and byte argv.
- Actual maintained package staging completed for version
  `0.0.0-safety-csvcut` (no publication). A staged runtime command projected
  `a,b / x,y` to `b / y` and retained canonical runtime identity with a Node
  resolver denying all bare unpublished command/contracts/CSV-engine imports.
  Only staged public safe-fs/safe-js packages were linked as first-party peers.
  Shipped command declarations reference bundled relative implementation paths.
- Manual built CLI/SDK byte equality, disposal and negative authority controls:
  host read/open/stream APIs, process spawn/exec APIs, HTTP(S), socket and fetch
  calls denied after module import. Reads of HOME, PATH, PYTHONIOENCODING and
  selected credential environment keys denied. No monitored capability was used.
- Maintained `npm run screenshot` captured actual Shell projection, names and
  unknown-option diagnostic output. Image inspected: rows and width-three names
  readable, status 0 for success and status 2 for grammar failure.

Investigated execution failures, subsequently corrected:

- Three Vitest suites were mistakenly invoked through Node's test runner;
  Vitest reported missing suite context. Correct Vitest execution passed all
  four suites; no implementation or assertion was weakened.
- Package staging first omitted required `--version`, producing usage error;
  complete invocation succeeded. Initial direct staged runtime import lacked
  the public safe-fs peer; adding staged public peer links fixed resolution.
- `/out` creation failed because the host root is read-only. Used task-owned
  ignored `out/safety-csvcut`; generated evidence and staging purged after review.
  An initial artifact scan used the source-style dist path; corrected inspection
  used staged `dist/safe-bash/commands/csvcut` and bundled implementation paths.

Acceptance limits / unverified cells:

- Same-file/alias redirects are demonstrably destructive: they output LF from
  now-empty input. Quota failure truncates an already-opened destination, though
  it emits no ordinary bytes; conditional follow-up preserves the separate
  published control. Sink failures can leave the header. No atomic/exclusive
  publication or rollback guarantee is accepted.
- Full upstream compatibility, listed unsupported profiles, native re-comparison,
  actual browser/workerd engines and independent original/checkpoint/replay
  matrix remain unverified. The isolated VM is a realm check, not browser QA.
- No broad npm test/repository lint/root build receipt is claimed. Changes are
  focused verification tests and documentation; maintained focused workspace
  checks and the selected build closure cover their scope. No performance
  measurements were taken. There are no pending execution runs.

Local commits: none. Verified remote-main delivery: none. Successful releases:
none. No standalone command package was published.
