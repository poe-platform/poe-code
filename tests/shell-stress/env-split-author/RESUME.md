# Env split resume: frozen preparation, no product patch

August 27, 2026. Prior preparation commit `71c5829` and all its original native,
baseline, first-attempt and protocol artifacts remain unchanged. No new hidden
holdout/consumer cases were read. No product write lease was used or inferred.

## Source and ownership

Requested baseline: `e7f4f2e3753184415f8098445c2009cb4cd9a6e9`.
Initial observed HEAD `cb92f1b13a310c47190c79424fb9df536e8d0463` had exactly that
committed product tree. Subsequent commit `7a517cec` changed borrowed-buffer
ownership in `src/commands/internal.ts` and `src/commands/streams.ts`. The live
baseline guard refused the changed tree. Its exploratory test run is explicitly
not certification of e7f4f2e; its counts/hash are retained in validation evidence.

The authoritative red capture therefore extracts the **entire committed source**
and package metadata from e7f4f2e into a unique `/tmp` tree, copies only these author
tests/data, and borrows the existing node_modules via a recorded symlink. No git
checkout/reset/stash/worktree, source overlay, dependency install or repo product
edit occurs. Every one of the 212 source files is matched against its e7 Git blob
before/after capture and hashed with SHA256. Actual runtime and env import URLs
resolve to that scratch tree's `.ts` files. Scratch is removed after evidence.

Baseline source hashes:

- execution.ts: `1d084ab203dc59a510e39e5c71743b755ba9bdb5d4b018658398ed96c3dff700`
- runtime.ts: `2223ef9e02565d163ded042d933553a1efae502ce7531fe83bba5611d959c84b`
- command.ts: `9c2f8ecf50def7250b01152a31a45c449109c3ae4d30878252cffe985c6e9df8`
- internal.ts: `28d83d91d5086b39b50494ea1130d34c3b48b22a15dc04c2912ee2503a7536d5`

Prospective implementation scope is **env definition only** in
`src/commands/execution.ts:49`, plus new private adjacent
`src/commands/env-split.ts`. Other execution commands and shared internal options
remain read-only. No contracts, root exports, manifests, FS, runtime, cleanup,
creation-mask or parameter-error-status changes are authorized here.

## Required separate runtime routing

`src/shell/runtime.ts:1137` reads and charges a script before recognizing an env
header at line1156. It accepts only literal `/usr/bin/env bash` or `sh`, directly
selects a profile, and **never dispatches the registered env command**. Consequently
an env-only patch cannot enable `#!/usr/bin/env -S ...`; those headers still fail126.

Root must separately authorize a runtime seam if this capability is included:
reuse a fixed virtual-env planner, preserve one literal optional argument, append
the original filename/user argv, and honor the resulting full interpreter argv and
changed cwd/file. It cannot force the original body when `-C` or an earlier operand
selects another file. Avoid double source charging/header application and fresh
budgets. Retain target allowlisting, invalid-UTF8 and permission refusals. Existing
non-S `bash -e` remains one argument and refuses126. The eight original protocol
goldens remain evidence, not env-only acceptance assertions or waived failures.

## Frozen native coverage

Primary references re-read:

- Official GNU manual, currently **9.11**, not a 9.7 measurement:
  `https://www.gnu.org/software/coreutils/manual/html_node/env-invocation.html`
- Pinned upstream source:
  `https://raw.githubusercontent.com/coreutils/coreutils/v9.7/src/env.c`
- Existing installed9.7 source, SHA256
  `ed606a062de3f107cd3cb9e1e73c7215272e2a8c7ad6f362aa14e0f6d390a032`.

Existing GNU env binary9.7 SHA256
`1026eb36ffd2fdca6d064c0ffd6dd99ceb7bb3f49ec5e804df2c53bef372dbf0`
is Mach-O arm64/Darwin/libSystem, **not GNU/Linux**. Its full path/version is in
`resume-native.json`. Both shell binaries are verified against the prior hashes:
pinned GNU5.3 and `/bin/bash`3.2.57. All 18 new cases run through **each** parent,
with the same `exec "$@"` wrapper and same explicitly selected GNU env binary;
there is no per-case oracle selection, shell eval of input, or mistaken Apple-env
child. All18 raw status/stdout/stderr tuples agree across these parent profiles.

The new36 rows cover absent/present-empty expansion before comments, values with
metacharacters, NBSP/EM SPACE as data, escaped dollar signs, concatenated values,
comment/stop truncation before malformed tails, invalid backslash-newline and
Unicode variable names, valid underscore/digit names, repeated-C ordering,
nested-S consuming remaining argv, assignment timing, BOM argument bytes and
empty trailing argv. No output normalization is used. The C argv recorder is
reused unchanged from prior preparation; selected exported fields are explicit,
not a claim to compare an entire differently seeded host environment.

Native groups have3s deadlines and256KiB output caps, scrubbed C environment,
owned temporary directories, and no surviving children/groups:41 group checks.
All entry inventories match the fixtures; no injection marker appears. No native
tool was downloaded. Original45 core and8 protocol fixtures were not rewritten.

## Frozen author tests and red results

- `tests/shell/env-split-native.test.ts`:59 exact GNU raw-tuple cases (41 original
  grammar/syntax cases plus18 new), four explicit runtime missing-target policy
  checks, and one actual-TS-import/inventory check.
- Four native missing-target diagnostics remain raw in the oracle. Their separate
  tests require127, no recorder/effect, and a diagnostic, **not GNU env's host-exec
  stderr formatting**. This is explicit domain separation, not tuple normalization.
- `tests/shell/env-split-host.test.ts`:25 isolated,4s-bounded actual Shell/plugin
  cases for nested env/pipelines, export/local/parent/cwd state, prefix timing,
  binary cursor/default origin, BOM bytes/text, error ordering, literal no-S
  refusal/injection data, shared commands/output/depth/source/loop limits, finite
  split caps, cancellation/late rejection, registered cleanup, and fallback.
- Full author test result on exact e7 source: **89 tests,5 pass,84 fail**, no skips,
  TODOs or cancellations. Passes are two defensive host controls, two existing
  missing-target policies and the import/inventory assertion. No env-S capability
  is claimed implemented. Intended dispatch witnesses guard budget/cancel checks
  against passing merely because an unsupported-option diagnostic overflowed.
- Full raw baseline:63 cases, **0/63 exact primary tuples**; preserved separately
  from the89 test assertions. These are not63 independent root causes.

`resume-red.txt` preserves all authoritative failure output; `resume-baseline.json`
preserves raw result bytes, command witnesses and VFS entries. The deduplicated
212-file inventory is `resume-source-inventory.json`. `resume-validation.json`
records tooling, guards, initial attempts and commands without duplicate manifests.

Scoped strict noEmit check of the two owned tests, host helper and imported source
passes. It is **not** a global/build/benchmark/packed-consumer gate. The initial
check exposed a preparation harness type error (`spawnSync` options did not type
`detached`) and an accidental default DOM lib mismatch for WebDAV RequestInit.
The harness now uses typed asynchronous spawn and the repo's `lib ES2023`; both
original diagnostics are retained. No product code or expected tuple changed.

## Env-only implementation design held for root

Use an original finite-state parser, not shell parsing, GNU code vendoring or
string eval. ASCII whitespace only; explicit quote/active-argument states;
documented escapes, `\_`, `\c`, comments, and `${NAME}`. Present-empty and absent
unquoted variables differ. Replacement values are literal and never re-tokenized.
Read only incoming `context.env`, before-i/-u/assignments, never host env or locals.

Reinsert each S result before remaining argv and resume option parsing, retaining
earlier supported options. Handle attached/combined/long S forms, consumed option
arguments, `--`, lone `-` and operand termination. The existing leading-`-` rewrite
cannot be blindly reused after splitting: native lone `-` also stops options.
Preserve current i/u/0/C behavior and 6b81bb3 listing order (reverse newly added
names, inherited names after), with no reverse-sort substitute. Generated unsupported
argv0/debug/signal options remain explicit errors before FS/command effects;
this preparation does not add those features or silently migrate all usage codes.

Private proposed bounds per env dispatch:128KiB cumulative UTF8 split input/output,
10,000 generated arguments,32 S expansions and1MiB work. Check before copies,
including bytes expanded from variables; use finite chunks and cancellation/yield
checkpoints. No new public budget/configuration API. Existing literal invoke keeps
shared shell budgets. Tests require a specific bounded split-limit diagnostic,
not a generic missing-command result or timeout-rescue pass.

Split syntax failures should use private125 errors matching frozen GNU messages;
unrelated unsupported options retain the existing usage2 boundary. Reuse actual
`context.invoke(... replaceEnv:true ...)` and the existing fallback. Preserve
cwd/PWD independence, stdin cursor/provenance, bytes/sinks/accounting and cooperative
cleanup. A pure parser owns no asynchronous resource; it must not invent a lifecycle
hook or suppress existing registered cleanup. No helper is implemented in this commit.

## Reproduction and stop

```sh
node tests/shell-stress/env-split-author/resume-native.mjs /tmp/env-split-new-native.json
node tests/shell-stress/env-split-author/resume-verify.mjs /tmp/env-split-new-baseline.json
```

Both commands require fresh output paths. The second always authenticates e7
source rather than silently following current HEAD. Native/input/evidence data
are JSON/text/C, not TypeScript fixtures or test-discovery archives. The two new
`.test.ts` files and typed helpers remain canonical checked inputs, with no excludes
or skips. All scratch/children are retired. STOP after preparation commit; root
must grant a new env-only source lease and separately route any runtime seam.
