# Font-name decoding increment

Keep the GNU 0.21.10 baseline and remaining cells in
[safe-bash-unrtf-behavior.md](safe-bash-unrtf-behavior.md) open. This increment
admits codepage/Unicode names in ordinary flat font declarations under the
standards-strict profile, not native personalities or complete font grammar.

## Manual QA

1. Run the maintained command workspace unit and lint routes, then the selected
   safe-bash build closure. Verify Unicode font names, incomplete DBCS and
   unpaired surrogate errors, declaration budgets, and the existing isolation,
   cancellation, binary and CLI/SDK controls.
2. Through the public safe-bash command subpath, register the command in a Shell
   with memory VFS. Render a font declared with CP932 hex bytes, another with
   Unicode controls, escaped body content and nested font/style restoration.
   Compare CLI and SDK complete HTML byte results, not display strings alone.
3. Render text with paragraph/tab/table boundaries and inspect a terminal PNG
   from the maintained screenshot runner. Check readable lines and tab cells.
   Inspect the HTML bytes for CSS escaping of the decoded name.
4. Assemble the maintained safe artifact and check that the unrtf export's
   implementation and recursive declarations have no private bare specifiers.
   Do not infer installed-consumer or other-realm qualification from this check.
5. Purge temporary evidence. No host capability belongs in the runtime engine;
   the screenshot runner and artifact builder are development tooling only.

## Policy and resource review

Names use explicit cpg, then mapped charset, then document encoding. Symbol
names use the document codec because their declaration spelling is not glyph
content; selecting the Symbol font still fails E_CODEC. Malformed/incomplete
name bytes or unpaired surrogates fail E_ENCODING/status 1, with no partial
font declaration emitted. A semicolon ends the name; subsequent spelling does
not append to it. Unicode uc fallback is declaration-local, including inert
binary payload fallback. Binary outside that fallback fails E_PARSE/status 1.

Name UTF-8 bytes count against decodedBytes, UTF-16 storage against retainedBytes
and tokenBytes. Names are metadata and do not consume document outputBytes.
No complete-document buffer, recursive renderer, external dependency or
capability was added. Existing declaration cleanup releases name reservations
on success, failure and consumer return. Complete nested/alternate-name font
grammar and native codec/charmap parity remain OPEN.

## Executed candidate review, 2026-09-20

The initial three in-memory regressions failed against the current code: names
were byte projections/ignored Unicode, malformed name encoding succeeded, and
name bytes bypassed decodedBytes. They passed after declaration decoding was
added. A subsequent independent symbol/binary-fallback control failed because
nonbreaking name symbols leaked body events and binary fallback did not consume
the declaration fallback; both paths were corrected before final verification.
A TypeScript exact-optional-property error was corrected before reporting lint.

- Command workspace unit route: 56 passes, zero failures/skips/cancellations.
  Concrete fixtures cross 1/2/7/2048-byte chunks, CP932, CP1251, UTF-8 literal
  replacement content, Unicode/surrogates, malformed names and zero output budget.
- Command ESLint and source/test TypeScript checks pass.
- Maintained selected safe-bash build closure passes: 19 build routes, shared
  caching enabled. No shared build/config/publication code changed in this increment.
- Maintained artifact assembly passes. Public unrtf JS and recursive declarations
  reference bundled relative artifacts rather than bare private packages.
- Manual memory-VFS Shell registration and SDK conversion through the assembled
  public artifact pass complete HTML result/byte equality and expected text bytes.
  Decoded CP932/Unicode names are CSS-escaped and nested fonts/styles restore.
- Maintained generic screenshot runner passes; terminal PNG inspected for
  paragraph and tab/table output. No screenshot tests were added. The poe-code
  screenshot wrapper cannot invoke this opt-in Shell command directly.

Initial direct raw-dist execution failed on an absent private workspace link;
the public assembled artifact supplied the proper bundled implementation and
passed. This is artifact execution with declared dependencies available through
the workspace, not an isolated installed-consumer or registry qualification.
No native oracle, actual browser/workerd engine, checkpoint/replay, broad root
unit/lint gate, performance qualification, push or release was executed.
The complete behavior task remains OPEN for the remaining acceptance cells.

`/out` creation failed with read-only-filesystem status. Temporary evidence used
workspace `out/unrtf-font-qa` and was purged after inspection. No external runtime
dependency, package publication, local commit or remote delivery was added;
unrelated edits were preserved.

Final artifact checks also pass: strict NodeNext declaration checking without
skipLibCheck, and Node syntax checking of the bundled command implementation.
