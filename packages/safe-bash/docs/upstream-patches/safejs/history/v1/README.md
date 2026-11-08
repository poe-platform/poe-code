# Isolated SafeJS lifecycle patch candidate — NOT APPROVED

August 26, 2026. This directory contains a **reproduced but incomplete** upstream
patch candidate, not a change to the private engine or the shipped virtual-bash
plugin. Do not install it into a working checkout. Full-suite validation exposes
an unresolved cancellation error-shape regression; the default verifier exits
nonzero. No assertion or quota was weakened to obtain a green result.

## Reproduce safely

Prerequisites: Node.js 22 (observed 22.22.2), the explicit `apply_patch` executable
on `PATH`, existing safe-bash `tsx` development tooling, and the already-installed
private workspace tooling. No dependency installation, network access, worktree,
build, private cache, or private output directory is used. Run from safe-bash:

```sh
node docs/upstream-patches/safejs/verify.mjs /Users/kjopek/Workspace/poe-code
node --test tests/commands/safejs-stress/artifact-guards.probe.mjs
```

The first command intentionally returns **1** for this candidate. It prints fresh
temporary directories, retains exact command/environment records in
`commands.json`, and writes baseline/patched TAP, full upstream JSON/logs, source
hash manifests, and private revision/status comparisons there. The verifier
requires exactly **0 passed / 10 failed / 0 skipped** on baseline before applying
anything, then requires **10 passed / 0 failed / 0 skipped** on patched acceptance.
It also runs the supplemental invariants and all available upstream tests.
Conformance failures and private drift cannot yield aggregate success.

`--apply-only` creates fresh copies and validates application hashes but does not
run tests; its output explicitly says application only. There is no option to
apply to an input directory or an existing caller-selected destination.

The reproducer pins every non-build/cache engine file in `baseline-hashes.json`,
not just the seven edits. The source can have a newer repository revision only
if those exact engine bytes still match; unrelated dirty state is recorded, not
discarded. Patch SHA256 and before/after hashes are in `patch-manifest.json`.
Application accepts only those seven update-only source paths, rejects traversal,
unexpected operations and symlink targets/ancestors, and uses `apply_patch` in its
own newly created regular-file temporary tree. It verifies the complete resulting
engine manifest. It never edits the input. Temporary copies are retained for
review rather than silently removed.

## Observed results

Initial artifact reproduction: `/tmp/safe-bash-safejs-isolated-TKeNic`.
Prototype exploration: `/tmp/safe-bash-safejs-isolated-qzrIgz`.
The final rerun and durable evidence summary are recorded in `EVIDENCE.md`.

| Gate | Baseline | Patched |
| --- | --- | --- |
| Same original nine true acceptances + durable action-abort | 0 pass, 10 fail, 0 skip | 10 pass, 0 fail, 0 skip |
| Supplemental wrapper/lifecycle invariants | 0 pass, 9 fail, 0 skip | 8 pass, 1 fail, 0 skip |
| Full upstream suite, slow/fuzz enabled, 125 files | 3225 pass, 0 fail, 38 skip | 3224 pass, 1 fail, 38 skip |

The full denominator is **3263 tests**, including all 38 preexisting skips.
The existing root Vitest config, setup, test files, and workspace-source alias
generation are copied unchanged. Aliases resolve only into temporary copied
packages; dependency symlinks are omitted and installed packages are regular-file
copies. Both runs set `SAFEJS_PARSE_FUZZ=1`, `SAFEJS_ADVERSARIAL_SLOW=1`,
`POE_SNAPSHOT_MODE=playback`, and `POE_SNAPSHOT_MISS=error`; each executes:

```sh
node node_modules/vitest/vitest.mjs run packages/safejs/src packages/safejs/test \
  --no-cache --reporter=default --reporter=json --outputFile=<temporary-report.json>
```

No missing runtime prerequisite prevented this full test run. A separate package
`tsc --noEmit --project packages/safejs/tsconfig.json` attempt could not resolve
unbuilt workspace dependency declarations after private symlinks/dist were
excluded; it is **not a passing typecheck**. Vitest uses the copied workspace
source aliases instead. Neither dependency declarations nor build output were
manufactured to hide that limitation.

## What changed, and what remains wrong

- Closure wrappers use the existing branded, frozen `createSandboxClosure`
  factory. Its property callback registers the closure in `seen` before recursive
  property wrapping, preserving cycles and repeated identity. Call/construct,
  static properties, async/name, and original receiver/context are forwarded.
- Retained capture metadata remains private and live via the existing internal
  symbol. **Conservative shared-graph overcounting remains**: a cloned visible
  property graph and original live captures can be charged twice (87 versus 49
  in the diagnostic). This is not a quota bypass. Canonicalizing divergent mutable
  objects merely to satisfy equality could undercount guest or retained growth;
  that broader budget redesign is deliberately not attempted.
- A private WeakMap carries original constructor identity across wrappers for
  existing Map/Set/Error `instanceof` registries. No guest-visible property or host
  capability is added. Known interpreter-branded maps, sets, regexes, generators
  and error objects retain their identity rather than losing internal slots in
  `Object.entries` copying. This is not arbitrary host-object passthrough or a
  new promise of deep cancellation of every nested branded capability.
- Plain copied properties use own data descriptors, including literal and object
  `__proto__`, without invoking inherited setters or changing the prototype.
- Both promise wrappers observe supplied originals before their early-aborted
  rejection. Returned abort rejection is still visible; listener cleanup and
  sandbox promise span metadata survive. Exact null/false reasons are retained.
- Raw `run()` rejects preabort before parsing, budgets, module getters or host
  calls. **Blocking regression**: returning the exact default AbortError retains
  its native host stack and omits a guest source span, failing unchanged
  `src/error/shape-audit.test.ts:106`. Original reason identity, source-bound
  normalization and frozen/custom caller reasons need a carefully reviewed
  contract. This candidate neither mutates arbitrary caller reasons nor replaces
  them to bypass the exact-reason assertion. The audit is not waived.

The durable action-abort child is one Node child per test, with strict rejection
handling, a 256 MiB heap ceiling, 64 KiB captured-output cap, 15-second timeout and
SIGKILL fallback. Baseline catches the outward abort then exits 1 for the original
host promise rejection; patched exits 0 after the observation interval. A separate
bounded child exercises raw and sandbox-promise immediate/delayed rejection,
preexisting promises, exact cancellation reasons and listener cleanup. These are
finite lifecycle regressions, not a host escape or host-evaluator substitute.

`import-proof.mjs` hooks actual Node module loads, rejects private/wrong-engine
imports, and records real run/interpreter paths and SHA256. The original nine
probe file is unchanged; its SHA256 is
`7f8ebc44fdb3cc313439ec1f3a88c7df3dd3d894b8557daec6c0367fcb7611ab`.
No tool denied this isolated defensive implementation; the earlier denied
additional fixture task was not bypassed.

## License and provenance

Source: the actual existing `/Users/kjopek/Workspace/poe-code/packages/safejs`
tree, package `@poe-code/safejs` 0.0.1, `private: true`, with no package-level
license field. The observed repository root `LICENSE` is MIT, copyright
2026 Poe Platform, SHA256
`0f5d2ae231c0461da14b21ac8594071bb51be33e6a3dcc2b105813c69e7f4a13`;
its exact notice is retained in `LICENSE.upstream`. This states observed
provenance, not invented ownership, a separately granted publication permission,
or a claim that the private package is published.

Initial checkpoint revision was `cb9f256b85e5bef78350c425db7d7be8b39a11cc`.
The first successful snapshot observed external advancement to
`031436f3d89ea1df8a33371e30076cb5e44ec262`. Further unrelated private revision and
dirty-status drift occurred during artifact reproduction; exact observations
are preserved. Engine and root-license bytes stayed equal in that reproduction.
Do **not** describe the entire private repository as unchanged throughout this
assignment. Only read-only Git commands with `GIT_OPTIONAL_LOCKS=0` were used.

Independent reviewer findings were consumed from
`/tmp/safe-bash-safejs-isolated-security-checkpoint.txt`: separate-copy ten-test
success, the same full-suite error-shape failure, conservative budget diagnostic,
and guard checks. Reviewer approval remains **NOT APPROVED**. No commits,
private-source edits, runtime dependencies, root exports, manifests, or command
source changes were made. No superiority, full security, universal conformance,
72-hour duration, or product-completion claim follows from this artifact.
