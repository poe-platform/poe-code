# Candidate-binding diagnostic fixture v2

This root-authorized test-only migration changes exactly one assertion from
39116ae1's unchanged21-control cohort. The fixed product remains explicitly
frozen at **a01310c5571dfda2aae4c6c8cc185e2530a01e89**.

Old assertion:

```js
assert.match(result.details.result.groups[0].error, /candidate build/u);
```

V2 assertion:

```js
assert.equal(result.details.result.groups[0].error, `foreign candidate declaration/source fallback: virtual-bash -> ${join(snapshot, 'src/index.ts')}`);
```

Equality identifies the binding rejection, exact public package and actual
candidate source path. It cannot accept an arbitrary nonempty error, a compiler
failure, another package/path or a message that only contains this text.
The same test still requires compiler exit0 and helper exit2. Every other byte
of the cohort is unchanged: cases, inputs, statuses, remaining20 controls,
full-command branches and snapshot/cleanup machinery.

The original20/21 capture and its assertion remain sealed in39116ae1. Product
repair acceptance, the full mixed-package warm-command rejection and nearby
semantic controls remain that separate independent review, not a new product
fix here. No production/configuration or original author fixture is edited.
Root/Curie reviews this fixture delta; author-run v2 results do not self-certify it.

```sh
node tests/integration/typecheck-workflow-message-v2-20260827/cohort-v2.mjs /tmp/NEW-V2-OUTPUT
node tests/integration/typecheck-workflow-message-v2-20260827/diagnostic-controls.mjs /tmp/NEW-V2-OUTPUT /tmp/NEW-DIAGNOSTIC-REPORT.json
```

The diagnostic controls extract the actual v2 rejection capture, then run the
exact fixture assertion against that diagnostic and eight negative neighbors.
They also verify that weakening the line to accept any nonempty error fails the
unrelated-compiler-error control. These are assertion controls, not additional
product runtime tests. Actual results and the fixture commit will be recorded
in a separate evidence commit without rewriting historical captures.
