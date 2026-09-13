# Speaker notes

Draft usage for the private `pptx` package and explicitly registered safe-bash
`pptx` command. This is not a published-package availability claim.

```sh
pptx notes list slides.pptx --json
pptx notes get slides.pptx --slide 2 --json
pptx notes add slides.pptx --slide 2 --text 'Introduce the coastal survey' --in-place
pptx notes set slides.pptx --slide 2 --text 'Pause for questions' --in-place
pptx notes remove slides.pptx --slide 2 --output without-notes.pptx
```

Reads never create notes. A selected slide without notes returns null from
`notes get`; list omits slides without notes. An existing note without a BODY
placeholder has `text: null`; an existing empty BODY has `text: ""`. Speaker text
excludes slide-image, date, header, footer and slide-number placeholders.

`add` requires absent notes. `set --text` creates missing notes or speaker body.
It replaces the selected body's paragraphs, retaining other note shapes and
metadata. Unsupported inline speaker content rejects replacement rather than
being silently discarded. Newline separates paragraphs; vertical tab represents
a soft break. Reads retain cached field text without evaluating it.

Use `--slide N`, a returned `--select TOKEN`, or explicit `--all` for mutations.
Tokens identify owning slides, so they also work for note creation; `part`,
`master` and `bodyShapeId` identify the distinct note structures in returned data.
Tokens fail after the input changes. `--scope notes` is explicit but optional for
notes commands. Mixing a token with a simple slide or scope selector fails.

Mutations require `--output PATH` or `--in-place`, except `--dry-run`. `--force`
authorizes an existing explicit output, not input aliases. `--output -` writes
binary bytes and conflicts with `--json` except during dry-run. Reads and JSON
results use the shared version-1 envelope. Missing removal targets fail unless
`--allow-empty`; invalid flags fail before reading the input.

Other authored note shapes and notes-master text have explicit text scopes:

```sh
pptx text frames list slides.pptx --scope notes --slide 2 --json
pptx text replace slides.pptx --scope notes --slide 2 --shape Footer --find Draft --with Final --all --in-place
pptx text replace slides.pptx --scope notes-master --find Draft --with Final --all --in-place
pptx schema notes set --json
pptx capabilities --json
```

The SDK uses the same package editor. `context` below is a caller-supplied
SelectionContext with explicit byte, archive, XML and relationship limits:

```ts
import { readNotes, mutateNotes } from 'pptx';

const notes = await readNotes(inputBytes, {}, context);
const changed = await mutateNotes(inputBytes, 'set', {
  selection: {
    kind: 'slide',
    position: { coordinateSystem: 'one-based', value: 2 }
  },
  text: 'Pause for questions'
}, context);
// Deliver changed.bytes through a caller-owned output capability.
```

These are detached operation results. The documented live notes model, including
creating notes_slide/notes_master getters and live inherited placeholder
collections, remains incomplete. Competing notes-master imports and opaque graph
remapping remain explicit unsupported cases; no automatic flattening is implied.
