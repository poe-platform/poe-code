# csvcut user edge QA

Run the maintained csvkit unit and lint commands, then the selected safe-bash
workspace build closure. Execute csvcut-stress.test.ts, csvcut-user-edge.test.ts
and csvkit.test.ts using the maintained Node/tsx test engine. Check integration
discovery with scripts/integration-inputs.test.mjs.

Compare stdout and stderr bytes and status against frozen raw observations.
Exercise parser exits without reading stdin, reject omitted inference flags,
and cancel pending cooperative stdin with a falsey reason. Confirm exactly-once
cleanup. Exercise tab precedence, custom quote/escape characters, negative
skip-lines, BOM names, zero-based numbering and partial output before field-size
errors using in-memory domain tests.

Retain quoting modes 2, 4 and 5 as explicit blockers. These checks do not establish
full csvkit parity, native terminal behavior or injected database compatibility.
