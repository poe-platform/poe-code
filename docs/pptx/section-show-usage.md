# Sections and custom shows usage draft

`pptx` exposes `sections` and `shows` with `list`, `get`, `add`, `set` and
`remove`. Both use the same byte SDK domain operations and common publication
rules. This is workspace operation support, not a released live object model.

```bash
pptx sections add deck.pptx --name "Field notes" --slides '[1,2]' --output grouped.pptx
pptx sections add grouped.pptx --name "Closing" --slides '[3]' --in-place
pptx sections list grouped.pptx --json
pptx sections set grouped.pptx --slide 1 --name "Observations" --position 2 --in-place
pptx shows add grouped.pptx --name "Briefing" --slides '[3,1]' --output briefing.pptx
pptx shows list briefing.pptx --json
pptx shows set briefing.pptx --select TOKEN --slides '[2,3]' --in-place
pptx sections remove briefing.pptx --select TOKEN --dry-run --json
pptx schema sections add --json
pptx capabilities --json
```

Use a current `--select TOKEN` from listing to target a stable section/show
identity. Tokens include the input fingerprint and become stale after a mutation.
`--slide N` filters containers by membership in a one-based slide position.
A `get` or single edit must resolve one container; ambiguous results fail.
`--all` explicitly permits editing all matching containers. Removing a container
keeps its slides. `--allow-empty` permits a supplied selection matching nothing.

Names may be empty or duplicate; they are display labels, not identities.
Ambiguous name lookup in the byte SDK fails. Renaming and reordering retain the
container ID, slide IDs and package part names. `sections set --position N`
changes section-list order independently of slide-list order. `shows set --position N` similarly reorders the custom show list. Both families
accept an insertion position on `add`.

Creation and membership replacement require a nonempty list of valid slide
positions. Section members must be ascending, contiguous and nonoverlapping.
Show members follow the supplied order, which may differ from slide-list order.
New repeated member positions fail. Existing repeated show entries remain intact
when another property changes. Hidden slides remain valid members, and membership
edits do not alter their visibility.

The workspace byte SDK provides these operations:

```typescript
const groupedBytes = await mutateMemberships(
  inputBytes,
  "sections",
  {
    action: "add",
    name: "Field notes",
    slides: [1, 2]
  },
  context
);
const sections = await readMemberships(groupedBytes, "sections", context);
const renamedBytes = await mutateMemberships(
  groupedBytes,
  "sections",
  {
    action: "set",
    selection: { id: sections[0].id },
    name: "Observations"
  },
  context
);
```

`readMemberships` returns ordered records with `id`, `name`, `position` and
`slides`. `mutateMemberships` returns `Promise<Uint8Array>`; its container selector
accepts an ID, an `ids` array with `all: true` for a selected block, a name,
a position or explicit all-selection. Membership positions are
one-based. Context supplies explicit byte/archive/XML/relationship limits,
cancellation and any admitted I/O capabilities. No filesystem, network, native
runtime, clock or random-ID source is inferred.

Deleting slides automatically removes every corresponding section/show entry,
including repeated show entries, and removes containers that become empty.
Other live slide links still require the documented explicit reference policy.
Removing a custom show used by active show settings or navigation fails with
`dangling-reference`; rename and reorder preserve those ID-based references.
Duplicating slides leaves custom show membership unchanged. Copies inserted
strictly inside a section span join that section to maintain contiguity; copies
inserted at a boundary or outside a section acquire no inferred membership.

Supported extension payloads and unaffected IDs survive edits. Unsupported
section extension structures fail with `unsupported-edit` before publication.
Unknown extension data is not interpreted as permission to rewrite it. Schema
and capabilities describe the actual exposed subset.

Mutations require `--output PATH` or `--in-place`, except `--dry-run`, which
validates and reports effects without publishing. JSON uses version 1 and dotted
operation IDs such as `sections.add`. Domain/selection failures exit 1;
argument/schema failures exit 2. Shared I/O, limit and cancellation statuses
apply. These byte operations do not establish full live `Presentation`, inherited
member, collection protocol or bounded XML-view API coverage.
