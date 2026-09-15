# OMML resumption evidence

The sole contract is [docx.md](../specs/docx.md). The execution procedure and exact
ownership are in [the task-76 resumption plan](../plans/docx-task76-resumption.md).

Baseline main is `6a1363cde1879832230833d0a70b164f730ac014`, with an empty index
and 33 pre-existing modified/untracked paths. Existing task work is not evidence
of accepted implementation. Tasks 77–107 remain pending.

The preparation snapshot has changed: the manifest now has 23 real documents
and the API inventory has 920 research records. The preserved test inventory
still contains 1,609 unit variants and 650 BDD examples. Neither acquisition nor
accounting proves passing product behavior. Current input hashes are:

| Input | SHA-256 |
| --- | --- |
| `docs/specs/docx.md` | `5a6b004d6d2b0e1d67553984c480727d98d7949d6e4cf2c03fbc831ef20974a3` |
| `docs/specs/office-cli.md` | `cb5614e03c841f31d98efe4bcf2aabdb419926aa26775d17b401598d9a2d74ce` |
| `docs/specs/office-sdk.md` | `1b2dd9f411621ebdc6ce24974e48f6143e0d3c9fe1191200207dfd6a3ddbfe64` |
| `docs/docx/corpus-manifest.json` | `e77009a4942a6841184076ad7eb401725476ef5d8bc18ea74b1a5444acfb4b1f` |
| `docs/docx/upstream-api-inventory.json` | `10955a17b17ac1b334c5854ce7048970f9033ddb0408322bef3e3586d19e44ac` |
| `docs/docx/upstream-test-inventory.json` | `14c609ceb775158cb36c0423d24678b4a3e9f09d429085730b28103a759ad797` |

## Initial verification

The read-only adapter leaf retained bounded 120-second/64-MiB receipts:

- Three actual Shell tests passed: both dialects, fragment stdin, VFS script,
  binary output and stale selection behavior.
- Nine adapter/schema tests passed across two files.
- One exact normal-discovery literal-registration test passed. Its authenticated
  discovery count is membership evidence, not 1,144 executed passing tests.

Receipts are `/tmp/docx76-resume-adapter-{shell,contract,registration}-v1`
with separate JSON/stdout/stderr files. No tests were skipped.

Maintained `npm run lint --workspace=docx` failed on three test-type errors:
the schema `items` union needs an explicit narrowing, and two command contexts
lack required `args`. A pre-existing type-only unused-variable warning remains.
Independent domain probes also found native property leaves under unsupported
math-property contexts classified as stored, and a selected transparent MCE
paragraph host refused for equation add/replace. Those require original failing
canonical tests before correction. Probe receipt:
`/tmp/docx76-resume-review-probe.json`.

The completed independent review additionally found omitted matching
WordprocessingML run-property snapshots associated directly with a math run.
All three findings and acceptance qualifications are retained in
`/tmp/docx76-resume-review-findings.json`.

The first maintained full DOCX run overlapped new canonical RED test additions:
2,848 tests passed and three newly added wrong-context assertions failed across
134 files. It is RED evidence, not approval of a frozen candidate. The selected
maintained DOCX build closure passed five declared builds. Two portable public
export/runtime-closure tests passed through the maintained root focused route.

No corpus operation, rendered-document measurement, screenshot inspection,
complete guarded workspace gate or whole-public-model parity follows from these
focused results. Downloaded inputs remain disposable preparation material; no
reference passages, media or identities enter product tests.

## Corrected original candidate

Original canonical REDs preceded fixes for native property contexts, associated
Word run-property snapshots and selected transparent native paragraph equation
editing. A targeted append authority preserves generic/inactive/foreign insertion
refusal. Both dialects retain XML framing and inactive siblings. Identical-byte
replacement was tested with both `allowEmpty` values and matched existing common
behavior; no no-op defect was validated or code changed for it.

The maintained full DOCX suite passed **2,860 tests across 134 files**. The final
bounded help correction then reproduced two failing assertions and passed all
20 discovery tests. It derives the selector guide from declared option fields;
token-only equation edits no longer advertise simple selectors. Maintained DOCX
lint passed after both corrections, including source and test type checking.

The dynamically collected actual DOCX Shell family passed **130 tests across
22 files**, with no skips. This is focused canonical semantic evidence, not the
full safe-bash npm workspace unit suite. The maintained runner does not consume
`SAFE_BASH_TEST_RG`; no selector was synthesized. Maintained safe-bash selected
build and `typecheck:all` passed the declared build/source/test/strict-consumer
closure. Compile-only consumers establish no runtime execution.

Root and independent reviewer actually inspected normal Shell help, human list
and rejected-scope screenshots. The first help capture remains failure evidence;
the corrected help-v2 capture is readable and has the required token-only footer.

Different-worker approval is `/tmp/docx76-resume-review-approval-v4.json`, SHA-256
`dd655f09150abf2d914f0a859249909cf59574882942fc35620ebca9922aff57`.
It verifies 24 original both-dialect probes and an append-aware 316-file frozen
candidate with no pathname/hash drift. It approves the bounded original product
candidate only. Corpus QA, final root gate and whole-public-model parity remain
separate; task implement/test statuses are not promoted by this approval.

## Default-profile corpus outcome

The admitted read-only source is the manifest-pinned inventory volume 1,
20,543,015 bytes, SHA-256
`b2470c666193fe39e2f308ed7cd63a9be15da5fd2e7cceb0d8451baf6106148e`.
Its historical census reports 45 expressions; the product did not verify that
count. No corpus passage, image or binary was promoted into canonical fixtures.

The public TS inspector refused `limit-exceeded` before XML accounting. Archive
admission attempted to charge 32,484,313 expanded bytes × 64 = 2,078,996,032 work
units on top of 164,344,120 already charged. The projected 2,243,340,152 exceeds
the unchanged default 536,870,912 work ceiling. Recorded retention was
135,395,996 bytes; this is a work refusal, not XML/retention corruption.

The first Shell attempt failed in QA setup because the VFS's default 16-MiB
per-file ceiling was smaller than the input. That construction failure remains
separate. With an explicit 64-MiB QA VFS file ceiling and unchanged product
defaults, actual normal Shell returned exit 4, `limit-exceeded`, affected zero,
no locations and an unchanged input hash. No raised product retry occurred.

Because default admission failed, no corpus text edit, output archive, equation
snapshot equivalence or OMML-preservation pass is claimed. The generated archive
leaf was never created, so there is no owned generated binary to clean up. The
existing download stays immutable for future explicitly qualified campaigns.
This bounded refusal is not a validated product defect requiring a new regression;
original deterministic canonical tests remain independent of the download.

Different-worker refusal-accounting approval is
`/tmp/docx76-resume-review-qa-outcome-v1.json`, SHA-256
`e18949a654adda5b96f4dfd8519fa6953746ad94e73ba28647725dedd82612a0`.
It confirms the exact arithmetic, profile, unchanged source/candidate, separate
construction failure and absent generated leaf. This approves evidence accuracy,
not successful product corpus qualification.

Task 76 corpus qualification remains unresolved, and tasks 77–107 stay pending.
No task state, format conformance or full SDK parity is promoted by these results.

## Final root gate limitation

Maintained `npm run lint:eslint` remained running with no final output at a
measured 610 seconds. Root manually terminated only its authenticated owned lint
process after the 600-second intended ceiling; the command exited 143. This
tool-runner/manual-poll supervision was not the leaf's external watchdog profile.
No completed traversal, error count, receipt count or complete root-lint pass is
claimed. The final root gate remains pending; its timeout is preserved alongside
passing maintained package lint and consumer type checks, without a bypass or
retired-tracer fallback.
