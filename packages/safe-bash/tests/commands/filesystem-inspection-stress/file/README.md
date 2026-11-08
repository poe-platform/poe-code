# Independent frozen file holdouts

## Latest bounded proof

[Final once-only40 replay](final-candidate-cd37ce07-execute/README.md) records
frozen candidate `cd37ce07c1f41f3797e19e0f701b662823338843`:38 raw semantic passes,
35 adjudicated passes plus3 native-profile conflicts and2 backend limitations;
80/80 semantic content views and52/60 native machine-exact views. No retries,
new native captures, full gate or whole-source safety approval. The separate
six-case safety gate remains pending, outside this evidence's acceptance.

[Per-case results](final-candidate-cd37ce07-execute/evidence/final-adjudication.json),
[native/profile comparisons](final-candidate-cd37ce07-execute/evidence/final-content-comparisons.json)
and [loaded source hashes](final-candidate-cd37ce07-execute/evidence/final-loaded-closure.json)
retain exact rows, outputs and boundaries. F07/F12/F18 are native-profile
conflicts; F30/F31 are backend characterizations, not classification passes.
SQLite's corrected MIME result is separate from TEXT and shared-Shell deltas.

The frozen internal `fileCommands`/`createFileCommands`/`createFileCommand` API was
manually bound to actual Shell. A root API/export proposal is not evidence of
public/default integration; none is approved or tested by this scoped proof.

## Preserved history

- [Original preseal](PRESEAL.json) and [artifact catalog](sealed/catalog.json):
  54 independent artifacts,40 scenarios,80 content views,109 native references;
  zero product calls during PREP. Native references are not candidate passes.
- [Original run and failures](REPORT.md):35 raw passes,3 failures,2 limitations;
  original oracle/predicate defects and source observations remain unchanged.
- [V1 correction and old-source3](corrections/HARN-SIGNAL-001/README.md) and
  [V2 correction/nonproduct controls](corrections/HARN-SIGNAL-001-v2/README.md)
  remain separate from the fresh final40.
- [READY checkpoint](final-candidate-cd37ce07-ready/README.md) remains a zero-call
  freeze/build record; its build is reused, not rerun, in final execution.

## Seal and limits

All five historical `PUBLICATION.json` manifests remain unchanged. This
navigation-only README replaces the original navigation text, whose exact bytes
are preserved in [original README](commit-seal/history/original-README.md).
[Supersession record](commit-seal/README-supersession.json) explicitly maps that
one historical manifest entry; no fixture, oracle, result or historical hash was
rewritten. [File seal](commit-seal/FILES.json) lists current owned artifacts.
`commit-seal/verify-evidence.mjs` verifies hashes and payload provenance only;
it does not import product code, rerun tests or invoke native file.

This is a bounded common-subset classifier proof, not full libmagic parity,
full-payload validation, a universal host sandbox or release/superiority claim.
Family budgets differ from shared Shell sinks; already-made host allocations,
uncooperative work and irreversible effects remain outside preemption guarantees.
Root authorizes sealing this owned evidence only. No additional replay or
productive work is authorized at the clean commit checkpoint.
