# Independent core regression checkpoint — August 27, 2026

Follow-up: `OUTPUT_ACCOUNTING_REVIEW.md` records independent f7000b0 acceptance
of the eight original budget failures, with the ordering-only mismatch retained.
`NORMATIVE_PROFILES.md` qualifies GNU/Darwin ordering and the SGID native profile.
The historical observations below and their original evidence remain unchanged.

This is the distinct review of Curie's realpath/wc/sort/cksum/env consumer
changes and Sagan's committed environment replacement integration. Production
baseline: `954f2302e4b2f42f90cb5ffd5670d1936f47390c`.

The unchanged original six recipes replay **6/6**; the original actual-shell
acceptance replays **10/10** and the boundary/order/Sagan cohort **111/111**.
Those are independent reruns of existing author cases, not new independent
case designs. Historical author 4/6 and 2/10 reports are untouched.

The new bounded cohort has 100 tests: 77 GNU native vectors (each exercised
at three chunk widths), 13 actual Shell/agentCommands environment checks and
10 resource/lifecycle checks. Its pre-fix result is **89/100**. Eight failures
concern wc Unicode/invalid-byte/word semantics; three concern sort's output or
source-file publication after read/buffer failure. Realpath, all supported
cksum algorithms and the actual env integration cases pass this cohort.

Native GNU coreutils 9.7 is already installed; `capture-native.ts` only runs
fixed fixture arguments in isolated temporary directories. Binaries, versions
and hashes are recorded in `native.json`. No product subprocess, dependency,
host eval or external network is introduced. UTF-8 observations use the real
`en_US.UTF-8` locale on macOS; this does not prove arbitrary locale equivalence.

The first capture projected the logical temporary prefix but missed macOS's
physical `/private` prefix in an absolute realpath result. The complete first
capture remains in `evidence/initial-prefix-capture.json`; the capture was
rerun with both physical and logical prefixes projected. Only that stdout
projection changed, not native behavior or any product expectation. An early
large failing array assertion was stopped because constructing its diff used
excessive memory; the same test now compares size and SHA256, preserving its
source-preservation requirement without an unbounded diagnostic.

`verify.mjs` makes an explicit Git archive, runs the identical new cohort on
original source and the owned command-file overlay, records source/test hashes,
and can execute isolated guard mutants. It never edits real shell/FS/contracts
or original benchmark expectations. Evidence captures use separate filenames.

## Independent result and production fix

Red tests/native expectations were committed first as `e9783ec`; the separate
production-only fix is `280815c7b7106abf9bdca8b9294c811eb80b1846`. Only
`src/commands/streams.ts` and `src/commands/text.ts` changed. No original oracle,
environment ordering, runtime, contract, filesystem, root export or manifest
was changed by this review.

On archived954f230 plus only the five permitted command-file overlays, the
identical cohort improves **89/100 → 100/100**, zero skips/TODO. The five-file
overlay is recorded by hash; only streams/text differ from the baseline.
`evidence/fixed-mutants.json` retains both results and all mutation outputs.

The eleven original failures are:

- `wc/C/unicode-spaces/-w` and `/-lwmc`;
- `wc/en_US.UTF-8/unicode-spaces/-w` and `/-lwmc`;
- `wc/en_US.UTF-8/invalid/-m` and `/-lwmc`;
- `wc/posix-spaces` and `wc/invalid-only`;
- `sort/inplace-read-error`, `sort/stdout-read-error`, and the 32 MiB
  buffer-failure preservation test.

The wc fix incrementally validates UTF-8 without replacing invalid bytes with
counted characters. Invalid bytes still constitute word data. It preserves
literal U+FFFD, BOM, raw byte/LF counts and chunk-boundary state. Character/word
classification follows the measured C/POSIX and UTF-8 profiles, including
`POSIXLY_CORRECT`; this is not arbitrary locale support. In particular, the
pinned GNU9.7 build on macOS classifies byte0xA0 as word whitespace in C unless
POSIXLY_CORRECT is present, and the UTF-8 POSIX profile still recognizes some
nonbreaking spaces through native wide-character classification. Do not equate
these observations with all glibc locales or universal libc behavior.

An additional deterministic decoder probe checks all256 single-byte inputs,
18 boundary/invalid-sequence combinations and64 seeded binary inputs, at four
chunk widths: **338 native inputs /1352 virtual executions, zero mismatches**.
Its raw inputs and outputs are in `evidence/wc-decoder-probes.json`; these are
supplementary observations, not extra Node test rows or new command coverage.

Sort now returns operational status2 without publishing sorted partial input
after an input/read/buffer error. This prevents both partial stdout and damage
to `sort -o input input missing`. The fast comparator itself is unchanged.

Seven isolated semantic mutants are caught; every mutant completes all100
tests normally rather than being counted as killed by a loader/compiler crash:
wc character loss(10 failures), partial sort publication(3), reversed byte
sort(10), env merge instead of replacement(5), old env insertion order(1),
discarded cksum algorithm(15), and ignored realpath relative base(1).

## Environment accounting amendment — still open

The exact two remaining cases from Sagan's
`tests/shell-stress/env-replacement/ACCEPTANCE.md` are retained, not waived.
`env-accounting.mjs` independently runs actual Shell/agentCommands on complete
source archives from before the integration (`bdaaf50b`) and after (`954f230`),
not a current-import mixture with one replaced runtime module. Both archives
return **9/18 pass,9/18 fail**, process exit1. There are two original failed
cases plus seven additional manifestations of the same accounting defect,
not nine distinct bugs. Evidence: `evidence/env-before-after.json`.

1. **Raw native order:** `env -i A=1 B=2` remains `B=2\nA=1\n` in the product,
   versus Apple env's `A=1\nB=2\n`. Both have empty stderr/status0 and unchanged
   files. Fresh isolated direct captures of GNU coreutils9.7 and Apple env,
   using identical literal argv, confirm both profiles in
   `evidence/env-dialects.json`. GNU gives the product order. The original Apple
   row stays failed; the approved GNU insertion rule is not reversed, normalized
   or mislabeled as Apple parity. No core env source fix is justified here.
2. **Original output witness:** `env -i tick`, where each tick writes `1234`
   then invokes another tick with replaceEnv:true, under maxOutputBytes10,
   still dispatches twice and emits four bytes rather than three dispatches/
   eight bytes. Both raise typed ShellLimitError(maxOutputBytes). This is
   pre-existing, reproduced on both complete archives.

Minimal actual-API reproduction, with a single intended four-byte output:

```ts
const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
shell.register({
  name: "bridge",
  execute: context => context.invoke!("printf", ["1234"], {
    stdout: context.stdout,
  }),
});
await shell.exec("bridge", { limits: { maxOutputBytes: 4 } });
```

This throws before delivering any bytes. Omitting stdout, or supplying a
genuinely new external sink, succeeds with exactly four bytes under the same
limit. The 18-case audit also covers omitted/false/true replaceEnv values,
nested forwarding, repeated use of the same Uint8Array, and actual pipelines.
Omitted and false retain the original merge semantics in the separate actual
runtime tests; this audit does not redefine them.

**Contract finding:** `src/contracts/command.md` requires shared output budgets
and unchanged stdout/stderr transfer, but neither it nor ShellLimits explicitly
defines the accounting unit. Existing Budget.sink charges a write before calling
its downstream sink. Runtime.invoke wraps every explicitly supplied sink,
including the exact already-budgeted context sink. Thus the same forwarded
write is charged at multiple wrappers. The user's transparent-forwarding
requirement makes this a runtime defect, not an invitation to relax the limit.

Positive controls retain distinct accounting: a producer and consuming pipeline
stage each writing four bytes require eight budget bytes; limit7 fails, limit8
passes. Three writes of the very same four-byte Uint8Array under limit10 still
fail on the third, after eight delivered bytes. A new external sink is budgeted.
No content/buffer-identity deduplication, final-output-only accounting, relaxed
budget, or caller workaround was implemented.

**Route to root/Sagan:** consider an identity-preserving forwarding path for an
already-accounted contextual sink while retaining cancellation, fresh-sink
accounting, separate stage/writes and precharge behavior. This is a candidate
minimal repair, not an implemented or accepted runtime change. Runtime remains
Sagan-owned; this checkpoint does not close his unchanged23/25 cohort.

## Independent sort measurement

`performance.mjs` freezes the same5000-line input and original harness/golden
recipe, checks native GNU sort+uniq output, and requires stdout/stderr/status/
filesystem equality before accepting any timing. Before uses `b5ec52a`; after
uses that same source plus only `f3eb0fe` text.ts. A separate untimed reviewed
source control also passes. Installed comparator is pinned just-bash3.4.2.

Two cycles of all six execution-order permutations produce12 fresh-worker
samples per variant (36 timed trials), each with one warmup. All36 timed trials
and four controls are equivalent. Independent medians on Node22.22.2/macOS:

| Variant | Median execution ms |
| --- | ---: |
| Before optimization | 40.672 |
| Optimized | 10.811 |
| just-bash3.4.2 | 6.320 |

The local improvement is reproduced; **just-bash remains faster on this input**.
This does not validate the author's exact37.873/9.241/5.725 medians or broad
superiority. Host load is shared/uncontrolled and recorded per sample; virtual
source TypeScript versus bundled comparator and sampled synchronous-memory
peaks remain limitations. Runtime, source/bundle/lock/input hashes, orders and
raw measurements are preserved in `evidence/performance.json`.

## Validation and source boundaries

| Scope | Result |
| --- | --- |
| Original954f230 six / actual runtime / focused author cohorts | 6/6;10/10;111/111 |
| Independent100 on954f230 + owned overlay | 100/100;7/7 mutants detected |
| Adjacent direct worktree command tests | 152/152;zero skips/TODO |
| Frozen954f230 + overlay all-source/independent-test typecheck and isolated build | Both exit0; input hashes unchanged |
| Newer committed280815c six / actual runtime / focused author cohorts | 6/6;10/10;111/111 |
| Newer committed280815c selected typecheck / isolated build | Both exit2; unowned shell TS2412 |
| Concurrent worktree global noEmit | Exit2; same shell diagnostic; not a frozen global pass |

The newer committed snapshot includes other authors' intervening shell work.
`src/shell/runtime.ts:1120` assigns `"bash" | "sh" | undefined` to an optional
`"bash" | "sh"` property under exactOptionalPropertyTypes. This error is routed
to Sagan, not repaired outside ownership. Its build emitted files despite
exit2; the ensuing root-package smoke passes but is **not a successful build**.
Raw failures are retained in `evidence/replayed-env-fixed.json`; the narrower
passing source snapshot is not substituted for that failed integrated build.
The separate scope validations/logs are in `evidence/validation.json`.

Reproduction (run from repository root):

```sh
node --unhandled-rejections=strict --import tsx --test tests/commands/core-regression-stress/*.test.ts
node --import tsx tests/commands/core-regression-stress/verify.mjs --mutants
CORE_AUDIT_SOURCE=/path/to/archived/source node --import tsx tests/commands/core-regression-stress/env-accounting.mjs
CORE_GNU_BIN=/path/to/coreutils-9.7/src node tests/commands/core-regression-stress/performance.mjs
```

The 100-test cohort uses frozen native expectations and runs without GNU tools. Capturing new
native evidence or the performance reference requires the pinned GNU binaries;
do not replace them silently. The env audit intentionally exits1 until its
two original unmet expectations are addressed under their explicit profiles.
Old failed measurements are immutable; no expected output was adjusted to fit
these production changes. Isolated temporary snapshots are retained as named
in reports; no watcher or running test child remains at handoff.

This is a bounded checkpoint, not broad superiority, the full224 benchmark,
all shell/backend closure, or measurement of the50 baseline-only names.
