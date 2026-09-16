# Presentation factory and publication boundary

This receipt supersedes historical not-implemented labels only for the members below. It does not claim completion of the presentation/slides object graph or the complete public API inventory.

| Public member | JS mapping | Original evidence |
| --- | --- | --- |
| `Presentation(input?, context?)` | Always `Promise<PresentationModel>`; absent/null input creates an original deck; explicit bytes/streams/VFS admit input | Factory, defaults, ownership, admission and public-export tests |
| `core_properties` | Cached synchronous existing live `CoreProperties`; creates a missing part on access | Round trip and missing-part tests |
| `slide_width`, `slide_height` | Synchronous nullable `Length` reads and `Length` setters through the shared guarded canvas operation | Dimensions, failure, absent-size and conditional-settings tests |
| `save()` / `save(undefined)` | `Promise<Uint8Array>` with validated owned bytes | Async and byte-ownership tests |
| `save(ByteSink)` | `Promise<void>`; caller owns sink closure | Transport, failure and cancellation tests |
| `save(PresentationPublication)` | `Promise<void>`; explicit host callback gets shared publication request and optional signal | Memfs stale checks, repeated saves, cancellation and class capability tests |

The synchronous canvas helper is used by both `mutatePresentationSettings` and the model, retaining conditional/protected-settings checks, supported dimension bounds, schema ordering and preservation. Core metadata uses the existing `CoreProperties` rather than a parallel implementation. Admission, signed/macro/labeled protection, serialization and result validation use `loadShared` and its existing package engine.

## Deliberate language and security mappings

J01/J06: all factory/admission/save paths are async, without value-or-Promise unions. The overloaded save return is determined by the presence of an output destination, but both overloads always return a Promise. A raw path cannot grant authority. `BinaryOutput`'s existing `VfsPath` describes a read capability only, so writing requires the explicit `PresentationPublication` host callback; it uses the CLI publication request shape. The host must enforce atomic source-byte comparison, aliases, overwrite authorization and cancellation before commit. A byte sink is a transport and cannot promise rollback once writes begin.

J02: canvas values are immutable `Length` objects, with exact integer EMUs. Setters retain the supported 1–56 inch edit range. An absent size reads null without mutation. Setting one axis on an absent size supplies the authored 10 × 7.5 inch companion defaults, as a deliberate deterministic model mapping; the lower-level command continues to require an explicit complete pair when no prior canvas exists. Existing partial/invalid size records are not silently repaired.

J06/J09: no-argument model creation uses an original empty 10 × 7.5 inch deck. The lower-level existing `createPresentation` operation retains its own established wide-canvas default. Author defaults to the empty string; timestamp defaults to absence, never wall-clock discovery. Supplied Date and limit records are copied before awaiting. Default ceilings are 16 MiB input/archive, 8 MiB per entry/XML, 32 MiB expanded archive, 4096 parts, 16384 relationships and XML depth 128; explicit context records replace these defaults. Cancellation defaults to no signal. `fontMetrics` accepts an already admitted typed handle without discovery; no font-fitting model integration is claimed by this boundary.

Publication destination fields are captured before serialization and callable receivers are preserved. A model revision change during serialization rejects publication. Output bytes and comparison baselines are independently owned. Successful in-place publication advances the comparison baseline; failed publication does not. Cancellation is checked before/after serialization and at transport boundaries, and passed to the atomic host capability.

## Remaining public obligations

`slides`, slide/master/layout/notes collections and their mutations, presentation `.element`/`.part` bounded views, and additional returned object ownership remain outstanding. Existing detached Shape/TextFrame/Table types are not presented as a completed live deck graph. The underscore-prefixed, inherited, collection and untested API rows in `upstream-api-inventory.json` remain obligations. This receipt does not reclassify or delete any inventory row and does not claim that the whole historical upstream test inventory has been adapted.

CLI routes reuse `properties` and `settings set` operation behavior; factory creation uses the existing creation/package engine. Exact object-model defaults above are distinct from CLI flags and their omission rules. No arbitrary method invocation route is added.

All cases use original small bytes and memfs where filesystem behavior matters. Zero-delay cooperative yields are scheduled with the suite's existing immediate-yield mock so the new boundary tests remain fast. No downloaded decks or cloned runtime binaries are product/test dependencies.

Maintained validation: `npm run test:unit --workspace=pptx` passed 206 files / 5,936 tests; `npm run lint --workspace=pptx` and `npm run build:workspaces -- --workspace=pptx` passed. Built workspace-package consumer verified async factory/save and live property/canvas round trip. These are local workspace checks, not publication or whole-public-API certification.
