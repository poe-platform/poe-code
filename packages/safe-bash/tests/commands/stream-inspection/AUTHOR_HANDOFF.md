# Stream inspection author checkpoint — August 27, 2026

Four substantive opt-in source commands: `tac`, `expand`, `fold`, `strings`.
Only the authorized `src/commands/stream-inspection/**` and
`tests/commands/stream-inspection/**` trees are included. Root package exports,
default registry/plugins, shared contracts, grep, shell, providers and historical
reports were not edited. No runtime dependency, native product fallback, branch,
or root dist output was added. Selection and exact50+4 audit names are preserved
in `evidence/SELECTION.md`, including the corrected actual56 default definitions.

## Stable interface and profile

- `createStreamInspectionCommands(options?): readonly CommandDefinition[]`
- `streamInspectionCommands(options?): VirtualShellPlugin`
- `StreamInspectionCommandsOptions`: `replace?`, `limits?: Partial<StreamInspectionLimits>`
- `tac`: default LF, `-b/--before`, literal `-s/--separator`, empty separator=NUL.
- `expand`: `-i/--initial`, `-t/--tabs`, finite/incremental/absolute repeat stops.
- `fold`: `-w/--width`, `-b/--bytes`, `-s/--spaces`, C/POSIX byte columns.
- `strings`: raw/default-all, `-a/--all`, `-n/--bytes`, `-t/--radix`, `-f/--print-file-name`.

`strings` lone `-` is all-data selection, not an input operand; an all-`-`
operand list is a usage error. No operands means stdin. Other commands share
one stdin cursor across `-` operands. Full profile and limits are in the module
README. Options/flags are implemented, not just names. Both grep wrappers remain
deferred; the existing ERE leftmost-longest mismatch was recorded read-only.

## Validation and denominators

Final author verification: **99/99 node:test tests pass,0 skips/failures** with
both live native checks enabled. The tests comprise42 contract/edge tests,
5 actual plugin/Shell/backend integration tests,38 primary-native tests
(36 common workflows,1 grouped Apple-difference assertion,1 live replay),
and14 supplemental GNU strings tests (13 observations,1 live replay).
Strict scoped noEmit passes. Owned-path diff whitespace check passes.
No broad `npm test`, full-repository typecheck, or root build was claimed.

Final frozen native evidence contains52 observations:31 GNU coreutils9.7,
13 GNU strings2.44, and8 Apple observations. Of these,48 positive comparisons
match exact status/stdout/stderr, one GNU strings usage-negative matches
status/stdout/effects with explicitly different diagnostic text, and3 Apple
profile differences are retained, not called parity. Five input fixtures occur
under both Apple and GNU strings oracles; these are not ten independent workflows.
There are47 distinct fixture definitions across the52 final reference rows.

Reference execution history: initial39 captures + corrected39 captures +
supplemental13 captures + final52 live replays =143 durably captured/replayed
native fixture calls. The initial four Apple parser failures and later lone-`-`
product regression remain in separate immutable evidence. An additional32
one-off selector/profile native probes occurred before these cohorts (5 grep,
5 Apple stream probes,22 GNU coreutils probes); they are exploratory, not part
of the52-row acceptance denominator. Identity/version calls are not workflows.
No timing or performance comparison is drawn from any of these executions.

Native controls use local synthetic fixtures, LC_ALL=C/TZ=UTC, literal argv,
bounded process time/output, and per-run owned scratch directories removed on
exit. GNU references run on Darwin, **not GNU/Linux**. GNU2.44 strings was built
by a different authorized provider, from unmodified official source with a
default-all configuration and existing system zlib; it was not installed or
added to product dependencies. Its executable hash and provenance are in
`evidence/gnu-strings.json`; full provider artifacts remain outside this repo.

## Failures preserved and corrected

`evidence/native.json` preserves original39 captures, including Apple's rejection
of attached `-n2`/`-tx`. Four fixture argv lists were explicitly corrected to
Apple-supported separated arguments in `native-corrected.json`; this is not an
unchanged-input proof. The initial grouped Apple-difference assertion lacked a
success precondition; it now asserts status/stderr and exact fixture hashes.

`evidence/gnu-strings-lone-dash-regression.json` preserves the actual product's
incorrect stdin bytes and pre-fix source hash beside the native usage failure.
The same fixture remains; only the product behavior and an invalid positive-only
test assumption changed. The short product diagnostic is asserted exactly and
documented as different from native full usage, not hidden by a relaxed gate.

## Freeze and reproduction

`evidence/author-validation.json` records before/after HEAD
4484026b9e0f87359733ac5f2dcbd49798473aa6, actual dirty git state, all172 source-file
hashes, author code hashes, complete command arguments and stdout/stderr.
No source or author-code hashes changed during the final validation. Concurrent
other-owner shell edits existed; this is a dirty-tree source manifest, not the
old30f5cfb snapshot or a claim of a clean full-package revision. The commit
containing this handoff freezes the owned source; root's coordination result
records its exact commit hash. This handoff is added after executable validation;
it does not change tested code.

```sh
node --unhandled-rejections=strict --import tsx --test tests/commands/stream-inspection/*.test.ts
STREAM_NATIVE_LIVE=1 node --unhandled-rejections=strict --import tsx --test tests/commands/stream-inspection/*.test.ts
```

Without the environment opt-in, two live-reference tests explicitly skip while
all frozen comparisons and local product tests still run. Live replay requires
the exact pinned executable hashes and retained paths (optional
`STREAM_GNU_BIN`/`STREAM_GNU_STRINGS` path overrides do not relax identity checks).
`verify.mjs` reproduces scoped noEmit plus the live-enabled suite and manifest;
its evidence publication uses apply_patch. Preserve historical captures before
publishing a new validation run; do not overwrite original native failures.

## Remaining limits and independent review

No full GNU/Unicode/object-format parity is claimed. Regex tac, obsolete numeric
option syntax, Unicode display widths/encodings, strings object-section mode and
other documented flags remain gaps. `tac` buffers an operand; fold/strings buffer
bounded records/runs. Host chunks exceeding the declared chunk bound fail. A
non-streaming VFS fallback can reject a file exceeding its whole-read bound.
Already-published data is not rolled back; a failed read can leave unpublished
fold/strings buffered data. Cancellation cannot force uncooperative host work
to stop, but late rejections are observed. These limits are not native passes.

Independent verifier denominator at this author checkpoint: **0 authored here**.
Its private holdouts, expected bytes and stress subtree were not inspected or
edited. It must evaluate this frozen source separately; these99 author tests
are not independent stress acceptance. All wiring remains opt-in source-only
until root/user explicitly authorizes integration. No superiority,72-hour work
duration, universal parity, current full gate or complete-product claim.
