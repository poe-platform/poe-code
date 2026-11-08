# Post-capture observations — original freeze remains unchanged

These are analyses of capture-01, not new native runs, corrected executable
controls or candidate acceptance. Both original Bash5.3 expectation failures stay
failed. No frozen file or captured output is changed. Primary remains14/16 and
historical remains9/16 against the selected5.3 expectations.

## N05: repeated local declaration assumption

The frozen script enters a function with caller cursor after `a`, scans `b`,
declares `local OPTIND=1`, scans `a`, then repeats `local OPTIND` without a value.
Frozen expectation for the next scan was `b`/OPTIND1. Actual Bash5.3 and Bash3.2
both produce **`a`/OPTIND1** for that repeated-local step. This specific repeated
declaration assumption was a reviewer oracle error. It does not show that the
function-entry snapshot was replaced: Bash5.3 resumes the caller at **b**, whereas
Bash3.2 resumes at **a**. The5.3 entry snapshot invariant remains supported by this
script's actual resumed observation; the repeated declaration resets the active
local scan in this scenario. Do not generalize to every local declaration form.

Exact records: `capture-01/bash53.json:364`, `capture-01/bash32.json:369`.
Original mistaken expectation: `corpus.mjs` N05, preserved by the freeze commit.

## N13: no-argument transition is not EOF deletion

The frozen script declares readonly `OPTARG=old`, scans `-a value` under `a:b`,
then scans `-b` with no required argument, then reaches EOF. The expectation
incorrectly predicted OPTARG would already be unset after `-b`.

Both native profiles actually produce:

| Step | Status | Option | OPTIND | OPTARG |
| --- | --- | --- | --- | --- |
| Required value set attempt |0|a|3|old, still set|
| No-argument b |0|b|4|old, still set|
| EOF |1|?|4|unset|
| Subsequent ordinary unset |0|?|4|unset|

There are **two** readonly diagnostics, for the required-value and no-argument
steps. Bash5.3 reports script lines3/4; Bash3.2 reports lines2/3. Raw stderr is
preserved; these profile line differences were not normalized into byte parity.
The native deletion quirk occurs at EOF here, not at the preceding no-argument
step. The original broader assumption was a reviewer oracle error.

**Root's stronger policy still forbids the EOF deletion and attribute removal.**
No captured native result authorizes unchecked unset. Preserve `old` and readonly
through getopts unset intent; exact failure status and other partial effects stay
pending D01. This document does not redefine stronger readonly as native equality.

Exact records: `capture-01/bash53.json:862`, `capture-01/bash32.json:867`.

## Separate Bash3.2 differences against selected5.3 expectations

Seven scripts mismatch: N03,N04,N05,N12,N13,N14,N15. N05/N13 include the two
reviewer assumptions above. Additional captured differences are:

- N03: after the for-assignment reset,3.2 produces b rather than5.3's a.
- N04:3.2 prefix/restored/next produce b/1, c/2, EOF?/2 instead of a/1,a/1,b/1.
- N05: caller resumes a rather than5.3's b, independently of the repeated-local
  expectation error common to both profiles.
- N12: readonly destination option calls return1 rather than5.3's2; EOF remains1.
- N14: readonly read reports0 then next a, versus5.3's read status1 then next b.
- N15: caller resumes a and bare-readonly next b, versus5.3's b then c.

These are historical profile observations, not candidate failures, not newly
approved product behavior and not a reason to erase either raw capture.
