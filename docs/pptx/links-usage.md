# Links usage draft

`pptx` reads hyperlinks as inert data. Inspection never follows a URL, launches a
program, runs a macro or activates embedded content. `requiresSanitization` marks
unsupported or unresolved actions for explicit review.

```sh
pptx links list deck.pptx --slide 2 --json
pptx links set deck.pptx --slide 2 --shape Agenda --url 'https://example.test/guide#details' --output linked.pptx
pptx links set deck.pptx --slide 2 --shape Agenda --target-slide 4 --output navigation.pptx
pptx links remove deck.pptx --slide 2 --shape Agenda --output cleared.pptx
pptx links remove deck.pptx --slide 2 --shape Agenda --sanitize --output sanitized-link.pptx
```

`--shape Agenda` selects the exact shape name inside the selected slide.

URL targets may be relative, such as `../resources/guide.html`; the relationship
stays external and the exact string remains intact. A slide target is a
one-based position within the admitted presentation. Relationship identifiers
are local to their owning XML part. The URL, explicit slide target and targetless
navigation forms are mutually exclusive.

The SDK exposes `listLinks`, `setLink` and `removeLink` on admitted bytes and an
explicit bounded context. Link paths select the owning shape or text property,
including runs in table cells. The default trigger is click; hover is explicit.
Reads expose existing custom-show navigation and preserve its attributes.
Custom-show authoring is not exposed by these operations.

Unsupported launch, macro and OLE actions remain unchanged by inspection. Normal
replacement and removal reject them. Explicit sanitization authorizes removal
of the selected unsupported action; it does not sanitize every active feature
in the presentation. The schema describes supported flags and actions.

Model views retain `ActionSetting.action`, `ActionSetting.hyperlink`,
`ActionSetting.target_slide`, `Hyperlink.address` and inherited `part` properties.
`_Hyperlink` is a supported alias of the same URL-view implementation.
`PP_ACTION` and `PP_ACTION_TYPE` identify the same immutable action enum.
`null` or an empty URL removes an ordinary link; unsupported actions require the
separate explicit sanitization operation. Slide assignment checks owner identity.
A missing previous/next target raises a typed value error. These model members
do not imply that every presentation/shape/text model is implemented.

A session provides a synchronous model bridge with an asynchronous save boundary:

```ts
const session = await openLinkSession(bytes, context);
const shape = new LinkShape(session, {
  owner: session.slides[1].part,
  id: "42"
});
shape.click_action.hyperlink.address = "../resources/guide.html";
shape.click_action.target_slide = session.slides[2];
const output = await session.save();
```

Use a link inventory path with its last element removed to address that link's
run-property owner: `shape.run(link.path.slice(0, -1)).hyperlink`. The path must
belong to the selected shape and name run properties; foreign or missing paths
fail. This does not synthesize an absent text run.

CLI `--path` takes the JSON array for the parent property, for example
`--path '[0,0,1,2,0,0]'`; derive it from the inspected link path by removing the
last element. It does not mean a filesystem path. Inspect the current document's
inventory rather than reusing a path from another presentation.
