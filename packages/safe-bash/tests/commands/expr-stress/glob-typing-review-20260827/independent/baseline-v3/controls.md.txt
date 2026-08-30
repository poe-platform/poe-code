# Independent bounded glob typing review

Owned scope: this new `independent/` evidence subtree only. Production, canonical
tests, root exports/configuration and sibling author evidence are read-only.
This is an independent leaf assignment; no delegation or competing fix.

## Frozen controls (before reading the exact candidate handoff)

- Baseline: `40fb77fb09a2145e8a767c96b64966dafdff5c2b`, committed original
  `tests/commands/regex-execution/continuation/glob.test.ts`, not the author's
  transient working copy. Preserve the original FOREIGN-TYPECHECK diagnostic.
- Audit the exact commit named by the author handoff, its parent diff, source
  hashes and selected archive integrity. No live product overlays. The permitted
  canonical change is that single fixture's type annotations/type-only imports.
- Compare all executable statements, test names, assertions and fixture data by
  byte-identical TypeScript-emitted JavaScript. Emit the baseline despite its
  existing errors. Reject added `any`, suppression directives, casts, config
  exclusions, runtime branches, removed tests or weakened assertions.
- Strictly typecheck the exact fixture plus its imported closure, using the
  committed strict compiler settings, without whole-repository discovery.
  Baseline must reproduce TS2339, TS2345 and TS2769; candidate must remove them.
- Run the four unmodified glob tests from emitted JavaScript for both versions.
  Run only the five adjacent `tests/commands/expr/regex-protocol.test.ts` tests
  as protocol controls, including actual worker execution and mixed expr/legacy
  operations. Explicitly include the worker's imported closure for emission.
- Positive types: real overloads retain regex/expr return correlation; the
  candidate's annotated helper accepts ordinary descriptors and returns matches.
  Negative types: that actual extracted helper annotation rejects an expr
  descriptor; regex input accounting also rejects expr. Unsuppressed failures
  must be preserved. Removing the candidate annotation must restore baseline
  diagnostics without changing JavaScript.
- Archive only these selected import closures and configuration, not the huge
  repository. All captured source files use `.txt` data suffixes. Temporary
  compilations live in this subtree's ignored `node_modules/` and are removed
  after use. No native recapture, broad corpus or canonical-evidence writes.
- Preserve setup failures, timeouts, negative results and the original unrelated
  DU diagnostics. Do not fix or claim to have revalidated those DU diagnostics.
  This review cannot establish a full gate, API-wide parity or superiority.

## Initial setup observations

The initial shell inspection used `path` as a zsh loop variable, which replaced
that shell's PATH: `cat` and `find` reported command-not-found (exit 127).
It made no file changes. A fresh shell using no such variable successfully read
the parent/root instructions and scoped instruction inventory. Another grouped
inspection ended with exit 1 because optional `tsconfig.typecheck.json` does not
exist; the real `tsconfig.json` was read successfully. Neither is a product failure.

Live source inspection briefly observed the author's in-progress fixture edit;
it is not an accepted candidate or source of independent verification inputs.
The committed baseline and future exact handoff remain authoritative inputs.
