# Named-file prerequisite correction

The first attempted public row (04) never reached readStream: the harness had
overridden readStream but had not created /input for head/tail's stat/access
preflight. Raw `evidence/fixture-prerequisite-failure.tap` records empty events
and a failed event assertion. This is a fixture defect, not a product byte bug.

Only the named fixture changes: await creation of the literal expected bytes
in its Memory backing before overriding readStream; all call sites await that
setup. This makes metadata and content truthful and is a harness setup effect,
not a claimed product-command creation effect. No expected bytes, mutations,
case count, options, or assertions are relaxed.

Original fixtures/binding remain retrievable in commit 1fe4988 and their
source-before.json; corrected hashes use source-public-before.json. The already
proved internal shared-collect failure is unchanged and retains its raw TAP.
Product source hashes must remain identical to source-before.json.
