# Slide removal

The workspace byte SDK exports `removeSlides(input, options, context)` returning
`Promise<Uint8Array>`. Context supplies explicit byte/archive/XML/relationship
limits and any stream/VFS capability. No host I/O or network is inferred.

```typescript
const output = await removeSlides(inputBytes, {
  selection: { kind: "slide", position: { coordinateSystem: "one-based", value: 1 } },
  referencePolicy: "remove"
}, context);
```

The registered safe-bash command uses the same operation:

```bash
pptx slides remove deck.pptx --slide 1 --output reduced.pptx
pptx slides remove deck.pptx --all --reference-policy remove --in-place
pptx slides remove deck.pptx --slide 2 --dry-run --json
pptx schema slides remove --json
```

Use `--select TOKEN` for a fingerprinted selector, or `--selection-json` for
explicit ordered query arrays. Duplicate selections and stale tokens fail.
`--allow-empty` permits an explicit selection that matches nothing; a missing
selector still fails. First, last and all slides may be removed.

Affected custom-show/section memberships, named slide links and resolved
first/last/next/previous navigation require `--reference-policy remove`.
It removes affected link elements and memberships, including empty containers.
Without this policy they fail `dangling-reference`. Opaque extensions, ignored
foreign markup/attributes, unknown navigation, history-dependent targets,
custom-show actions and unresolved/backlink targets fail even with the policy.
This conservative subset can reject ordinary presentations containing extensions.

Selected slide parts and exclusively owned notes/comments are removed with their
relationship parts and content-type overrides. Shared masters/layouts/themes,
media and unrelated orphan resources remain. Other graph families are retained;
this is not a package-wide garbage collector. Owned notes do not require a
separate reference policy, but a surviving shared note backlink prevents deletion.

JSON uses `slides.remove`, source locations for removed slides, logical slide
`affected` count and output fingerprint. Auxiliary reference repairs are covered
by the explicit policy; effects currently list the directly selected slides.
Dry-run validates without publication. Errors publish no bytes. Output/force,
binary stdout, in-place and cancellation follow the shared command contract.

This byte-operation support does not implement the planned live `Presentation`
object model or establish complete public API coverage. Usage remains a draft
until package publication and README authorization.
