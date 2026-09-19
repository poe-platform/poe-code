# SDK capability user review, 2026-09-18

An original in-memory regression reproduced a CLI/SDK mismatch for `csvgrep`
match-file capability admission. With no injected opener, argv execution returned
78 and the explicit capability diagnostic, whereas the typed request rejected
with CsvkitBlocked. SDK acquisition refusals now use the shared engine diagnostic
path. Malformed SDK settings still reject; caller cancellation retains its exact
reason. No capability is enabled implicitly.

Additional cases verify an injected host policy refusal, no stdin acquisition,
zero-byte output capacity, and cancellation whose reason is itself CsvkitBlocked.
The zero-output refusal remains status 78 rather than a compatibility pass.
Compiled `@poe-code/csvkit` and `poe-code/csvkit` imports identify the same engine
and reproduce the exact diagnostic bytes/status without reading input.

Independent actual-Shell review added three in-memory input cleanup tests:
registered named-source cancellation waits for delayed return, source EOF cleanup
failure retains prior stdout and fails, and arbitrary borrowed stdin preserves
its documented interruptible return boundary. The initial stronger stdin
expectation was rejected against the existing contract; no ownership expansion
or shared-shell repair was made. The exact new test path is registered in the
maintained integration-input inventory.

The initial independent four-file input/byte/SQL review passed 13 tests without
creating files or invoking subprocesses, network or real databases in its new
cases. Its initial borrowed-stdin assertion failed because it required awaiting
opaque upstream return on cancellation, contrary to the "Authorized core repairs
and final focused handoff" contract in `packages/safe-bash/src/contracts/tail-follow.md`.
The corrected assertion preserves that boundary. Named-file EOF return failure
retains `a\nx\n` stdout and returns status 1 with
`shell: line 1: internal error\n`, with exactly one return including disposal.

Uncached verification:

- Domain unit route: 89 files, 4,136 passed, one skipped and six TODOs excluded.
- Domain lint: ESLint and product/test TypeScript checks passed.
- Selected csvkit build closure: four declared builds passed.
- Selected safe-bash build closure: eleven declared builds passed.
- Safe-bash maintained runner route: 536 passed.
- Five focused Shell files: 33 passed, exact output/status/cleanup assertions.
- Maintained safe-bash typecheck: source/tests and all 26 current public consumer
  groups passed, including expected negative-consumer rejection. This checks
  declarations, not runtime compatibility.
- Final guarded repository ESLint: complete, exit 0, all 16,006 configured
  subjects linted, zero errors and two unrelated docx warnings. All 18,066 input
  opens closed; no guard gaps were reported.
- Compiled domain/root SDK smoke: passed.
- Actual compiled SDK diagnostic screenshot: visually inspected, readable and
  unclipped, showing the capability refusal and status 78.

A requested focused safe-bash package test invocation used a selector environment
variable that this direct package runner does not implement. It therefore began
the full discovery and was deliberately interrupted (exit 143); it is not a
complete suite pass or failure tally. The explicit five-file Node test invocation
above supplied the intended scope. Existing other processes were preserved.

The first complete guarded repository lint checked all 16,006 configured
subjects and failed with one `require-yield` error in the new fail-on-read test
generator and two unrelated docx warnings. The test author added an unreachable
yield after the intentional assertion and reran all three new lifecycle cases
successfully. The complete rerun passed as recorded above. The initial lint
failure is retained rather than credited as a pass.

This review does not establish all-edge-case coverage or full csvkit 2.2.0 parity.
Existing unqualified quoting, codecs/locales, numerical, workbook/DBF,
Python/Agate/IPython and real driver/service profiles remain explicit blockers.
No README content, ssconvert-plan changes, staging, commits, pushes or publication
were performed. This review's temporary screenshot driver, PNG and final lint
log were purged after reduction and inspection; unrelated evidence was preserved.

Procedures: [SDK review](../plans/csvkit-sdk-capability-user-review.md) and
[independent input review](../plans/csvkit-input-lifecycle-user-review.md).
