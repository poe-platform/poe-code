# Replacement-verifier supplemental freeze

Chronology: this freeze is post-source-commit for candidate
`f1a90436c45208ca248e058a039893233c608daa`, and pre-inspection and
pre-execution by the replacement verifier. The replacement verifier had read
only the repository instructions, Git object metadata/status, the predecessor's
committed `freeze/**`, executable-location metadata, and the coordinator's
request before authoring these files. It had not read the candidate tree,
candidate tests, or author handoff and had not built, installed, loaded, or run
the candidate.

No independent pre-source-commit freeze exists. The predecessor's commit
`a0445f4d5cff1c8451957ce684273e1225279588` and this supplemental freeze are
both explicitly post-source-commit. The predecessor's immutable expectations,
including its guessed error behavior for empty and unknown selected values,
remain unchanged.

Before this freeze, no native `tree` executable was found at
`/opt/homebrew/bin/tree`, `/usr/local/bin/tree`, `/usr/bin/tree`, beneath the
Homebrew tree Cellars, by executable filename beneath `tests` or `benchmarks`,
or in the current `/private/tmp` and `/tmp` search. Therefore these files freeze
literal contract expectations and a native capture recipe, not native
observational results. Native 2.2.1 Darwin identity and observations must be
authenticated later and recorded outside this immutable directory.

`cases.json` is immutable. A mistaken expectation may only be addressed by a
new versioned correction containing an explicit contract or authenticated
native rationale; the original case and result must remain visible. Lowercase
locale suffix `.utf8` is deliberately classified as a virtual extension, not a
native-parity assertion.

The suite is bounded and concerns charset selection and terminal/output
safety. It must not be used to rescore a full gate, traversal coverage, or full
native parity.
