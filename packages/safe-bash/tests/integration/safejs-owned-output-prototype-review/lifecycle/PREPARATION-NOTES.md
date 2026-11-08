# Preparation-only observations

No guest, product, engine or native probe has executed.

The first read-only source-pin capture helper compared a requested `/tmp/...`
handoff path with realpath on Darwin and failed before writing SOURCE-PINS.json:

```text
AssertionError [ERR_ASSERTION]: /tmp/safe-bash-owned-output-prototype-provenance-ready.txt
+ actual - expected
+ '/private/tmp/safe-bash-owned-output-prototype-provenance-ready.txt'
- '/tmp/safe-bash-owned-output-prototype-provenance-ready.txt'
```

The corrected helper canonicalizes only the two already-existing retrieval
handoff paths before the same regular-file check. Their requested and resolved
paths are both retained. Candidate, package, engine and tooling checks still
require the exact regular prepared paths. No symlink is created or written, no
probe assertion changes, and the failure is not a product/security verdict.

Read-only path discovery also found no file at the guessed ordering-report
directory `owned-output-qualified-ordering/REPORT.md`, integration `types.ts`,
engine `src/runtime`, or curl `response.ts`. Git's e57b5aa1 file inventory and
actual source imports located the real ordering-replay-q1 report, SafeJS command
types, interp files and network/output.ts before the plan was frozen. None of
these discovery misses caused an import, execution or fallback API assumption.
