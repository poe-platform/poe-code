# Independent bounded split-capture verification

## Verdict and exact boundary

Candidate **46abd8792bee106b0a339a3e37f238604a2405ba** passes this independent
bounded verification of the two repaired native tests and their capture helper.
No candidate repair requested. This is not a full split-writer or frozen8670 gate
acceptance. Only new files under this review directory and uniquely owned OS-temp
fixtures were written; production, author fixtures and old reports were not edited.

Native executions occurred on August 27, 2026, beginning 15:09:58.096 UTC; subsequent
read-only reconciliation completed 15:13:07.323 UTC. Node v22.22.2, Darwin arm64;
existing tsx/TypeScript, no dependency installation. No 72-hour or completion claim.

## Independent counts and simultaneous execution

| Cohort | Pass | Fail | Skip | Retained reports | Retained scratch |
| --- | ---: | ---: | ---: | ---: | ---: |
| Canonical default, both files | 4 | 0 | 0 | 0 | 0 |
| Canonical explicit capture, both files | 4 | 0 | 0 | 4 | 0 |
| Independent real-fs guard checks | 23 | 0 | 0 | Separate guard records | Fixtures retained |
| Deliberate reporting control, default | 1 | 3 expected | 0 | 3 base64 TAP diagnostics | 3 |
| Deliberate reporting control, capture | 1 | 3 expected | 0 | 4 | 3 |

Counts are not added into native coverage: the canonical reports contain 43 GNU
vectors, 20 Apple vectors, 9 GNU error vectors, and 4 cross-profile scenarios.
Repeated modes and injected failures are not new semantic corpus coverage.

Both canonical files in both modes reached the same barrier before release:
default test-child PIDs **80601, 80602**, capture PIDs **80603, 80604**. All four
were alive at release **15:09:58.208 UTC**, after their ready timestamps
15:09:58.169–.181. This proves overlapping child lifetimes and simultaneous
admission, not CPU instruction-level simultaneity. The negative pair independently
rendezvoused with PIDs 80813–80816 at 15:09:59.838 UTC. Ready/released JSON remains
in owned temp; `results.json` authenticates modes, argv, PIDs and times.

Default canonical TMPDIR is empty after completion, with no capture diagnostics;
default negatives contain only three retained scratch directories. Independent
default guard verifies no serialization or filesystem allocation; failure JSON
round-trips through diagnostics. This supports default report-write absence for
these executions; hash checks alone would not prove absence of identical rewrites.

## Capture paths and historical equivalence

Owned temp root (all inputs, failures and captures retained):

`/private/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/virtual-bash-split-independent-FJwJnQ`

Canonical explicit captures below `canonical-capture/`:

- `virtual-bash-split-capture-Rzuq1Z/gnu-errors.json`
- `virtual-bash-split-capture-Nenz1b/native-profile-differences.json`
- `virtual-bash-split-capture-iBRwpq/gnu9.7-darwin.json`
- `virtual-bash-split-capture-cQUQk2/apple-bsd.json`

All four paths are distinct OS-temp destinations, directories 0700/files 0600.
All positive/negative report and scratch paths are mutually distinct. Twelve
additional concurrent helper factories also return distinct directories.
`reconciliation.json` retains exact absolute paths, raw bytes in base64, modes,
hashes and historical comparisons for all eight positive/negative captures.

Two canonical reports are raw byte-identical to history (Apple and profile
differences). The two GNU reports match after **only** exact copy relocation:
GNU `profile.executable`, and GNU error `two-modes.expected.stderr` argv[0] in its
help hint. No status, output bytes, specimen, diagnostic text beyond that exact
path, or observed value was changed. All four then serialize byte-identically.
This is qualified equivalence, not an unqualified four-report raw-byte claim.

The first evaluator failed because its frozen expectation allowed only the profile
path, overlooking the GNU help-hint path. Its complete result/error and logs remain
unchanged in `results.json`. The first AST reconciliation then rejected the added
type-only `as const`; that failure and the original evaluator are preserved in
`RECONCILIATION-ATTEMPT-01.md` and commit 8ccb8d3f. Both are verifier expectation
defects, not product failures. Corrections were committed before reevaluation;
no native test rerun, original report overwrite or failure removal occurred.

## Real-fs guards and qualified negative controls

All 23 independent checks pass: default nonserialization, default failure
diagnostic round-trip, six invalid capture settings (including a path-valued
setting), five invalid names, three repo TMPDIR boundaries (root, descendant,
symlink alias), concurrent unique captures, and six publication guards.

Publication guards reject replaced-directory and directory-symlink identities;
existing output file, existing output symlink, dangling output symlink and repeat
publication reject with EEXIST. Original output/sentinel bytes remain unchanged;
rejected replacement paths remain uncreated. Exact guard diagnostics and paths
are retained in `reconciliation.json` and owned `guards/guard-results.json`.
The helper has no arbitrary destination argument: these tests exercise its actual
environment switch, temp-root choice and returned capture object. No hostile-host
namespace race, transaction or ABA defense is claimed.

Negative copies insert a deliberate throw after an unchanged semantic assertion
for `default-empty` and `zero-lines`. Original expected/observed/native specimen
values, production, helpers and oracle binaries stay unchanged. Each mode detects
exactly three injected failures; default diagnostics and explicit captures retain
the complete reports, and six scratch directories remain. This tests reporting
sensitivity, not a genuine semantic defect or a guarantee that every unexpected
exception reaches structured JSON publication. Original direct assertion failures
can still terminate before a later report call; TAP diagnostics are not suppressed.

## Source, assertions and native identity

The execution copy is built from **288 exact candidate Git blobs**, including all
221 `src/` files, all 63 split files/evidence, and four root package/config inputs.
There is no source fallback. Only installed tooling is linked. Native GNU is an
authenticated binary copy. Copy hashes/modes and entry inventories are unchanged
after executions and reconciliation; the separate mutation copy differs only by
the two frozen reporting injections and remains unchanged after its executions.

Independent diff/AST verification finds exactly the four advertised changed
paths. Both canonical files preserve every assertion's callee and first two
arguments (**3 + 15 = 18 assertions**), all native identities, original scenario
vectors and profile arrays. Only two final failure-message arguments change;
profiles additionally gains type-only `as const`. Cases/helpers are untouched.
The entire candidate diff and extracted original/candidate expressions are saved.

| Candidate file | SHA256 (mode 0644) |
| --- | --- |
| native.test.ts | e451f9d68b7d1ce0345b386077b8030ee76146bf34392965591091ccf23c6e92 |
| native-errors.test.ts | 258cba32a8ea4064771b40e7a14650436d293d1ea415704efcec16c450146f06 |
| native-capture.ts | 8e95ca395a8a6d323b6fa96d590658a0b5381bfae02109046578ddc9d8be6917 |
| native-capture.test.ts | 03f666fa6f13f877af7d6caeb4c7c2b71c6d5e5c2215f716af5dab039d1abda8 |
| cases.ts | e9373a71c60cf086a9a22cd8361f6a63bd0cc1e7d5d8389b7edbc03743b8dd71 |
| helpers.ts | 7a2fd1fe87851da795ce6ce21d2a4c6df1bc18f95b03146ca6ec669e291834d4 |

The native GNU binary verifies as coreutils9.7, SHA256
`cf5851c4e6566983ce69940b766c0b5eb0cd26ebf2bb45eefe215b2d5c62f958`;
Apple `/usr/bin/split` SHA256
`7c2d5f3c73e849d664bad3a2f4c67c5154b0f03f59f2fa779d49e33dc7983f91`.
Both modes remain 0755; both available and unchanged before/after. This is Darwin
qualification, not GNU/Linux evidence. Author helper-suite counts are not reused;
no additional typecheck, full gate, env-S diagnosis or strings investigation ran.

## Integrity, concurrency and remaining limits

At reconciliation, all **317 protected tracked files** (221 source + 63 split +
29 frozen8670 + 4 configs) matched before bytes/modes. Manifest SHA256 before and
after: `078d70617dd95a417b28d1856cd1358e3d67adf91cfd26eeab07a10b9725a0e1`.
All **44 historical split evidence files** also match the author's pre-repair
hash witness, independently recomputed. Split and frozen trees were re-enumerated,
so that check detects new entries, not merely changes to original tracked paths.

At final live audit **15:14:11.653 UTC**, other ongoing work had changed
`src/shell/runtime.ts` and `combined-8670ebe8/run.mjs`. Exact before/after hashes
are in `final-live-audit.json`; this verifier never writes either path. Therefore
an end-of-task unchanged-*entire-live-tree* claim would be false. The immutable
candidate execution copy, all tracked split files, old reports and frozen8670
attempt-v4 raw captures remain unchanged. Unrelated later live edits do not enter
or veto the explicitly qualified candidate copy. Original mutated gate scratch
was not run or modified; historical gate documentation states its runner removed
it. Preserved original gate artifacts remain unrescored and unqualified.

All 13 recorded child/test PIDs are absent at reconciliation; no owned processes
remain. Inputs, six failing scratches, eight captures, logs and guard fixtures
are retained. No unsafe old default writers ran. `edge.test.ts`, `stress.test.ts`
and `dangling-native.test.ts` are explicitly out of scope and are not fixed here.

## Atomic evidence history

- f2fb2155365ec1c175b0891feec6ec4d2164f1ea: pre-execution inputs, guards, barriers and hashes.
- 8ccb8d3f8c0025aca9aa97f6056bccf77fd78365: original results/failure and frozen relocation evaluator.
- abce8174f15c44198e6cf2e41df2e51bde1f22a1: retained static comparator failure and type-only correction.
- The final evidence commit contains this report, reconciliation and final live audit.

Key evidence SHA256:

- freeze.json: 0184acf695ec0203011ef4ca65e33bb4ccf8558e0b872ffa483bc392d5556520
- results.json: 5f7c500dfb9473cc6ef50b6279ba187dab8146883e8ad9ef9e1c7ef6e9aa8b6a
- reconciliation.json: 0306e34e09f2b9b877032eecd2e2ae1839121c2acbb5dc4b0021b3fe3d9db3f7

All commits use explicit owned paths and `git commit --only`; concurrent staging
and unrelated user/worker edits are preserved. No superiority, universal parity,
performance improvement or full writer-elimination claim follows.
