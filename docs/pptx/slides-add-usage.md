# Slide insertion usage draft

The `slides add` command inserts one slide into an existing presentation. Supply
an exact layout name or layout part URI. Layout names must resolve uniquely.
The selected layout retains its existing master relationship.

```sh
pptx slides add source.pptx --layout Blank --name 'Field notes' --output result.pptx
pptx slides add source.pptx --layout 'Survey' --position 1 \
  --title 'River survey' --body 'Measured at noon' --output result.pptx --json
pptx slides add source.pptx --layout 'Survey' \
  --placeholders-json '[{"type":"body","index":42,"text":"Measured at noon"}]' \
  --in-place --dry-run --json
```

`--position` is the one-based final slide position. Omit it to append. For a
presentation containing two slides, positions 1, 2 and 3 are valid. Slide IDs and
shape IDs are separate: existing IDs on other slides remain unchanged.

`--title` matches `title` or `ctrTitle`. `--body` matches `body`, `obj` or
`subTitle`. Each convenience flag must match exactly one placeholder. Blank
layouts have no matching placeholders. Custom layouts may use sparse indices;
`--placeholders-json` selects an exact type and optional index without assuming
that index 0 is a title or index 1 is a body. Missing matches, ambiguous matches
and assigning a placeholder more than once fail before publication. Text
population retains layout inheritance and does not edit the layout or master.
Date, footer and slide-number placeholders are not cloned.
Text assignment supports only `title`, `ctrTitle`, `subTitle`, `body` and `obj`.
Rich placeholders such as `chart`, `tbl` and `pic` retain their placeholder type
without a text body; assigning text to them fails with `unsupported-edit`.

Optional visibility settings take explicit values: `--hidden true|false` and
`--follow-master-background true|false`. Omission retains the documented domain
defaults. `--name ''`, `--title ''` and `--body ''` accept empty text.

Use `--output PATH` for a separate destination or `--in-place` to replace the
input atomically through the supplied VFS. `--force` permits replacing a separate
existing destination. `--dry-run` validates without changing files and may omit
the destination. `--output -` emits only presentation bytes and cannot combine
with `--json` unless dry-running. Input `-` consumes stdin and cannot be edited
in place. Limits lower the explicit host ceilings using `--limit NAME=VALUE`.

`schema slides add --json` exposes the operation as `slides.add`. Its JSON option
fields are `layout`, `position`, `name`, `hidden`, `followMasterBackground`,
`title`, `body` and `placeholders`, plus applicable common publication options.
The result uses the shared envelope and records effects, output metadata and the
result fingerprint. Dry runs report no output files and a null result fingerprint.

The byte SDK uses the same insertion implementation:

```ts
const changed = await addSlide(inputBytes, {
  layout: "Survey",
  position: 1,
  name: "Field notes",
  placeholders: [{ type: "body", index: 42, text: "Measured at noon" }]
}, context);
```

`context` supplies explicit byte, archive, XML and relationship ceilings and an
optional cancellation signal. The caller supplies input bytes and owns output
publication; this API performs no implicit host-file or network access. The
operation-level API returns a new `Uint8Array`. The broader presentation object
model and its `slides.add_slide` method are not yet exposed by this implementation.
