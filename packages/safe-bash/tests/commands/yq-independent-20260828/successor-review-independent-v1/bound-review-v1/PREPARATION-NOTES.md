# Static Preparation History

- Initial criteria commit279413ac retained a spec-checker error: the heading
  "Goals, Non-Goals and Boundary" did not match the checker's required section.
  Separate a20799b2 changes only that heading to "Goals and Non-Goals". The
  checker then returned zero errors/warnings before any body inspection.
- The first independent archive-data auditor exited1 during Git metadata
  parsing: an unrelated repository filename contained a tab, so splitting a
  NUL-delimited ls-tree record on every tab produced too many fields. The exact
  error was `ValueError: too many values to unpack (expected 2, got 3)`.
  Only this reviewer's parser changed to split at the first tab. No expected
  source/package value, author implementation or product behavior changed.
  The corrected auditor returned0 and produced ARTIFACT-DATA-AUDIT.json.
- Both attempts verified the two root raw hashes before tar parsing. Neither
  extracted files, imported product code, executed controls or ran a compiler.
  The earlier data-reader error is not a candidate or product finding.
- Authored validators/inspectors/adapters/predicates were read/hash-authenticated
  only, never called. No author control successes are adopted or rescored.
- At the one natural bound-plan checkpoint the sealed handoff was absent.
  Untracked/evolving plan files were not inspected; no subsequent poll occurred.

The final auditor is stdout-only and does not rewrite committed evidence.
Old criteria, reviews and failure captures remain immutable.
