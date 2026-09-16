# Modern comment inventory usage draft

`pptx comments list` inventories legacy annotations and modern threads together.
Modern threads expose replies, author/user/provider identities, reaction instances
and opaque XML. Modern editing and identity remapping are unsupported.

```sh
pptx comments list deck.pptx --slide 1 --json
pptx comments get deck.pptx --select '<selector returned by list>' --json
pptx schema comments list
pptx capabilities
```

Use the returned `id` or fingerprinted `selector` for a thread or reply. IDs are
opaque strings; legacy `AUTHOR:INDEX` spelling is not the modern identity format.
Do not combine `--select` with `--id`, `--slide` or `--scope`. Re-list after an edit
to obtain selectors for the new presentation fingerprint.

JSON data includes `comments` and the presentation's `authors` inventory, even
when no threads exist. Replies are nested beneath their parent thread on normal
listing. Missing `comments get` results return null. Modern records have
`format: "modern"` and `index: null`; `authorIdentity: null` preserves an unresolved
author ID. Author names are display values and never establish identity.

```ts
import { readComments, readCommentAuthors } from "pptx";

const comments = await readComments(bytes, {}, context);
const authors = await readCommentAuthors(bytes, context);
const selected = comments[0]
  ? await readComments(bytes, { selection: { token: comments[0].selector } }, context)
  : [];
```

Both SDK functions take admitted bytes or an explicit input capability and an
explicit context with byte, archive, XML and relationship limits. Records are
readonly detached snapshots. No user identity, time, host file access or network
is inferred. Author inventory covers the presentation even when comment reads
select a single slide.

Mention-shaped content is retained in `opaqueXml`; typed mention ranges and
recipient resolution are not implemented. Unknown extensions and relationship
parts remain preserved on supported unrelated edits. A modern comment mutation,
unsupported identity remap, or signed/protected mutation fails without output
publication. Explicit legacy edits continue to preserve modern parts and associations.
