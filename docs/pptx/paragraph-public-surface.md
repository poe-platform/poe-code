# Paragraph, run and font public surface evidence

The existing Paragraph model now supports owner read/write bindings. Its formatting
properties retain the established paragraph domain merger. Returned runs are live
views indexed among regular runs, with stable owner identity across appending runs,
line breaks and paragraph-property edits. Destructive paragraph clear/text changes
advance a generation; earlier run, font and color handles fail with InvalidHandleError
and code `invalid-handle`. Bound paragraph owner invalidation propagates to children.

Original unit evidence is packages/pptx/src/paragraph-public-surface.test.ts. The
first five tests failed against the prior model before implementation. Subsequent
color and fill tests also failed before implementation. All ten tests now pass.
Tests allocate bounded XML bytes in memory and do not touch a filesystem, network,
runtime converter, downloaded deck or publisher document.

| Public member                            | JavaScript mapping and behavior                                                                                                                                                                    |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Paragraph.runs                           | Frozen readonly array of live Run instances; zero-based array indexing, array iteration, `.at()` and `.slice()`; excludes field and line-break elements                                            |
| Paragraph.add_run                        | Returns the new live Run with the same Paragraph parent; insert before end-paragraph properties                                                                                                    |
| Paragraph.add_line_break                 | Inserts a soft break before end-paragraph properties; returns undefined                                                                                                                            |
| Paragraph.clear                          | Removes runs, fields and breaks, keeps paragraph properties/end properties and unknown extensions; returns the same Paragraph                                                                      |
| Paragraph.text                           | Reads fields and regular runs, joins soft breaks with vertical tab; setter maps newline and vertical tab to soft breaks, destructively removes run formatting and preserves paragraph formatting   |
| Paragraph.font                           | Creating getter ensures paragraph properties/default run properties and returns a live Font                                                                                                        |
| Run.text                                 | Replaces only owned text, retaining run formatting; newlines remain literal and unsupported controls use escaped text tokens                                                                       |
| Run.font                                 | Creating getter ensures run properties and returns a live Font                                                                                                                                     |
| Font.name, size, bold, italic, underline | Existing run-format merger and validation; nullable name, Length size and three-state boolean formatting; true/false underline map to single/none, additional underline values retain enum numbers |
| Font.fill                                | Existing FillFormat bound to the owned font-properties element; inspection is noncreating, mutation uses the shared drawing primitives                                                             |
| Font.color                               | Creating getter converts non-solid fill to solid, then returns existing ColorFormat with a live binding; RGB and brightness edits update the owner                                                 |
| Paragraph.parent, Run.parent             | Bound owner identity; no ambient object or filesystem access                                                                                                                                       |

This implements observable model behavior independently of preserving `text replace`.
The existing CLI paragraph/run formatting and literal-replacement operations retain
their noncreating reading path. No command calls these creating model getters.
Destructive setters compute the complete bounded XML result before publication;
resource-limit failure retains previous content and existing run handles.

Evidence was compared with docs/pptx/upstream-api-audit.md,
upstream-api-inventory.json, upstream-test-audit.md, upstream-test-inventory.json,
public-api-map.json and retained test-behavior-evidence.json. The inventories are
baseline research, not passing implementation evidence. This file does not relabel
unimplemented rows as covered. The source's underscore-prefixed Paragraph/Run names
remain public neutral Paragraph/Run types; underscore naming is no privacy waiver.

Remaining documented gaps in this slice: Font.language_id requires the complete
language enum/XML mapping; Paragraph.part, Run.part and Run.hyperlink require the
explicit package/relationship owner capability. These are not private or claimed
implemented. Whole-package API parity is not established by these tests.

Focused checks: ten original paragraph public tests, existing 77 font-color cases,
69 paragraph-formatting cases and five frame public tests passed. Narrow ESLint of
the edited model/color files and original tests passed. Maintained package-wide
checks and root graph integration are recorded by the coordinating task.
