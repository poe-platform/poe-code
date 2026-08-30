# Retained preparation attempts

- The actual unmodified prepared control runner exits1: 14/95 pass, 81 fail.
  Candidate `build` requires named eligibility; the prepared runner uses the
  inherited boolean/omitted signature. No failed expectation is relaxed.
- The author verifier exits0 and reproduces94/94 plus six policy targets.
  Explicit capture exits1 for policy HOLD. Its second exclusive create raises
  EEXIST and exits1. The replay orchestrator incorrectly required2, then failed
  with `AssertionError: author-capture-overwrite-negative; 1 !== 2` at its line48.
  `replay-attempt-01.mjs.data` retains that source. Child stdout, stderr, status,
  timestamps and hashes are retained. The correction binds exit1 and authenticates
  the existing capture/negative result; it does not rerun or overwrite anything.
- Prepared mutation loading used a data URL, incompatible with the candidate's
  relative `inherited-model.mjs` dependency. This was identified during inspection,
  not counted as an executed mutant or kill. The binding-only runner overlay loads
  each separately copied complete two-module closure by file URL instead.

The frozen runner/oracle/inputs/expectations and all historical attempts remain
unchanged. Exact runner replacement hunks and original/new hashes are retained.

A report-only cleanup patch was refused because an extraneous context line did
not exist. It changed no bytes; the corrected narrow patch fixes source-location
references and spacing only. No control or model was rerun for that edit.

The first commit attempt stopped before committing: staged `git diff --check`
flagged the literal blank-context space at line10 of `runner-binding.patch.data`.
That byte is part of the captured Git diff and is deliberately preserved, not
trimmed. The scoped authored `.mjs`/Markdown formatting check passes; the raw
capture warning remains disclosed in `precommit-checks.json`. No global setting,
Git attribute, test discovery rule or captured artifact is changed to hide it.
