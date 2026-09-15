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
