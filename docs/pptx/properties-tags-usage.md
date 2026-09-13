# Properties and tags draft usage

This is draft usage documentation for the bounded metadata interface. No README change or published-package claim is made.

Core names are `author`, `category`, `comments`, `content_status`, `created`, `identifier`, `keywords`, `language`, `last_modified_by`, `last_printed`, `modified`, `revision`, `subject`, `title` and `version`. Model spellings remain unchanged. String fields allow 255 Unicode code points; revision is an explicitly controlled safe nonnegative integer. Dates are caller supplied and serialized in UTC whole seconds.

```text
pptx properties list deck.pptx --json
pptx properties get deck.pptx --name title --json
pptx properties set deck.pptx --name title --value 'Coastal survey' --output updated.pptx
pptx properties set deck.pptx --name Reviewed --type boolean --value false --output reviewed.pptx
pptx properties remove deck.pptx --name Reviewed --output cleared.pptx
```

Known core values use their declared types. A new custom name requires explicit `--type string|number|boolean|date`; the value's spelling never determines its type. Empty strings are intentional values, distinct from removal. Names must be nonempty. Missing reads/removals and duplicate ambiguous names fail. An explicit conflicting type fails. Date command values use an explicit UTC timestamp such as `2024-02-29T13:14:15Z`.

The bounded model entry point is `openPropertySession(input, context)`, returning an owned session after asynchronous admission. `session.core_properties` exposes synchronous named getters/setters and `await session.save()` returns bytes for caller-controlled publication. Supply admitted bytes or explicit capability-scoped I/O and limits through the existing context. Date setters take valid `Date` objects, never ambient host time. The full `Presentation` factory's metadata integration remains a separate unsupported public-model obligation.

```typescript
const session = await openPropertySession(input, context);
session.core_properties.title = "Coastal survey";
session.core_properties.modified = new Date("2024-02-29T13:14:15.000Z");
session.core_properties.revision = 0;
const output = await session.save();
```

Read-only command inspection does not create missing property parts. The owned model getter has documented creation behavior; no default author or timestamp is inferred. Unknown namespaces and unsupported custom value types are retained through supported edits. Supported property sanitization removes known core/custom values only, retaining unknown metadata, tags, extended application metadata and custom XML associations; it is not a complete privacy scrub.

Tags use `tags list/get/add/set/remove`. Omit slide selection for presentation ownership when adding a tag; `--slide 1` selects the first slide. Listing returns selector tokens for precise subsequent edits. Tag names and values preserve case; empty values are intentional. Duplicate names, ambiguous selections, shared tag-part edits and removal of decorated tags fail rather than silently changing unrelated XML.

```text
pptx tags add deck.pptx --slide 1 --name Season --value spring --output tagged.pptx
pptx tags list tagged.pptx --json
pptx tags set tagged.pptx --select TOKEN --value '' --output cleared-tag.pptx
pptx sanitize tagged.pptx --remove properties --output sanitized.pptx
```

`sanitize --remove properties` is the supported policy in this change. Unknown policies fail as usage errors. Unsupported custom properties remain visible in its result. Tags, custom XML and application metadata are preserved. The [evidence receipt](properties-tags-evidence.md) records original cases and disposable corpus checks.
