# Presentation comparison draft usage

The direct command compares two explicit inputs:

```sh
pptx diff before.pptx after.pptx --json
pptx diff before.pptx after.pptx --mode text --json
pptx diff before.pptx after.pptx --mode media --json
pptx diff before.pptx after.pptx --mode relationships --json
pptx diff before.pptx after.pptx --mode raw --json
pptx schema diff --json
```

One input may be `-` for stdin. `--` ends option parsing. Common `--limit`
flags only lower the explicitly configured host ceilings. The command writes
no presentation files and has no network or implicit host filesystem authority.

The SDK exports `comparePresentations(left, right, { mode }, context)`.
Inputs are bytes, byte sources or explicit VFS capabilities; the context supplies
byte, archive, XML and relationship limits and optional cancellation. It returns
equality as data. The command engine and safe-bash command call this same function.

An equal comparison exits 0; a completed difference exits 1 with `ok: true` and
`data.equal: false`. Comparison failures exit 2 with `ok: false`; cancellation
exits 130. SDK comparison does not throw merely because the inputs differ.

The default `structural` mode reports slide, text, property, raw geometry, media,
relationship and conservative opaque byte differences. Changes include stable
IDs, categories, before/after values and nullable fingerprinted locations.
Unchanged slide IDs retain identity during reordering; replaced IDs are reported
as removed and added. Opaque reports can overlap semantic reports because every
nonmedia part remains protected by a byte hash.

`media` compares a multiset of SHA-256 byte identities and ignores media part
names. `relationships` compares owner-local edge identities and normalized media
targets. Structural comparison can still report raw package changes when names
or relationship markup change. `raw` compares uncompressed member bytes and
names, excluding ZIP container metadata. Hashes do not establish visual fidelity.

Results declare `formatting: "raw"` and list limitations. Full
`effective-formatting` is explicitly rejected with `unsupported-profile`;
inherited formatting equality is not implemented. This bounded diff operation
does not complete the proposed live model or whole public API contract.
