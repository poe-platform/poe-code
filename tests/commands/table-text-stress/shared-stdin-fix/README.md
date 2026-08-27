# GNU 9.7 shared-stdin close correction

This leaf assignment changes only table-text source and this new subtree.
Historical author/stress/reviewer inputs, expectations and records are read-only.
No agents were spawned. No dependencies, host subprocesses in product code,
filesystem changes, root wiring, benchmark edits or builds are introduced.

## Source semantics and limits

The pinned `coreutils-9.7/src/comm.c` reads both operands through one `stdin`
stream when they alias it, merges records, then calls `fclose` for each operand
in order, before `--total`. Its SHA256 is
`3517b5f9e88bbb67ce93e3075811d0856647104ca83c40001f7fa2dcf07c7336`.
On the pinned Darwin binary, the second close fails with EBADF. Empty input,
suppressed columns and `--total` still fail; a strict ordering failure occurs
earlier and must not be replaced by a close diagnostic. These are observed
runtime results, not a claim that the ByteSource contract specifies file
descriptors, duplicate-close behavior or host close-at-EOF callbacks.

`RecordReader` now separates checked operand finalization (`closeOperand`) from
idempotent iterator cleanup (`close`). comm finalizes its actual reader objects
in operand order before totals. No argv pattern or expected output is matched.
The already-shared reader therefore produces the complete original output and
then the native status/diagnostic, without calling the host cleanup twice.
Separately opened identical file paths remain separate readers. Single stdin
operands, regular files, repeated paste stdin and ordinary totals remain useful.
Earlier read/order/write failures and exact caller cancellation reasons survive.

This intentionally matches the requested **GNU 9.7** profile, not every libc,
platform, future GNU version, utility option or host stream lifecycle. General
ByteSource and filesystem contracts are unchanged. Uncooperative host work
cannot be forcibly terminated, and no new close-at-EOF host hook is inferred.

## Unchanged corpus and pins

- Original driver: `tests/commands/table-text/differential.test.ts` (untouched).
- Original inputs: `tests/commands/table-text/cases.ts`, exactly 216 entries.
- Original native expectations: `tests/commands/table-text/gnu-evidence.json`.
- New acceptance driver: `acceptance216.test.ts`; no known-gap exception.
- Full raw-byte replay: `replay.ts initial-red` / `replay.ts post-fix`.

`initial-red.json` and `post-fix.json` archive every unchanged input, its JSON
SHA256, original expectation, native result and product result. Input/output
and diagnostic bytes are losslessly stored as hex. All native input-file bytes
and namespaces are checked for preservation. Both captures include complete
source maps and original author binary identities; these original binaries
differ from the independently pinned metadata build used here.

The reused executable directory is
`tests/commands/metadata-stress/.oracle/coreutils-9.7/src`; nothing there is
modified. `support.ts` enforces binary, comm source, manual and archive hashes:

| Pin | SHA256 |
| --- | --- |
| comm | 86a541de8aa5d90c3404d5b88bc3646be9b2481736be5bafe5ee234522416fd3 |
| paste | 2386f4764d553fcd831e5bbe7a3a6b43110dd2d2cabd610115a3cc427acf323c |
| join | 70364217db6a709fb414718e3941f4dd40b4810f51f5b58047e58e1cb4f6e123 |
| archive | e8bb26ad0293f9b5a1fc43fb42ba970e312c66ce92c1b0b16713d7500db251bf |
| manual | 39b126752866fff675e462bd44d76f3e034abafe462a069cebd53ef39fc53eca |

The first capture attempt stopped at an exact native stderr comparison because
GNU getopt diagnostics contain argv[0], and the executable path differs from
the author's path. `launcher-incident.json` retains reproduced raw actual and
original expected bytes. The corrected launcher explicitly supplies the
original argv[0] from the unchanged author handoff, while executing the pinned
metadata binary. `authorArgv0Directory` and actual executable directory are
recorded separately. No fixture arguments, inputs or expectations are normalized.
Both full replays reproduce all original native status/stdout/stderr bytes.

Native executions use LC_ALL=C and direct pinned executables, never a shell or
fallback. Only tests create host files, under this subtree's ignored `.runtime`.
Each new native fixture has a checked owner sentinel, bounded execution and
namespace checks; only that freshly created fixture is removed. The original
311 driver's temporary files are confined with TMPDIR and an owned runtime cwd.
No unattributed native artifact is touched. Captures are append-only via
apply_patch and refuse overwriting existing records.

## Results, kept separate

| Cohort | Initial/current result | Meaning |
| --- | --- | --- |
| Original 216 product/native profile | 215/216 -> 216/216 | Same input and expectation hashes |
| Exact native original216 recheck | 216/216 both runs | Status and full stdout/stderr bytes |
| Focused 12 native fixtures | 5/12 -> 12/12 | Each through direct, pipeline, redirection |
| Focused deterministic tests | 9 pass/8 fail -> 17/17 | Native meaning, Buffer reuse, cancellation, EPIPE |
| Untouched current-helper311 driver | 310 pass/1 fail | Old status-0 shared-stdin characterization conflicts |
| Separate acceptance311 driver | 311/311 | Replaces only differential driver, not original216 data |
| Scoped TypeScript | exit 0 | `--noEmit`, no build |

Product216 uses the original profile: exact status/stdout/file bytes, diagnostic
presence for ordinary failures. Focused tests additionally require exact shared
EBADF bytes and order-error meaning. Thus 216/216 is not universal exact stderr
parity. Each full capture uses 216 original +12 focused native calls and three
version calls; these are not extra product cases. The 17 focused Node tests
include 12 native-backed fixtures and five contract checks, not 17 new native
workloads. Native fixture breadth is confined to this shared-input regression.

The same current WebDAV helper hash is
`177f79ee640460822cfe0486c87f7cc61ac7c8b84389abe32b48ef27f4b4ef36`.
Its import control succeeds; no removed forwardOwnedWebDavFetch is used or
restored. Each validation brackets full current source hashes with zero measured
within-run drift. Five FS paths differ from the earlier d506 accepted snapshot;
their exact deltas are recorded in `context-deltas.json`. This is explicitly
current-helper/current-source evidence, not unchanged historical dependencies or
clean committed whole-product validation during other writers' FS work.

The historical **215/216**, independent **70/71**, and accepted **104/311**
remain unchanged. The earlier strict historical helper attempt remains
**291 passes /3 load-blocked files /20 cases unexecuted**. The old author's
shared-input success-characterization test is not edited to make it green.
`legacy311.json` stores that one failure; `acceptance311.json` identifies the
replacement driver and every test input hash. This leaf does not rerun or
reclassify the historical independent104; a different verifier owns final review.

## Reproduction

From the repository root:

```
node --unhandled-rejections=strict --import tsx --test tests/commands/table-text-stress/shared-stdin-fix/shared-stdin.test.ts tests/commands/table-text-stress/shared-stdin-fix/acceptance216.test.ts
node_modules/.bin/tsc --noEmit -p tests/commands/table-text-stress/shared-stdin-fix/tsconfig.json
```

`validate.ts` records exact commands and raw stdout/stderr as base64 with hashes.
Its labels are red-focused, post-focused, legacy311, acceptance311, scoped-types;
existing evidence is immutable, so do not rerun those labels over retained files.
Use its archived argv/environment directly for verification, or choose a new
evidence namespace in the independent verifier's own scope. No global suite,
root build, full shell/utility parity, superiority or duration claim follows.
