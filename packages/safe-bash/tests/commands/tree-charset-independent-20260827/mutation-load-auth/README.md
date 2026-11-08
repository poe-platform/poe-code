# Mutation target load-hash authentication

This versioned post-inspection derivative closes one evidence gap and nothing
broader: it records the SHA-256 of the exact source bytes returned by Node's ESM
`nextLoad` hook for each mutated target module before evaluation.

The immutable inputs are candidate
`f1a90436c45208ca248e058a039893233c608daa` (70 default commands) and mutation
driver commit `2748e2abbc2dc838e02b1d75ee7d967f0749e8ad` (tree
`2e0838b8e92ff88583e4e9651fe5a4549742ada6`). The wrapper authenticates that
the latter commit's 181 changed paths are all under `mutation-controls/**`,
then reads the driver, worker, mutations, load guard and fixture from that Git
object. It never reads candidate product code from mutable HEAD.

## Reproduce

Choose a new, nonexistent attempt path:

```sh
node tests/commands/tree-charset-independent-20260827/mutation-load-auth/harness/run-v1.mjs \
  --output tests/commands/tree-charset-independent-20260827/mutation-load-auth/attempt-002
```

The wrapper refuses output outside this subtree and refuses to overwrite an
attempt. It creates and removes only `mutation-load-auth/.work/**`. The exact
runtime derivative is captured in `attempt-001/derivative.diff`; its 11 exact
replacement records, original/derived hashes, Git provenance and wrapper-child
closure are in `attempt-001/derivative-authentication.json`.

`--import` loads `bootstrap.mjs` before the unchanged worker entry imports.
The bootstrap registers `load-hash-loader.mjs`. The hook canonicalizes target
file URLs through `realpath`, hashes the source bytes returned by `nextLoad`,
synchronously appends at most 16 bounded records, and allows the explicitly
declared baseline or mutant hash. A loader rejection is a harness failure, not
a mutant kill.

The principal evidence files are:

- `RESULT.json`: concise outcome;
- `REPORT.md`: scoped findings and limits;
- `attempt-001/results.json`: complete derived driver result;
- `attempt-001/load-authentication.json`: four baseline module loads and eight
  mutant load attestations;
- `attempt-001/raw/worker-*.loads.jsonl`: records emitted directly by the ESM
  loader before evaluation;
- `attempt-001/commands.json` and `attempt-001/wrapper-commands.json`: bounded
  inner and wrapper child closure records.

This is post-inspection instrumentation, not a pre-inspection test or a new
freeze. It does not rerun the whole gate or native parity suites.

