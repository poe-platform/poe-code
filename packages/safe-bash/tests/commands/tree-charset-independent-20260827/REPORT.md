# Independent tree charset review

Candidate `f1a90436c45208ca248e058a039893233c608daa` passes this bounded independent
review. No in-scope product bug was found. This is not a full-gate rescore,
traversal expansion, or full native-parity claim.

## Chronology and cleanup

No independent pre-source-commit freeze exists. The predecessor freeze
`a0445f4d5cff1c8451957ce684273e1225279588` and replacement supplemental freeze
`633fc0c7d582b9f997ca42be75461b78e03dccb9` are explicitly post-source-commit.
The predecessor's unauthorized scoped `AGENTS.md` was removed, without amending
history or touching another AGENTS file, in
`d12de6eca8fff2a7389746ee67e1f99185b968f7`.

The frozen guesses for empty/unknown environment values were wrong. They remain
immutable; corrections are recorded in v2
(`814dfebf7ab43f4b4fe4954e10df185ed2ff087c`) and v3 (part of
`c355751f36ca3fdbab8f888eaab30203c1bcd343`). V3 also corrects the unsupported
`en_US.UTF8` locale guess. The first native recipe's self-hash failure and the
first package holdout's invalid function-valued env fixture are preserved raw.

## Executed results

- Exact author runner: baseline 77/77; candidate 139/139 (77 unchanged + 62 new),
  zero failures/skips/cancellations; scoped strict types and isolated source build
  passed.
- Exact sealed differential: 26/34 became 31/34, closing exactly the five stated
  connector cases with no new regression. All 15 count totals match; the mixed-root
  native annotation keeps one count row from whole-byte equality.
- Independent moved install: full Git archive built with 314 authenticated tool
  files; 760 dist files; 762 packed/installed files; package inventory and built
  dist matched after moving. Root and `virtual-bash/commands/tree` resolved inside
  the moved package. Strict installed-consumer TypeScript passed.
- Default registry contains exactly 70 commands and one `tree`. Twenty-one recorded
  holdout groups passed, including precedence, all documented explicit aliases,
  exact locale table, empty/unknown handling, own-key/prototype and ambient-env
  isolation, escaping, identical charset call trace, UTF-8 byte limits, work
  admission, abort, awaited backpressure and sink rejection.
- Five semantic negative controls and three wrong-package/missing-package/source-
  fallback controls failed as expected. Four child processes were absent after
  close, the worker exited 0 with thread id -1, and no unhandled rejection remained.
- The unchanged historical strict recipe was run from its authenticated cases file.
  It failed as expected: the recipe requires UTF-8 branches and `1 directory, 2
  files`; the C-profile candidate emits ASCII branches and `2 directories, 2 files`.

Native identity is unix-tree 2.2.1, Darwin arm64, binary SHA-256
`34a794e5737d4b09a20a58dc0b7231e6300a3d229be5065c3a549969d205f10a`.
The corrected independent 15-probe capture verifies. Lowercase `.utf8` locales
remain virtual extensions. Native empty explicit charset is status 1 and native
unknown explicit charset falls back to ASCII/status 0; the stricter virtual
status-2 behavior is an intentional retained dialect distinction.

The three retained 34-pair differences are `count-mixed-roots` annotation,
`names-utf8` collation/escaping, and `names-utf8-ascii-branches`
collation/escaping. Raw results and authentication inventories are under
`execution/`; exact machine-readable conclusions are in `RESULT.json`.
