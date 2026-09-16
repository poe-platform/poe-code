# PPTX selector implementation

This atomic change implements the selection foundation required by `docs/specs/pptx.md` sections 4 and 6.2, the shared Office CLI selection contract, and the SDK's explicit coordinate and ownership requirements. Domain code lives in `packages/pptx`; root exports only the public API. The safe-bash adapter is separately owned.

## Delivered subset

- `readSelectionIndex` admits explicit bytes/streams/VFS capabilities, hashes the exact admitted package with SHA-256, and reads relationships and XML with existing bounded codecs.
- Slide order follows the presentation relationship list, independent of archive order and filenames. Numeric slide IDs persist in separately authored reordered snapshots. Duplicate numeric slide identities, including lexical aliases, fail admission.
- Part identities are canonical package URIs. Their display positions are local to scope. Drawing objects are indexed in depth-first XML order, with shape IDs scoped to each owner, including groups and five supported drawing object kinds. Same-owner duplicate numeric IDs fail; names may repeat.
- Strict and Transitional namespaces are recognized; existing MCE interpretation controls active children. No absent notes or other objects are synthesized by inspection.
- Canonical tokens contain exactly the documented five location fields. Token and simple selectors cannot mix. Stale tokens fail before selection. Ambiguity returns at most 20 candidate locations and requires explicit all-selection; all-selection cannot widen scope.
- JSON numeric coordinates explicitly distinguish zero-based and one-based positions. CLI adapters use one-based coordinates. Exact names remain case-sensitive, including numeric strings.
- Invocation-local created-result handle storage supports owner checks, unique registrations, forward-reference rejection and explicit invalidation. A genuinely new location absent from the input snapshot is tested. These handles are a foundation for the later typed batch runner, not a claim that batch mutation/publication is implemented.

## TDD evidence

The original in-memory/VFS tests first failed because the SDK module did not exist. Subsequent concrete failing regressions identified same-owner ID aliases, scoped part positions, inapplicable slide scopes, out-of-range numeric IDs and legal unsigned lexical forms. Each was fixed after its failing assertion. The fixture uses original XML, shuffled filenames, duplicate labels and nested groups; SHA-256 is independently asserted using Node's test-only crypto implementation. No downloads or fixture files are required by unit tests.

Original tests cover five drawing kinds with both sets of required numeric identity variants, slide ID 256, missing/present slide names, relationship order, new-handle registration, ambiguity, stale state, malformed JSON tokens, explicit coordinate validation and owner isolation. Detailed research provenance and exact upstream case dispositions are maintained in the independently owned selector case accounting. The complete model API remains pending; snapshot records are not live model classes or a replacement for their documented spellings.

## Verification procedure

1. Run `npm run test:unit --workspace=pptx` and `npm run lint --workspace=pptx`.
2. Run the selected maintained build closure for `pptx` and adapter checks where exposed.
3. Inspect disposable corpus files only according to `docs/pptx/corpus-manifest.json`; reduce any meaningful findings to an original small regression here.
4. Exercise CLI help and inspection through the adapter, including a screenshot, without executing the whole pipeline.

## Remaining boundaries

This change does not implement editing, slide reorder serialization, a live evolving batch graph, general presentation model collections, image/table subtype ordinals or publication. The input snapshot stays immutable; a new read is required after serialized edits. Existing tokens cannot select locations created only in a handle registry. Inventory and selection are not a claim of complete package validation, rendering fidelity or whole-public-API parity. All inherited and underscore-prefixed public model APIs retain their pending dispositions rather than being hidden as private.

## Corpus-derived extension regression

Disposable manifest QA exposed rejection of application-defined payloads within an ordinary presentation extension container. A small original `urn:ornament` payload reproduced the failure. The compatibility view now accepts explicit opaque element names, copies that configuration and retains it across merges. The selector opts in only for PresentationML/DrawingML `ext` and DrawingML `graphicData`. Their uninterpreted payload bytes survive reads and unrelated edits; extension namespaces are not declared understood. Required namespaces and `MustUnderstand` on/around the container still fail. A real chart-reference payload inside an original graphic frame also supplies identity-only selection regressions.

Root independently retried the pinned manifest presentation and verified SHA-256, relationship slide order and per-slide object identities against a separate XML oracle. The integration QA record owns the exact corpus receipt. This completes only the explicit selector preservation subset, not general extension semantics.

Final package unit receipt: `npm run test:unit --workspace=pptx` passed 447 tests across 14 files, including 28 selector cases and 40 compatibility cases. `decodeSelectionToken` is exported for adapters to validate malformed tokens before opening an input. This helper uses the exact same canonical decoding as indexed token resolution.

## Command ownership correction

Domain command parsing, help, selection mapping, draft discovery schemas, Office result envelopes and error/exit-status mapping now live in `packages/pptx/src/command-engine.ts` and `command-schema.ts`. Safe-bash receives an explicitly injected structural engine and only transports raw argument bytes, scoped input bytes and output bytes. This preserves the command profile while keeping the root and safe-bash free of presentation logic.

Eleven direct original SDK engine tests cover the memfs capability boundary and exact record parity, malformed UTF-8/token/part rejection before reads, discovery schema validation, byte limits, unknown I/O diagnostic sanitization, typed and structural I/O classification, cancellation before/during reads, explicit byte argument admission and smaller archive read ceilings. Independent review findings were each reproduced before fixes: a malformed part URI reached the read capability, UTF-8 decoding removed a literal leading U+FEFF from filenames, declared I/O failures returned exit 1, and input reads ignored a smaller archive ceiling. No host operations or downloads occur in these tests.
