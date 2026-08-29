# F6 Independent Released-Package Smoke

## Decision

**READY for the standalone F6 public SDK/CLI smoke scope.** On August 29, 2026,
the actual installed `poe-code@11.0.32` passes all 22 original smoke checks.
No check fails, times out, is excluded, or remains unreached. This is not a
local-source pack or build result and does not replace F1-F5 or root's combined
final approval.

The source and npm gitHead are
`93dda91e9d0d7078e7940ba51bf73a81ed7aec49`. The accepted immutable F0 manifest
is SHA-256 `09379aed7eb24e455729e605e53d89408523d731ffe8e8b3655ac76bfe02b674`.
Its root tarball is SHA-256
`94aca9a7f6fa9c79e64ac29f88580c4378d285743a7dcb6203a4803d87738ac2`.
F6 performs no new installation, download, build, repack, release query, or
registry query. F0's original package and normal-hook installation are reused.

## Exact contract and execution

`scripts/smoke-test.ts` remains byte-identical at SHA-256
`59f263851f8745cc64fda503c634a4310203efcbd94d266188f2e492ec79cf32`.
The source is parsed using the existing installed TypeScript tooling to extract
the 19 literal CLI command strings and three literal public-JavaScript payload
arrays. Each decoded payload, source pointer, byte count, and SHA-256 is saved.
No assertion, string value, host mock, fake credential, import, or deadline is
rewritten. The source adapter itself is captured as passive text with its exact
execution hash and command receipt, not added as a standalone QA executable.

The only setup adaptations are to use the already installed registry tarball,
the owned project as cwd, and its ordinary package bins first on the controlled
PATH. The repository smoke's local `npm pack` and global install are not run.
These setup differences are explicit; F6 does not claim to have executed the
repository's unmodified installer against a registry artifact.

All CLI commands retain their original shell invocation, exit-zero predicates,
`POE_CODE_OAUTH_LOGIN=0`, and 30,000 ms per-command deadlines. The SDK payload
retains its exit-zero predicate. Credentials and config retain exit zero plus
empty combined output. SDK and credentials receive only the original synthetic
`smoke-test-key`; config does not. Original CLI-all-then-SDK/credentials/config
short-circuit ordering is preserved. All three import checks are reached.

The complete 22 command receipts and separate unabridged stdout/stderr files
are in `commands/`. All succeed on the first run. The slowest command is still
well inside its original deadline; there is no timeout increase, retry,
exclusive CPU window, full-repository test run, or oracle adjustment.

## Values, journals, and native controls

A separately labelled diagnostic executes every original SDK assertion again,
unchanged, then appends observation through public APIs. It is not counted as
another original smoke check and does not replace the genuine 22-check result.
It retains full return values, the original reference snapshot, migration
inspection/history, all three CLI result strings, and ten public serialized
snapshots, including their journals. Its stdout, stderr, source, and command
are preserved without fabricated metadata or private instrumentation.

The diagnostic records:

- Initial and replay reference values `[14,1,2e+100]`, one host read, fresh
  `jobs-v7`, and identical public `run`/core entrypoints.
- Failed-budget recovery `1225`, migration continuation `1226`, and exactly
  one original effect across recovery and migration.
- Checked agent errors `[7,true]` in initial/replay/CLI results; two total
  stub calls after the additional fresh CLI execution.
- MCP initial/replay/CLI result `mcp-ok`; two tool calls and two closes after
  the additional fresh CLI execution. Replay adds no call or close.
- Environment initial/replay/CLI result
  `["granted",null,"EnvAccessError","ENV_ACCESS_DENIED","DENIED"]`.

Counters before and after the diagnostic's public snapshot observations are
identical. A separate bounded native JavaScript child executes the exact
reference and recovery guest source strings with finite host stubs. Native
values are `[14,1,2e+100]` with one read and `1225` with one effect, matching
the released public result. Native execution is not misrepresented as a native
snapshot/migration implementation.

## Identity and effects after execution

All 3,348 installed package files match their before-execution bytes and modes.
This includes all 3,318 inventoried dist files and chunks. The ten resolved
public export paths/hashes and five bin targets remain unchanged. The installed
dependency tree and installation lock remain byte-identical to F0. No local
package or source substitution is used for any SDK or CLI check.

HOME, cache/config/data/state paths, npm prefix/config/cache, and short TMPDIR
are clone-owned. TERM, NODE_OPTIONS, NODE_PATH, and SKIP_SYNC_SKILLS remain
unset. The owned-root file comparison finds only the three expected generated
smoke payloads; no pre-existing monitored file changes or disappears. Those
three files are hash-verified against their evidence copies and removed after
execution. Bookkeeping and all result files remain in the owned evidence tree.

This is explicit environment isolation plus owned-root content observation,
not an OS-wide filesystem/network tracer. No actual-home scan or security
probe is performed. All original provider paths stay dry runs or finite mocks;
the MCP fetch is the original supplied stub. No real LLM request is introduced.

## Ad hoc visual check

Two PNGs preserve actual captured released CLI output: version `11.0.32` and
SafeJS help. Both are viewed and checked for legibility and clipping. They are
raster captures of the exact recorded stdout/stderr using the repository's
terminal screenshot renderer, not fabricated terminal text or screenshot unit
tests. They are not claimed as graphical-desktop captures.

The final isolated package lacks screenshot-only development dependencies and
the external freeze utility. The existing renderer in this reviewer's prior
owned clone is therefore reused read-only, with its hash recorded, solely as
image tooling. It never supplies a tested SDK/CLI artifact. No renderer install,
build, bundle patch, or other-clone write occurs.

## Immutable standalone handoff and limits

The F6 manifest is
`out/safejs-final-published-package/smoke/manifest.json` in
`/Users/kjopek/Workspace/poe-code-safejs-final-package-review`.
It includes the complete F0 capsule as input, the retained exact root tarball,
command/source-adapter evidence, original payloads, full outputs, supplemental
native/public observations, screenshots, before/after identities, and this
report. It has no automatic publication paths.

The original independent 19-CLI-pass/SDK-RED and subsequent pre-final packed
22-GREEN capsules remain unchanged, as do F0 and its preparation capsule.
Earlier release and qualification records are not rewritten or promoted to
new runtime proof. No source/test/README edit, commit, push, original audit
archive read, private export injection, or runtime repair is made.

F6's bounded public smoke is **READY**. Other final semantic partitions and
root's combined decision remain separate. No universal compatibility claim or
full repository gate result is inferred from these 22 checks.
