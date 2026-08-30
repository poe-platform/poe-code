# String length candidate handoff

Candidate source commit:
`74361026502d76b8c2b696f9c60e410ac9b78d95`. It contains only
`src/commands/structured/interpreter.ts`, blob
`d3ba11f0057b07d5ad307c5dfbb5f0612a87a047`, SHA-256
`e32ad45efe69544ed95b43b97f191006f10d3beea9ca9e2a3327843dffd45a74`.
Relative to baseline blob `f7e0dfcb1815aa90ae49d495e453b4d069139108`,
the string arm alone changed from `Array.from(input).length` to a direct
non-retaining `for...of` counter. No charge, check, signal observation, await,
scheduler yield, API, import, export, other branch, parser, query core, or yq
source changed.

Author fixture freeze:
`6db95e8935cac95fc8ad314f9e7fdf4453c1c5e1`.
Baseline evidence commit:
`ae03ec319a7540a92b2dbe318f2fc542459db47d`.
Candidate evidence commit:
`f233a14b2680cdb621a13b92e540dac0b8b769ef`.

The fixed candidate source archive is `evidence-candidate-v1/SOURCE.tar`,
SHA-256 `9b9b7c8a7e4c117c2348dfcbc06be64f6dc569301182142122e806d8c7282625`.
Its 269-entry manifest SHA-256 is
`061505eb9501b094074c82eb6b8b01e545bedb4aec7280ec9a4d408219897c3a`.
The recipe is baseline commit
`5137a74ec855a32d8a8860eb66b62eb44d11e290` regular build/test inputs plus
only the exact candidate interpreter overlay; no ancestry claim or mutable-HEAD
source is used.

The real offline-installed and physically moved `virtual-bash@0.0.0` package is
`evidence-candidate-v1/package/candidate/virtual-bash-0.0.0.tgz`, SHA-256
`351e03ad72b0bd82bb16d97cc50ec80b136edeaf705ec1590b414cb4cdf8b82e`.
Bound loaded module hashes are:

- `dist/index.js`: `37a94a97433b8d5b654696d1c1332c88b3aeb63fd963a51a997568d4295904a7`
- `dist/commands/structured/interpreter.js`: `cc86b7c89e05046aa989c9828444f30907c2d67b00d587c73469108ac2057540`
- `dist/commands/structured/limits.js`: `f6005af75948816c4d323d4610b112bf87cb3fb7b69d0fbd18538ad3df47b149`
- `dist/commands/structured/numbers.js`: `e54edb0ffa9fa261f18e6474b9bd2c90672d46e50adea28790d6dc048cc5200c`
- `dist/contracts/errors.js`: `18a4a05815e6673dff47a7ffe8caa43b9a8d3c97f67571bebb9d562b1703aa6f`

Results: strict source build and isolated installed-consumer typecheck passed;
41 direct, 18 installed-public, and two moved-package author groups passed with
zero overlap; 91 selected semantic/prototype/order and two exact resource tests
passed. Both binding tamper controls were rejected. The candidate sentinel did
not call `Array.from`. The exact one-arm reversion produced package SHA-256
`2e8d7945a27fb9606d79cb8731553ce0e78f27fcbbf96e1629d3835401564456`,
failed the candidate assertion, and passed collecting characterization.

The independent 60 baseline groups remain historical and unrescored. Their
baseline finding remains collection DETECTED / desired noncollection UNMET and
not accepted. All author child processes exited without signals; scratch was
removed. No native/reference run, RSS/heap measurement, whole gate, yq work, or
independent acceptance is claimed. Root should route the exact candidate,
archive manifest, and package binding above to Plato.

