# csvgrep compatibility

Target: csvkit 2.2.0, source archive SHA-256
`147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b`.
The frozen runtime, locale, dependency and driver identities remain in
`docs/csvkit/reference-profile.json`. The executable descriptor retains the
source parser grammar and help; no inference, locale or sniffing flags apply.

The implementation is in `packages/csvkit/src/commands/csvgrep.ts`. CLI and SDK
settings share the engine. SDK `matchfile` accepts a path and uses the same
explicit opening capability as argv FileType. Argv opens every encountered file
eagerly, including before names-only execution or a later help flag. Hosts must
provide cooperative match-file close, including iterator retirement. The owning
scope shares one close completion between command execution and disposal.
No ambient filesystem, native executable or Python fallback is used.

Columns are required except for names-only execution. Presence validation uses
None/null checks; pattern selection uses truthiness, with regex before file
before string. Strings use substring matching; file lines use CPython whitespace
rstrip and exact set membership, including empty cells. Empty strings remove
predicates, unlike an empty match file, whose callable predicate remains.
Selected columns use AND by default and OR with any-match. Inversion complements
the aggregate. No matches still emits headers and exits zero.

Reader numbering uses physical consumed input lines before filtering, with
`line_numbers` as the header, and adjusts numeric selector offsets. Output does
not renumber surviving matches. Names-only execution uses unnumbered headers.

## Regex support and blockers

The bounded TypeScript search engine implements literal code-point matching,
dot, classes and ranges, alternatives, groups without capture observation,
quantifiers, beginning/end anchors, ASCII word boundaries, frozen Unicode 16
decimal digits, CPython whitespace, and consecutive leading a/i/m/s/u flag groups.
Intervals accept an omitted minimum, including lazy forms. Every matching
transition consumes the invocation work budget and a cumulative regex work
budget. Pattern length, nesting and sequence length have explicit admission
limits. Unsupported constructs return status 78 before output headers.

Capture-free positive/negative lookahead and fixed-width codepoint lookbehind,
plus x/u/U escapes, are implemented. Parser nesting is admitted separately from
evaluation nesting. Unicode range ordering uses codepoints, and Python-sized
quantifier overflow and warning-producing set syntax remain explicit refusals.
See [the frozen regex audit](../csvkit/python-regex-audit.md) for measured scope.

Full Python regex compatibility is **not complete**. Backreferences, named
captures, capture-dependent lookaround, scoped flags, verbose mode, atomic/possessive expressions,
octal/name escapes, full Unicode word and ignore-case classification,
large patterns and native regex syntax-error diagnostics remain blockers.
Patterns needing these features must not be counted as compatible passes.
Invalid/unqualified syntax returns a blocker rather than a guessed Python error.

Existing frozen raw observations are checked byte-for-byte for stdout, stderr
and status. Additional in-memory regressions establish the specified local
semantics; they are source-driven cases, not new measured differential evidence.
The larger suite's existing unimplemented commands and reader quoting modes
remain independently tracked blockers.
