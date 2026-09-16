# Master editing evidence reconciliation

The pinned test and API audits are research baselines, not implementation
certificates. Read `docs/pptx/upstream-test-inventory.json`,
`upstream-api-inventory.json`, `test-case-map.json` and
`api-language-mappings.md` together. The existing standalone
`docs/pptx/test-case-map-notice.txt` retains the license for derived research
material. All new product code, tests, XML and text are original.

## Concrete contracts

Master collection fixtures separately cover zero, one and two registered masters,
ordered iteration, indexed lookup and out-of-range failure. Layout usage fixtures
are `()`, `(0,)`, `(1,)`, `(0, 1)`: retain all four, rather than counting one
multi-slide assertion as all parameter cases. Membership must follow actual
layout/master relationships, not filenames or shared theme identity.

The background fixture states are absent background, a theme background reference,
and an existing solid fill. The source model's fill getter may create a definition;
read-only CLI inspection must not. An explicit background mutation and a
noncreating read do not implement that creating model getter.

Placeholder scenarios separately distinguish master geometry, layout direct
geometry, layout inherited geometry, slide direct geometry and slide inherited
geometry. A master mutation must retain the downstream XML overrides, including
explicit zero values. Text edits must preserve the ownership chain; setting a
master text shape is not a request to overwrite slide text. Shared theme bytes
must remain unchanged when editing only a master.

Master placeholders have title/body lookup and a missing-type fallback. Returned
shape collections, their factories and inherited public members require observable
owned-object behavior; internal mock-call topology is not a TypeScript design.
Neither a leading underscore nor a missing upstream test excludes a public API.

## JavaScript and security mappings

- J01/J02: primary live model names remain `slide_masters`, `slide_layouts`,
  `slide_master`, `used_by_slides`, `background`, `shapes`, `placeholders`,
  `text_frame` and `follow_master_background`. Byte operations and camelCase
  command options are a separate operation surface, not aliases for those APIs.
- J03: sequence `.length`, iteration and checked zero-based lookup are model
  requirements. CLI positions are one-based. Master/layout placeholder collections
  use positional lookup plus their documented type/default lookup; slide
  placeholders use sparse keys. No blanket slicing or negative-index promise.
- J05/J06/J07: safe integer EMUs and finite numeric conversion; byte inputs and outputs
  have explicit limits/cancellation/capabilities. No ambient paths, time, fonts,
  native runtime or network authority. Scope is explicit; a shared theme does not
  authorize changes to other masters.
- J08/J09: neutral typed errors and bounded XML/package views replace runtime
  internals. XML editing remains namespace-aware; unsupported structures are
  preserved or rejected before publication, not flattened.
- J02/J10: documented setters and inherited/returned public members remain in the
  register even when the pinned implementation lacks a setter or local tests.
  In particular, the documented `follow_master_background` setter remains a
  required operation and live-model obligation.

No whole-model parity claim follows from this task. The supplemental accounting
records exact source identities/parameter pointers and separates original
operation evidence from still-unimplemented live model behavior. Source counts
are never used as target passing-test counts.
