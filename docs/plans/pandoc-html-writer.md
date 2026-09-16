# HTML writer implementation and QA

Implement an original TypeScript HTML5 writer in packages/pandoc, retaining the
html write alias and byte-only safe-bash adapter. Leave unrelated work intact.

1. Add failing original byte and DOM expectations for AST rendering, escaping,
   URI validation, raw policy and standalone SDK/CLI parity.
2. Implement deterministic rendering of all supported blocks/inlines, tables and
   deferred notes. Use a fixed standalone wrapper and no resource resolution.
3. Run maintained pandoc tests, lint/typechecks and selected workspace build.
4. Record coverage and validation under docs/pandoc; commit owned paths on main.

Manual QA: inspect canonical fragment and standalone output bytes, including
empty/code-only input and multilingual title/lang/dir. Confirm CLI and SDK output
match, unsafe schemes fail without publication, and template flags fail before
stdin acquisition. This byte-only adapter does not alter the visual poe-code CLI.

Writer milestone verified: nine original tests first failed against the old
projection; two further failing tests reproduced generated-ID collisions and CR
loss, then passed after fixes. The dedicated writer and SDK options now pass
maintained package tests, lint (including source/test typechecks), and the
selected workspace build. Original corpus/DOM/byte coverage and the upstream
Writers.HTML mapping are recorded in docs/pandoc/html-writer.md.

CLI milestone implementation is awaiting its own local commit and evidence.
No push or release authorized.
