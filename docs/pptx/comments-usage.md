# Legacy comment usage draft

`pptx` exposes legacy slide annotations through plural `comments` operations.
Modern threads, mentions and reactions remain preservation-only. Authors and
UTC timestamps are explicit; display names may repeat and are not identities.

```sh
pptx comments list deck.pptx --slide 1 --json
pptx comments add deck.pptx --slide 1 --text 'Confirm the opening date.' --author 'Morgan' --timestamp 2026-09-13T10:30:00Z --left 12pt --top 24pt --output reviewed.pptx
pptx comments get reviewed.pptx --slide 1 --id 0:1 --json
pptx comments set reviewed.pptx --slide 1 --id 0:1 --text 'Opening date confirmed.' --in-place
pptx comments remove reviewed.pptx --slide 1 --id 0:1 --in-place
```

Use the actual `id` and fingerprinted selector returned by listing; `0:1` above
is illustrative. `--select` tokens cannot be mixed with simple slide selection or `--id`.
Add accepts a slide selector and allocates the new comment ID; it rejects `--id`.
Author-local indices and author IDs are stable identities, not list positions.
`--author-id` disambiguates existing authors; `--initials` supplies explicit
initials where needed. Add defaults omitted left/top to origin. Set preserves
omitted fields, including the timestamp.

Writes use exactly one of `--output` or `--in-place`. `--force` authorizes an
existing output destination, not invalid input or stale selection. `--dry-run
--json` reports a validated proposed edit without publication. Empty reads
succeed; ambiguous writes fail unless explicit `--all` is appropriate to the
operation. `--allow-empty` makes an empty mutation selection intentional.

`pptx schema comments add` describes admitted fields and `pptx capabilities`
reports available behavior. Common JSON results and exit statuses follow the
shared Office command contract. Listing returns comment IDs, author IDs, indices,
text, explicit timestamps, positions and owner-scoped locations.

The byte SDK exports asynchronous `readComments(input, options, context)` and
`mutateComments(input, action, options, context)`, with `action` equal to `add`,
`set` or `remove`. Inputs are admitted bytes/capabilities; context supplies
explicit limits. Reads return readonly comment records. Mutation returns bytes
and an affected count for explicit publication by the caller.

```ts
const selection = {
  kind: "slide" as const,
  position: { coordinateSystem: "one-based" as const, value: 1 }
};
const edited = await mutateComments(input, "add", {
  selection, text: "Confirm the opening date.", author: "Morgan",
  timestamp: "2026-09-13T10:30:00Z", left: 152400, top: 304800
}, context);
const comments = await readComments(edited.bytes, {}, context);
```

SDK positions are safe integer EMUs; stored positions round to signed eighth
points, nearest with halfway values away from zero. Reads return EMUs, including
half-EMU values where necessary. Explicit UTC timestamp strings serialize at
whole-second precision. Existing author registration is not renamed by changing
one comment; choosing a different author allocates a new index for that author.
Author entries are removed only after the package proves them unused.

For token-based SDK lookup use `selection: { token: record.selector }` with the
current record. Re-list after a mutation to acquire fresh fingerprinted locations.
Operation records are detached values; these functions do not expose a live
comment object collection.
