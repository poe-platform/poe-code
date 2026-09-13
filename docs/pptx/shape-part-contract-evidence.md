# Drawing part ownership receipt

`Shape.part: PartView` now retains the same slide owner for ordinary text boxes,
preset shapes, groups and grouped child shapes. The existing shared drawing
binding carries the `PartView`; inherited placeholder/picture/graphic-frame
access uses the same base getter. Reading validates the current shape handle
first. Detached models raise `PropertyAccessError` (`property-unavailable`).

The original `shape-part-contract.test.ts` failed before the fix because an
inserted textbox returned undefined. It now proves owner identity for the
textbox, preset, group and nested child; nested edits appear in current part
bytes. No independently allocated wrapper or detached package snapshot is used.
The inherited public `BaseShape.part` obligation is language/security mapped to
bounded readonly owner access (J01/J02/J09). Its returned `PartView` is covered by
`slide-part-contract.test.ts`, including memfs `xml get --scope slides --part URI
--json` parity. This closes the owner accessor only, not every source part API.

No source fixtures, ambient I/O, reference runtime or network were used. Existing
unit tests provide original inputs. Full API claims remain blocked by unrelated
unsupported members; collection and connector owner obligations are not silently
counted as completed here.

Validation: focused seven-file regression run passed all 35 tests, including
shape/slide ownership, rich placeholders, chart builders, replacement and command
contracts. `npm run lint --workspace=pptx` passed ESLint and production TypeScript;
test TypeScript was temporarily blocked only by concurrently authored missing
layout/add-slide members in another worker's red tests. This is not a full lint
pass claim. `git diff --check` passed.
