# Slide copying usage draft

`pptx slides duplicate input.pptx --slide 1 --position 2 --output copy.pptx`

The insertion position is one-based in the original slide list plus its end slot.
Use `--selection-json` for ordered slide selections, `--all` for all slides,
`--dry-run --json` to validate without publishing, and `--allow-empty` for an
explicit selection that matches nothing. `--select` accepts current fingerprinted
slide tokens. Missing selection and missing position fail before input is read.
Schema, help and capabilities describe the exposed subset.

The byte SDK exports asynchronous `duplicateSlides(input, options, context)`.
Options are `{selection, position, allowEmpty?}`; selection uses the shared
`SelectionQuery` format, including `{kind: "slide", position:
{coordinateSystem: "one-based", value: 1}}`. Input/output are admitted bytes;
context supplies explicit byte, archive, XML and relationship limits/cancellation.

Copies receive fresh slide/shape/relationship identities. Notes, charts and
embedded chart workbooks are isolated. Layouts, masters, themes and media remain
shared; copying does not authorize a shared-resource mutation. Notes backlinks,
slide self-links, connector sites and supported shape timing targets are remapped.
Unknown relationship types, opaque extensions or unsupported targets reject the
operation before publication. Cross-deck import and live model methods remain
separate work. There is no network fetch, native runtime or implicit host I/O.
