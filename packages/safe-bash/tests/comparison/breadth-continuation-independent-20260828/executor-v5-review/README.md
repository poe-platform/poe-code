# Independent V4 resolver diagnosis / pre-handoff expectations

August 28, 2026. **READY FOR NARROW AUTHOR HANDOFF — NOT V5 ACCEPTANCE.**
No successor source was read. No fresh grant, actual admission, C11, semantic GO,
product/comparator import, native oracle, archive staging/extraction or timing run.

## Finding for Raman

V4 `executor-v3/projection.mjs:96` and `:123` put target `consumer.mjs` above
`node_modules/virtual-bash` without its own package scope. At recipe
`b993d26cd6777567ab6de45c617f1b073dd0d1de`, `executor-v4/worker.mjs:44` imports
that exact consumer; `executor-v3/loader.mjs:30` uses Node resolution and `:31`
rejects the returned live checkout URL. Source paths in this paragraph are beneath
`tests/comparison/breadth-continuation-20260828/`.

Failure commit `d40af0d52381a138f2dabb415d343526ad015722` actually records:

- Specifier: `virtual-bash`.
- Parent: `file:///Users/kjopek/Workspace/safe-bash/tests/comparison/breadth-continuation-20260828/executor-v4/runs/admission-v4-01/views/target-installed/consumer.mjs`.
- Forbidden result: `file:///Users/kjopek/Workspace/safe-bash/dist/index.js`.

The nearest enclosing package is the repository's same-name `virtual-bash`, with
root import export `./dist/index.js`. Package self-reference explains the recorded
URL; cwd does not establish resolution. Consumer returned-source evidence exists,
but **zero product source witnesses / zero successful export evaluation**. This
is a harness scope failure, not a product behavior result. Exact source/receipt
hashes, authenticated original config fields, and metadata-only projection facts
are in `BINDINGS.json:1`; the full callpath and inference boundary are in
`PRE-SUCCESSOR.md:24`.

Minimal repair expectation: exact known wrapper bytes at the consumer scope,
name distinct from **both** `virtual-bash` and `just-bash`, incorporated into both
target projections and authentication before resolution. Keep package/source
hash+mode checks, strict URL membership and physically absent moved origin.
Treat known worker→consumer entry-parent admission separately from the later
consumer→bare-library edge; do not broadly allow unbound parents or alias imports.
Reseal the changed recipe/authorization dependencies; never reuse the old grant.

Our concrete fixture wrapper is exactly the following UTF-8 line plus LF:

```json
{"name":"safe-bash-breadth-consumer-fixture","private":true,"type":"module"}
```

**77 bytes, mode0644, SHA256
`3e46acb281e826bed6c5fdbeaccc90c8744312a54021adb3fbffe7ba389e444f`.**
Raman may choose another concrete spelling if it is distinct from both libraries
and its exact bytes/size/mode/hash are bound. This is not a naming mandate.

## Immutable independent boundary and results

- Source/expectation freeze: `bfff3dfed06d9144c82652246251f654c8bd26e7`, committed
  `2026-08-28T11:47:56Z`, before any synthetic execution.
- PRESEAL SHA256:
  `a1fd3018e3a0a63567ee8709766c1073bb48e6755701cf0a24609df9e6eb6074`.
- RESULT SHA256:
  `597a067d71ddc75c8e6fbcec6404e076a18d3e2f7831708a507178a69311f84c`.
- REVIEW SHA256:
  `6d2c9fe9b06512471c5868efc30417c627fac3513df9bc6db32fb1a51added7f`.
- Bound actual entry worker SHA256:
  `027493c30177e9d1a0e3730b1424d36c096b905d80d7ec747eff255cff09de62`.

Successor directory appearance was observed at11:44:35Z, before this freeze;
contents were not read. Thus **pre-handoff/pre-execution, not pre-appearance**.
No claim is made that the author had not already prepared a successor. The source
seal records this explicitly, rather than retroactively claiming independence
through an earlier commit date.

One frozen invocation, no retry or rebaseline: **15/15 SYNTHETIC expected outcomes,
four positive imports and11 deliberate negative rejections, zero unexpected
failures/unrun**. Exact matrix is `EXPECTATIONS.json:1`: target/baseline bare
exports, cwd independence, enclosing self-reference, missing scope resolver and
preflight, both forbidden wrapper names, intended-but-unbound target, actual
physical move, source and wrapper hash/mode tampering, and wrong entry parent.

Four children exit0/close0; eleven negatives exit23/close23 with their exact
expected errors. **15/15 children reaped with PID/group absence**, no signals,
no supervision failures, empty stderr. All negative evaluation sentinel arrays
stay empty. Supervisor26015 also exits0 and its exact PID is absent; it was not a
detached owned group, so no supervisor-group absence claim is made.

Invocation (already consumed `capture-01`; refuses overwrite):

```sh
/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node --unhandled-rejections=strict --max-old-space-size=64 tests/comparison/breadth-continuation-independent-20260828/executor-v5-review/run.mjs bfff3dfed06d9144c82652246251f654c8bd26e7
```

Capture interval11:48:07.247Z–11:48:12.695Z is bookkeeping, not performance or a
72-hour claim. Syntax checks passed for the two independent `.mjs` files. Node
version/binary hash and seven frozen source files were checked against the commit;
postchecks again found all seven unchanged and22/22 selected readonly V4 source/
evidence files equal to their inspected commits. These are selected-file checks,
not append-proof whole-repository or continuous integrity guarantees.

`POST-CHECKS.json:1` records raw postcheck facts, foreign status and empty index
at that observation. `EVIDENCE-MANIFEST.json:1` binds all final owned regular
artifacts except itself and records directories/modes. Captured `.mjs` and
`node_modules` trees are **synthetic data only**, never imported by canonical
tests here. Mode0600 negative artifacts and the empty foreign-cwd directory are
recorded physical capture facts; Git preserves executable bits, not arbitrary
permission bits or empty directories. No claim that checkout alone preserves
those physical properties. Runtime fixture construction applies exact modes.

## Preserved limits and handoff

V4 remains **UNSAFE_STOP, first/14, 0qualified,0C11,0semantics**; grant
`c1b03b641aa51f36e1461973e6d635103e1ef1e5` is consumed. Probe/coordinator exit1,
natural unsuccessful termination and reap stay unchanged; receipt `natural:false`
literally reflects V4's success-only `settled()` predicate, not a termination
signal. All3 postguards/full-pack/comparator3843+instruction-metadata evidence is
**PROJECTION ONLY**, not runtime qualification; not rerun by this leaf.

Original35/44/nine failures,400/402,391/394,13/54 versus47/54 remain untouched.
Original target67eab12e315054907ef4ef435c6bbca2f59e0c36 and pack6608d255828d1a4f3b2810ef6c32a2b0b57a9aaf0dd685597ce6725d381d6e06
remain the reference; comparator3.4.2 is pinned, not latest. Prior independent
V4 preexecution29/29/five children was not actual admission. No instruction-member
plaintext was read, and no archive was decompressed or staged.

Ready for Raman's explicit narrow source/recipe handoff. These independent
expectations support inspecting that future handed candidate; they do not approve
it, supply a root grant, or authorize any real-engine run or99-case cohort.
