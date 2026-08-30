# Quoted-parenthesis correction and final seal

The initial native capture exposed a harness-input defect: the purported bracket
positive `class-parenthesis-not-capture` begins with bare `(`, which expr parses
as expression grouping. Its native status2/diagnostic is valid grammar evidence,
NOT coverage of bracket parsing or syntactic capture presence. Both original input
and original receipt/manifest remain byte-identical. Nothing is relabeled a pass.

`correction-input.json` adds one GNU forced-literal quoting correction, captured
separately using the same authenticated binaries. Its GNU C receipt is a real
positive bracket/no-capture control. Apple remains separate and is not assumed to
support GNU `+`. This correction is not a newly expanded random corpus.

Final scope: 21 argv inputs (initial20 + correction1), 24 GNU observations
(initial23 + correction1), 24 separate Apple observations, 24 unexecuted control
specifications and 32 unexecuted mutation specifications. Original95/104 GNU,
16 safety, seven workflows and four ReDoS remain entirely separate. Do not replace
the original20 row or original95 row count with a smaller passing denominator.

The one-time correction capture command refuses an existing receipt:

```sh
node --input-type=module - capture < tests/commands/expr-stress/extension-review/frozen/correction-native.mjs.data
```

Default correction verification is read-only; native replay uses unique removed
scratch and preserves all captures:

```sh
node --input-type=module - verify < tests/commands/expr-stress/extension-review/frozen/correction-native.mjs.data
node --input-type=module - verify-native < tests/commands/expr-stress/extension-review/frozen/correction-native.mjs.data
node --input-type=module < tests/commands/expr-stress/extension-review/frozen/verify-seal.mjs.data
```

The final `freeze-manifest.json`, not the initial native capture manifest alone,
binds all freeze files, this disclosed correction and validation receipts. The
handoff supplies its external hash. `verify-seal` hashes every listed file AND
checks the complete current file inventory beneath this frozen subtree, excluding
only the seal itself. It rejects added entries/symlinks; that is local freeze
inventory checking, not append-proof certification of other source/test trees.
The initial runner's narrower manifest check remains correctly labeled false.

Future execution follows README exactly, plus this correction as a separate
one-row GNU report. Preserve native status/stdout/stderr byte-for-byte; report its
exact comparison and candidate/adapter/installed artifact hashes alongside the two
existing comparator outputs. No correction-product comparator is implemented
here; the future independent execution adapter must assert those three fields
against `evidence/quoted-parenthesis-20260827/oracle.json` GNU profile and retain
raw observations. An Apple mismatch must never waive GNU behavior. `verify-seal`
must run before and after future execution. Do not write future results under the
sealed subtree; root must assign a distinct execution directory.

The original count preflight initially caught 23 specifications where 24 were
declared, before any native capture was written. The missing explicit installed
legacy transcript was added as R04 before freezing. This is harness validation,
not product failure or candidate test evidence. No author implementation was
consulted to fix either preparation defect.
