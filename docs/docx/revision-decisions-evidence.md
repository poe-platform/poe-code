# Bounded selected revision decisions

Status: ordered task 62 verified locally. The sole format contract
is `docs/specs/docx.md`; this evidence does not create another specification.
Procedures and exact ownership are in
[the execution plan](../plans/docx-revision-decisions.md).

The utility SDK exposes `editDocumentRevisionDecisions` with explicit accept or
reject and publication context. Commands use `revisions accept` and
`revisions reject`; selection is a whole revision token, scoped one-based ordinal
or explicit all. Reports retain before revision identities and surviving owners,
without treating removed annotation tokens as live. Live review owners and
ordered decision batches remain unsupported.

Original small memfs tests cover inline text decisions, direct exposed-property
snapshots, split-run tracked replacements, scalar CR preservation, namespace
bindings, scoped selection, repeats, dry-run and capability failures. Valid red
tests exposed an enclosing field bypass and nested paragraph-mark overlap;
both were corrected before requalification. The related earlier tracking guard
correction was separately verified and committed locally as `817f97802`.
Independent final review then reproduced lost inherited XML language/whitespace
semantics. Four original regressions failed before the fidelity correction;
corrected checks passed. Executable creation-help wording drift
was separately reproduced and corrected, preserving bounded decision limits.

The independent final Shell suite passed 49 tests with zero skips; 43 independent
focused tests passed and final review approved the bounded implementation.
Maintained uncached DOCX unit passed 80 files/1,952 tests, lint and the selected
build closure passed, and seven portable public-export/existing command checks
passed. The earlier unit attempt had one stale support assertion failure and
1,951 passes; its log is retained beside the corrected run. Literal registration passed
515 runner tests, which verifies membership rather than decision behavior.
No downloaded corpus or independent Word renderer qualifies these decisions.
The current inventories assign no source case specifically to this task and no
tracking-specific live public owner. These are additive F26 tests; source/API
provenance inventories, acquisition and reference passes remain preparation.
Full adaptation, model parity and corpus qualification remain later ordered work.
No product reference identity, copied code/binary, ambient host I/O, implicit
network or native product dependency was introduced. README files remain untouched.

Actual commands yielded accepted Evening tide and rejected Morning tide, a human
dry-run report of two revisions and missing-selection status 1 with affected zero.
Help/results/errors were captured, rendered with terminal-png and visually
inspected. Browser-conditioned portable bundle execution in Node is not actual
browser/workerd certification. All checks are local; no push or release occurred.
