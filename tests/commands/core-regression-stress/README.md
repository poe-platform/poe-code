# Independent core regression checkpoint

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

This is a bounded checkpoint, not broad superiority, the full 224 benchmark,
all shell/backend closure, or measurement of the 50 baseline-only names.
