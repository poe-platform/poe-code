# Animation editing draft usage

The bounded edit surface supports `appear` and `fade-in` entrances, `fade-out`
exit and one centered `pulse` emphasis cycle. Reads continue to expose unsupported
timing without executing it. These examples use a shape named `Badge` in slide 1.

```sh
pptx animations add deck.pptx --kind fade-in --trigger on-click \
  --target '{"slide":1,"shape":"Badge"}' \
  --output animated.pptx --json
pptx animations set animated.pptx --slide 1 --shape Badge --delay 120 --in-place --json
pptx animations remove animated.pptx --slide 1 --shape Badge --output cleared.pptx --json
pptx animations list animated.pptx --slide 1 --json
pptx schema animations add --json
pptx capabilities --json
```

Add requires an explicit kind, trigger and target. Target accepts an emitted
selection token or a structured slide/shape lookup; the name must be unique.
CLI `--slide` and JSON target `slide` are one-based integers. SDK positions
use an explicit coordinate system. Set/remove select existing effects
through their owning slide and shape. Multiple matches require explicit `--all`;
empty selection requires `--allow-empty`. Consult the generated schema for the
exact selectors accepted by each operation. Selection tokens are owner-scoped
and fingerprint-bound; use a fresh token after an edit.

Delay defaults to 0 milliseconds. Duration defaults to 500 milliseconds, except
appear is always 0. Both accept integers from 0 through 2147483647. A pulse grows
to 110% about the center and returns once. `with-previous` starts with the preceding
supported effect; `after-previous` starts after its end. Both require a predecessor
in the same simple main sequence. `on-click` starts a click group.

Removing an effect that another effect depends on fails. Use an atomic animation
batch to explicitly change the dependent effect to `on-click` before removing
its predecessor. Batch operations execute in order; putting removal first still
fails. The SDK returns only the final package after all operations succeed and
resolves original selector tokens against the admitted input. It never silently
repairs a dependent trigger. The bounded CLI batch accepts only declared animation operations.

Mutation requires `--output` or `--in-place`, except `--dry-run`. Dry-run validates
and reports effects without publication. `--force` controls overwrite policy and
never bypasses unsupported-timeline or reference validation. JSON uses the common
version-1 mutation envelope and schema-declared effects/output manifest.

The SDK uses `mutateAnimations(input, action, options, context)` for `add`, `set`
and `remove`. `input` is supplied bytes or an explicit capability; `context`
supplies resource limits and cancellation. For example:

```ts
const result = await mutateAnimations(input, "add", {
  kind: "fade-in",
  trigger: "on-click",
  target: {
    slide: { coordinateSystem: "one-based", value: 1 },
    shape: "Badge"
  }
}, context);
```

Use the exported operation types for selection and publication integration;
there is no implicit host path access. Existing complex timelines and motion
paths are preserve-only. An edit that cannot retain their references and bytes
fails with `unsupported-edit` (CLI exit 1). Schema/usage errors use exit 2, I/O
uses 3, resource limits 4 and cancellation 130. Semantic validation checks stored
structure and references; it does not verify application playback.

The batch SDK is `mutateAnimationsBatch(input, operations, context)`, where each
operation is `{ action: "add" | "set" | "remove", options }` using the same typed
options as `mutateAnimations`. A dense ordinary array of at most `min(1000, context.xmlLimits.maxNodes)`
operations is required; an empty array validates the input and returns unchanged
bytes with no effects. For existing
effects selected by tokens from the original admitted input:

```ts
const result = await mutateAnimationsBatch(input, [
  { action: "set", options: { selection: { token: dependentToken }, trigger: "on-click" } },
  { action: "remove", options: { selection: { token: predecessorToken } } }
], context);
```

Dependent with/after effects occupy the same parallel click group as their
predecessor. A new `on-click` effect starts another group. Explicit event references
encode begin/end dependencies within each group. Duplicating a shape assigns a
fresh shape identity while leaving its original animation attached to the original
shape; it does not implicitly copy that effect. Slide import retains local timing
IDs and resolves targets within the imported slide. Deletion requires explicit
removal or retargeting of effects that mention the deleted shape.

For CLI batching, use the shared version-1 operation envelope. For an already
animated `Card` followed by dependent `Badge`:

```sh
pptx batch animated.pptx --ops-json '{"version":1,"operations":[{"operation":"animations.set","arguments":{"trigger":"on-click"},"options":{"slide":1,"shape":"Badge"}},{"operation":"animations.remove","arguments":{},"options":{"slide":1,"shape":"Card"}}]}' --output repaired.pptx --json
pptx batch animated.pptx --ops-file edits.json --dry-run --json
pptx schema batch --json
```

`--ops-json` and `--ops-file` are alternatives; file admission uses the configured
VFS. Unknown operations fail before reading the presentation. Later semantic
failure publishes nothing; success publishes only the final output once. Empty
batches require no destination and produce no publication. Per-operation results
contain metadata only; intermediate package bytes are never returned. SDK
`AnimationBatchResult.results` likewise omits bytes, while the top-level `bytes`
contains the final package.

Batch result locations and per-operation fingerprints identify the original input,
so all operations can consistently report their original selections. For subsequent
independent edits, read new selectors from the final output. A target cannot bypass
ownership checks by adding subrun fields or using a slide token.
