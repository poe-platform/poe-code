# Accepted additive Stage 1 clarification

Status: root-accepted documentation clarification only, 2026-08-27. This file
does not amend the frozen policy, evidence, helper, tests, or historical result.

When a link begins observing raw control signals and more than one is already
aborted, their earlier abort chronology is unavailable to the link. Only in
that pre-observation, multiple-already-aborted case, the accepted deterministic
fallback is the first aborted control in configured order. The selected control
is the initial delivery and control-admission origin. This says nothing about
which control aborted first in wall-clock or host-call order.

Once the link has actually observed a control delivery, that original first
delivery remains the control-admission origin ahead of other controls. Later
delivery cannot rewrite it. Root-caller and invoke-option admission precedence,
immutable delivery, ranked settlement, explicit provenance reports, and exact
reason identity remain separate and unchanged. Configured-order fallback is not
a settlement rank and does not make a captured rejection from another control
equal to the delivered control.

The accepted repair review demonstrates this distinction in both layouts:
unchanged original 12/12 and nearby N1–N4 4/4. N3 observes configured-second B
before A after listeners exist and preserves B for delivery/admission. N4 begins
observation after A and B are both aborted, exercises both host abort-call
orders with configuration A then B, and uses A only as the deterministic
configured-order fallback. Six unchanged negative rows, three prior mutants,
and two repair counterfactuals are retained as separately reported controls.
The old helper's independent 10/12 remains historical and is not rescored.

## Immutable bindings

- Accepted source commit: `fbbe1ef793b7434871403125efbeb46624a8e081`;
  tree `840983102d0ba9d0aba5c2a1662518d0f7b649c6`; helper blob
  `a7742b7f7e81bcd8c1c2a6be35092d8b5f41102f`; helper SHA-256
  `ee048f6c38086dd40573db57e002e596029174ee2afc5f888e516779e5a718ac`.
- Independent freeze/evidence/audit commits: `647f42b9abf9f5abc4de3e36c74410b3bb63df3c`,
  `61092847acc8d2c54af109a5bbeefe22146488d3`, and
  `200237e95f41ece9c2e639eb4e9c2a51dbb55345`.
- Accepted upstream clarification
  `tests/shell/cancellation-stage1-independent-20260827/repair-fbbe1ef7/DOC-CLARIFICATION-v1.md`:
  blob `95bc90d6972c6f1d3cee90fc8ed9ce6818a2e1f5`, SHA-256
  `7775bf06a6ea8b590f313ed2ed8102dab99b82f540409894a13f2bb3cd149dcf`.
- Frozen author policy SHA-256
  `89b93b92f1f7b46bf2c958f559680c079ab5e563ecd3993c9de42bc648a4f541`;
  author baseline SHA-256
  `7b5bbb67dea3b23cfe79411488471b1ec296916ba87f54abf5f5b9707b1e2ebf`;
  author repair-results SHA-256
  `bb0562d16dc0b151ad94dbe83ae093d6a634a100833bd1727ba0aa12f5d38f1f`.

Those upstream files remain byte-for-byte untouched. This bounded Stage 1
acceptance is not Stage 2 integration, public API qualification, or a timeout
command authorization.
