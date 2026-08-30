# Runtime v2 corrective handoff — August 28, 2026

**AUTHOR SYNTHETIC CHECKS COMPLETE; DIFFERENT-VERIFIER REPLAY PENDING; NO GO.**
This is harness correction/compatibility evidence, not YQ semantic acceptance.
No product import, execution, build, type compilation, native YAML, private
runtime, dependency installation or production-policy change occurred.

## Exact revisions and preserved originals

- Corrective source preseal: `7add5d2c0a3acb27483ba0bb5dd52385812d8ed7`.
- Original runtime source: `c49d494dd5a36b19198680239a72e0c95cb90d8d`;
  documentation/evidence: `ee9d0c1fd24b33aa918154eb379a92c02cfe5925`.
- Independent F01/F02 findings: `b93241dfb9983d2b660233bdddce4569ec803f89`.
  Original REVIEW, FINDINGS, both input/raw/verdict triples and expectations
  remain immutable; `BINDINGS.json` authenticates their exact Git blobs/hashes.
- Candidate compatibility evidence: `71a16afd5b430175180fc4741531b75c31b25882`;
  selected source: `35da18547ca82a67be9ca22b4adc21e3b8060780`; unchanged CARRY:
  `bd471ef682d768692a682d40009a874f51e3ad68`.
- Source preseal SHA-256:
  `c971d27207b661ae3ee23d61d6e1ee7cfefc2b6a8a890f4e0fde228c81945c64`.
- Recipe seal SHA-256:
  `fc273904cf20f4a717bb7350bb46046bbee16617aee371bcfd03e38d98920f15`.
- Composed recipe tree SHA-256:
  `6a5ca19fef1237091719a4fb7571271f1c37ff02dde4a4c65253d34bd69b2878`.
- Exact diff SHA-256:
  `ae8de91fef938c24df0293a78548492bac44435509a610bf7f7decaede5c59fc`.

The separate evidence commit is routed with these source/hash bindings in
`/tmp/yq-runtime-v2-ready.txt`; no self-referential commit hash is invented here.

## Minimal delta and limitations

The repository stores an authenticated materializer and exact delta, not a
copied replacement framework. Seven of eleven composed recipe files remain
byte-identical: host, integrity, child, execute, fixture materialization,
inventory and source bindings. Four changes are bound by `V1-V2.diff`:

1. `assert-capture.mjs` preserves raw command bytes, records obligations, then
   refuses unbound assertions/fields/partial bindings. The unchanged host reports
   aggregate FAIL and may continue only with integrity plus reap proof.
2. `context.mjs` assigns scope/token identities shared by command rejection and
   fixture cleanup in the same child. Equal-looking objects remain distinct;
   repeated references match. Primitive kinds, negative zero, symbols and
   functions have adjacent controls. Tokens are not cross-process identity.
3. `import-fence.mjs` adds **only** `node:timers/promises`; original other
   allow/deny behavior is retained. The old refusal is reproduced and preserved.
4. `authorization.mjs` pins the selected candidate commit in addition to the
   unchanged original CARRY and other authorization requirements.

No prose-to-predicate mapping was invented. Nonempty natural-language assertions,
private counters, legacy nested aliases, inapplicable projections and explicit
partial records produce an INCOMPLETE obligation artifact and FAIL. This is a
deliberately conservative refusal, not a claim to implement every frozen
obligation. Even successful audits are BOUND_PROJECTION_ONLY, not full-record
semantic passes. Original jobs, their hash and all seven role counts are unchanged:
111 semantic / 34 admission / 23 source / 11 lifecycle / 4 infrastructure /
5 type / 6 negative-control; 194 IDs and 132 prepared record projections.

The candidate's selected 271-file map and separate full 273-file archive remain
unchanged data. Their preserved map and selected query adapter's static timer
import were authenticated without loading the adapter or any candidate module.
Synthetic actual-child controls use only newly written canned factories; their
marked host-trust receipts are explicitly not source/build/root attestations.

## Integration-ready API

Authenticate the source preseal and its listed files against the routed source
commit/hashes **before** importing:

`tests/commands/yq-independent-20260828/executor-preparation-v1/runtime-v2/recipe.mjs`

Exports:
- `describeRecipe()` returns authenticated original bytes, composed bytes and seal.
- `materializeRecipe(destination)` exclusively creates a fresh regular recipe
  directory. Its parent must already exist at a canonical absolute path. It
  returns `{ recipeRoot, seal, sealPath, sealSha256 }`.
- `verifyRecipe(recipeRoot)` checks exact membership, bytes and modes, including
  newly added entries. No-clobber materialization is regression-tested.

Use the returned recipe root for these unchanged import signatures:
- `host.mjs`: `runJobs`, `ownedNode`, `activeChildren`, `validateBounds`.
- `assert-capture.mjs`: `assertCapture(receipt, job, evidence, catalogue)`.
- `context.mjs`: `createFixtureContext`, `encodeRejection`, plus new
  `createRejectionEncoder()` for explicitly separate observation scopes.
- `import-fence.mjs`: original loader `initialize` / `resolve` hooks.
- `fixtures.mjs`: original `loadData` / `materializeJobs`.
- `execute.mjs`: deferred CLI arguments remain authorization path/hash and
  recipe seal path/hash. Use the returned v2 seal; never the old v1 seal.

Actual execution still requires separately routed authorization, accepted
source/build composition, exact selected jobs and physical source/compiled
roots. This handoff supplies none of that authority. Integration/consumers/root
files were neither changed nor committed by this worker.

## Replay and evidence

Exactly one presealed author replay matched **47/47 synthetic controls**:

```sh
node tests/commands/yq-independent-20260828/executor-preparation-v1/runtime-v2/validate.mjs \
  7add5d2c0a3acb27483ba0bb5dd52385812d8ed7 \
  c971d27207b661ae3ee23d61d6e1ee7cfefc2b6a8a890f4e0fde228c81945c64
```

The runner refuses uncommitted/mismatched source inputs, creates a unique replay
directory, preserves raw outputs before verdicts, and never rewrites an old run.
The capture is `evidence/replay-zUPq22/SUMMARY.json` (SHA-256
`1fcaee7d352b16adf6fd3d6013d6f49b1eccc8cc88e6d56f7d236aad42b8ec7e`).
It contains 531 files totaling 199,865 bytes, including all empty/raw files.
Both old defects remain visible as deliberately reproduced old behavior, not
rewritten expectations. New F01 refuses and continues a valid independent job;
new F02 also passes through the original actual child/cleanup route.

Controls preserve nonzero, signal, timeout/KILL, overflow, malformed/wrong receipt,
ordinary failure continuation, integrity byte/mode/file/directory changes,
withheld reap proof and simultaneous bad boundaries. All observed owned children
and groups were reaped; final active children are empty. `STATIC-CHECKS.json`
separately records exact diff reconstruction, nine harness-only syntax checks
and a clean specification check; these are not extra synthetic or semantic passes.

Source and frozen selected inputs were authenticated before/after. Recipe and
fixture tree guards enumerate additions, including directories. Historical
references use selected-path checks; no append-proof whole repository or
transient modify-and-restore guarantee is claimed. Evidence sealing records
captured modes separately from Git's regular-file modes, which cannot preserve
non-executable permission distinctions on a new checkout.

**Semantic passes: zero. Actual YQ review remains gated. This packet grants no GO.**
