# Nullable capture diagnosis archive — DATA

This is a bounded, historical provenance handoff, **not a new independent
acceptance denominator**, product test, candidate qualification, or fix.
The delegated EVIDENCE-ARCHIVE LEAF copied existing evidence only. No captured
harness, native binary, or diagnostic worker was rerun.

## What is preserved

- `diagnosis.txt` is the exact original `/tmp/expr-nullable-diagnosis.txt`,
  including its original ownership, no-repository-write statement, source URLs,
  failed attempt, warning, limitations, and recommendations. Those statements
  describe the original diagnosis, not this later archival commit.
- `data/capture.json` preserves all 11 original pattern-12 rows and all 36
  native/helper rows; `data/register-capture.json` preserves all 36 supplemental
  register observations; `data/diagnostic.json` preserves both 36-row diagnostic
  variants. These are overlapping historical observations, not additive passes.
- `data/integrity.json` preserves the entire original artifact hash inventory,
  report hash, later source change, status, HEAD, and historical input hashes.
- All seven retained TS/C/JS source, harness, and transpiled-module texts are
  byte-exact DATA under `.ts.data`, `.c.data`, or `.mjs.data` names. They must not
  be imported, executed, compiled, or renamed into canonical test inputs.
- `manifest.json` maps all copied bytes to original paths, sizes, and SHA-256
  hashes. It inventories all 13 original files (the report plus 12 temporary
  artifacts), including the omitted native binary, and lists historical
  referenced-but-not-embedded inputs without remeasuring live source.

## Conclusions and failures remain historical

The program-counter-only cycle guard genuinely prunes legitimate capture
histories. GNU 9.7's observed unfinished `[0,-1]` register is distinct from a
valid empty capture and is not normative semantics. The simple capture-aware
guard relaxation fails negative controls; it is not a safe fix. Broad nullable
capture refusal remains unsupported/different, not native parity.

Every captured negative control remains intact: `aa`, no backreference,
no outer repeat, nonnullable repeat, mandatory and bounded repeats, longer
subjects, end anchor, and literal suffix. No expected bytes, errors, no-match
versus empty-match distinctions, or original failures have been rewritten.

Dirty-source/history ambiguity remains: the original author candidate was not
recovered, helper execution used `dist`, and the later dist hashes do not prove
source/build correspondence. The diagnostic variants are temporary experiments,
not candidates. GNU 9.7/Darwin observations do not establish GNU/Linux parity,
general POSIX support, reproducible native build identity, or superiority.

## Referenced, not embedded

The original supplemental `registers` executable is omitted; its exact original
path and measured hash remain in the manifest and original integrity JSON.
No native binaries, GNU implementation/archive, dependencies, live source/dist,
whole author corpus, or author log are copied. All recorded historical input
hashes remain available, including differing measurements. Unhashed references
are explicitly marked unknown, not silently authenticated. The installed
TypeScript version is recorded, but its dependency bytes are not qualified.
No missing harness, historical source, failed capture output, or warning log
has been reconstructed. The original read-only temporary directory is retained
untouched; the original report says its children and workers already settled.

## Read-only verification

From the repository root:

```sh
node tests/commands/expr-stress/nullable-capture-review/verify.mjs
node tests/commands/expr-stress/nullable-capture-review/verify.mjs --originals
```

The first command verifies embedded byte hashes, DATA suffixes, original
inventory/hash links, and exact current archive file inventory. The second
also compares every retained original, including the omitted binary, with its
manifest bytes/hash/mode/mtime and checks the original directory's current
entry inventory. Neither command imports DATA, invokes children, reads external
historical source/oracles/dependencies, writes results, or modifies originals.

Only `verify.mjs` is maintained executable code, and it is explicitly opt-in,
not a `*.test.ts` file. No product build, whole tests, shared discovery rules,
or typecheck exclusions are added or changed. SHA-256 checks establish copying
integrity relative to the manifest and original records; the archival Git
commit and separately published handoff hash anchor the manifest itself.
The exact current directory checks detect new entries within those checked
directories; they do not upgrade historical enumerated source checks into an
append-proof repository check or qualify any live candidate.
