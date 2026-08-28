# String length author protocol

Frozen August 28, 2026 before the product candidate. This author packet is
bounded to the string arm of `Interpreter.call`'s `length` branch. It preserves
the independent packet at `20351e9920f89cc2a07a98eb24ac062f42be78ad`, its
runner correction `fed806142b311a4b79b39806400238100b619ad8`, and its recorded
baseline evidence `c05ea6edf5189772f7210520fbd464c94c290e58` unchanged.

The authoritative source baseline is
`5137a74ec855a32d8a8860eb66b62eb44d11e290`, even though it is not an ancestor
of the authoring HEAD. Its interpreter blob is
`f7e0dfcb1815aa90ae49d495e453b4d069139108`, SHA-256
`bac1cf5325eff5bfa69f1c8bec5d3d8a80bb452fd61cdc802d55a26788acaffc`.
Reconstruction selects regular baseline Git blobs and overlays only the exact
candidate interpreter bytes. It neither uses mutable HEAD as source nor asserts
synthetic ancestry.

The frozen direct cohort uses the independent literal vectors: 17 strings, 12
successful non-string inputs, two Boolean errors, six exact pre-abort reasons,
and four trusted iterator cases. Successful direct calls remain one existing
entry tick under `maxSteps:1`; the loop adds no charge, await, check, or yield.
The installed public cohort has 18 command observations. The moved cohort has
one private `Array.from` discriminator and one different Shell/VFS workflow.
These cohorts do not overlap and their denominators must not be added to the
independent reviewer's 60 baseline groups or 93 selected regressions.

The tiny sentinel is `L😀é`. Worker-local instrumentation throws only for that
exact primitive string and delegates all other inputs. The wrapper's direct
control must throw; a `for...of` control must return four; a similar wrong input
and `Array.from([7])` must delegate. The original descriptor is restored in
`finally`. Baseline candidate expectations and the later exact reversion mutant
are intentional captured failures, not accepted results.

No native jq/yq/reference process, RSS/heap sampling, oversized string, private
package, dependency fetch, yq file, parser, query core, public API, budget, or
root wiring is part of this packet. The selected existing regressions are the
91 semantic/prototype/order tests and the exact two resource tests named by the
independent protocol. A native-process denial preload guards those runs.

Run only into a new direct child of this directory:

```text
node tests/commands/structured-length-author-20260828/reconstruct.mjs baseline tests/commands/structured-length-author-20260828/evidence-baseline-v1
node tests/commands/structured-length-author-20260828/reconstruct.mjs candidate <candidate-commit> tests/commands/structured-length-author-20260828/evidence-candidate-v1
```

