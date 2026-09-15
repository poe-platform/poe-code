# Office JavaScript SDK Specification

Status: Proposed

Implemented Through: Not applicable

Purpose: Define complete documented public API coverage and closely mirrored JavaScript object models for `docx` and `pptx`.

## Normative Language

MUST and MUST NOT are required; SHOULD is a strong recommendation. All behavior
is proposed. No API in this document is claimed to be implemented or published.

## 1. Problem Statement

A broad format feature matrix does not guarantee a usable object API. The SDKs
must cover the complete documented public object graph, including methods,
properties, setters, collections, enums, helpers, defaults and exceptions.
Existing test inventories are a baseline, not the limit of API coverage.

## 2. Goals and Non-Goals

The SDKs MUST closely mirror the documented object models captured in each
format's research inventory. Public method/property spellings, including
snake_case, SHOULD be retained as the primary API where they contain no external
project identity. Do not add a second camelCase object-model alias for every
member. Ordinary concepts such as `Document`, `Presentation`, `add_paragraph`,
`add_slide`, `text_frame`, `core_properties`, `Inches` and `RGBColor` are domain
API names, not project attributions.

Source project names, links, attributions and project-branded error classes MUST
NOT appear in code, comments, tests, fixtures or CLI output. Use original error
class names and standalone legally required notices. Research crosslinks remain
in documentation. A faithful public API does not require copying implementation,
Python internals, dependency APIs or external default templates/assets.

This is not literal Python runtime compatibility. Async I/O, iteration, indexing,
keyword arguments, numeric/date values and sandbox authority need explicit JS
mappings. Those mappings MUST be uniform between the SDKs and tested. A missing
documented public operation is a coverage gap; it cannot be dismissed because it
was absent from the initial feature plan.

## 3. Coverage and Evidence Authority

Each format MUST maintain an API register reconciling its pinned documentation,
source, tests and current published documentation. Inventory entries record
source member, target JS signature, read/write capability, defaults, return type,
exceptions, ownership, side effects, CLI route and original acceptance tests.
Publicly documented types whose names start with `_` MUST NOT be excluded merely
because of their spelling. Returned objects, inherited members, collection
protocols, enum values/aliases and prose-only user-guide operations are included.

The initial inventories under `docs/docx` and `docs/pptx` are candidate RST/autodoc
expansions, not exact Sphinx-build or complete-public-API claims. Reconciliation
MUST add omitted prose/returned/protocol members and resolve documentation drift.
A source or guide typo MUST NOT be copied as an API promise. All documented
public behavior needs a destination; any platform/security divergence requires
a specific reason and an equivalent capability where feasible.

The registers MUST distinguish `implemented`, `planned`, `language-mapped`,
`security-mapped`, `documentation-error` and `unsupported`. Only entries with
passing evidence count as implemented. Unsupported public members prevent full
API coverage claims. The larger format specs remain additive requirements.

## 4. JavaScript Object Model

`Document(input?, context?)` and `Presentation(input?, context?)` are async
factories returning typed live document/presentation objects. They accept admitted
bytes, streams or an explicit capability-scoped VFS path. No-argument creation
uses an original authored default template. Context carries explicit I/O,
limits, cancellation, timestamps and any admitted font metrics needed by methods.
It MUST NOT derive authority, identity, fonts or time from the ambient host.

In-memory property access and model-only methods are synchronous. `save`, factory
loading and methods that admit an image/movie/embedded input are always async,
even when the supplied input is already bytes. Return types MUST NOT alternate
between a value and Promise according to input type. Serialization/publication
uses the same engine and protections as the CLI.

Primary object methods retain source spelling and positional parameter order
where JS can express it. Keyword-only arguments map to a trailing typed options
object with the same source field names. Any additional overload for named
arguments MUST be explicit in the register; no ambiguous dynamic argument guessing.
Missing optional arguments/`undefined` use the documented default. `null` maps
to explicit absence/inheritance where permitted, not to false/zero/empty string.

Ordinary sequences use zero-based numeric lookup, `.length` and
`Symbol.iterator`. Negative indexing and slicing map to explicit `.at(index)`
and `.slice(start, end)` where the source supports them. Invalid numeric access
must produce a documented bounds error, not silently return an unrelated item.
Keyed collections retain their key semantics: placeholder keys are placeholder
IDs, not positions; styles use names/IDs as specified; comment lookup uses IDs.
SDK indexes MUST NOT be confused with one-based CLI display positions.

Returned document/presentation-owned model objects are live views with explicit
owner identity. Immutable admitted values, such as standalone images and shared
length/color values, carry no document owner or mutation authority. A documented
replacement that invalidates a handle MUST invalidate it deterministically and
return the new handle. Cross-document object assignment without explicit import
fails. Collection membership/order and aliasing of merged cells MUST match the
documented behavior. Do not require Python wrapper-class identity merely because
an upstream mock-based test happens to assert it.

## 5. Values, Enums and Errors

Expose the complete documented unit helper set for each format, including EMU,
inch/cm/mm/point and format-specific twip/centipoint helpers. Lengths retain
exact integer storage within the supported safe range and provide explicit unit
accessors/conversion; unsafe/nonfinite values fail. They are JS value objects,
not subclasses of Python integers. Shared conversion rounding MUST agree across
both tools. Color helpers retain channel bounds and hex parsing semantics.

Enums retain neutral documented symbolic names, aliases and stable underlying
values, with typed distinctions where identical numbers mean different things.
Do not replace all enums with unvalidated numbers or strings. A source alias is
retained only if it is part of the documented API, not as a second JS naming style.

Bytes map to `Uint8Array`; streams map to explicit byte-source/sink capabilities.
Dates map to UTC `Date` values with documented precision, invalid-date rejection
and no implicit timezone guessing. Source tuple/list returns map to documented
readonly arrays or live collections according to ownership. Iterators use JS
iteration protocols and preserve traversal order. Numeric/property validation
and three-state formatting (`true`, `false`, `null`) MUST remain observable.

SDK errors expose neutral typed classes and the common stable error codes.
Source value/type/index/key errors map to explicit JS error categories in the
register; missing lookups that return absence remain absence, not exceptions.
Project-branded exception names are replaced, not copied. No silent exception
swallowing to make a ported test pass.

## 6. Behavioral Fidelity and Deliberate Differences

Whole-object `.text` setters and `clear()` MUST preserve their documented scope:
some replace runs/paragraphs and intentionally remove selected formatting.
Those operations are distinct from the format-preserving CLI `text replace`.
Their CLI routes MUST make full replacement explicit, for example resource
`set --text`. Required empty paragraphs and annotation markers must survive.

Methods/getters that create missing definitions or notes MUST retain those
documented side effects. Read-only CLI inspection MUST use noncreating queries,
not invoke those getters and accidentally mutate the package. Linked headers,
latent styles, placeholder insertion and graphic-frame return objects need
specific tests rather than a generic collection wrapper.

Image-size defaults, DPI fallback and hash metadata MUST be captured per API.
A documented SHA-1 image property is compatibility metadata only; package/source
identity and fixture verification continue to use SHA-256. Source image formats
need bounded characterization support or an explicit equivalent injected
capability; blanket raster-format rejection cannot count as full API parity.

Creation and comments use explicit context timestamps when the source API would
read the clock. Author/default-property strings and default template bytes are
original and neutral. These are documented determinism/branding differences,
not a reason to omit creation or comments. Scoped VFS capabilities replace
unrestricted filesystem access. Font metrics replace host font discovery.

Public `.element`/`.part` access maps to bounded documented JS XML/package views
with safe mutation and publication validation. It MUST NOT import an entire
Python XML library interface or expose ambient host resources. The register
must specify the public behaviors supported by these views and distinguish
documented XML operations from private implementation hooks.

## 7. CLI Integration

The object model and the CLI operation engine use the same domain behavior;
there must not be independent competing editors. The common CLI's versioned
operation IDs/options stay consistent and camelCase in JSON options. This is a
different surface from retained snake_case model methods, not a per-format split.
For example CLI `images replace` uses an operation backed by the image model;
the model still exposes documented picture properties such as `crop_left`.

Every documented public behavior MUST map to a direct CLI command or a validated
typed batch operation. Routine workflows get direct flags. Advanced batches use
explicit operation schemas and handles, not arbitrary method invocation,
JavaScript evaluation or unrestricted dynamic property access.

## 8. Test and Validation Matrix

| Area | Required evidence |
| --- | --- |
| Public surface | Every documented member/protocol/enum maps to a typed target and original acceptance case |
| Source tests | Every parameter variant and BDD example reconciles to the target API or a specific language/security mapping |
| Untested documented API | New independent original tests; absence of upstream tests is not an exclusion |
| Collections | Sequence versus keyed lookup, iteration, negative indexes, slices, bounds and invalidated handles |
| Mutation | Destructive setters versus preserving replacement, read-side effects, shared ownership and required empty nodes |
| Values | Null/false/zero, units, enums, UTC dates, byte ownership, coercion rejection and error categories |
| I/O | Always-async boundaries, explicit capabilities, cancellation, limits and atomic publication |
| Cross-tool consistency | Same common CLI paths, options, JSON/errors and SDK language mappings |
| Examples | Original JS equivalents of all user-guide workflows through public exports; no source project names in code |

## 9. Conformance Criteria

Whole-public-API coverage requires an evidence-backed disposition for every
documented member, no unsupported public behavior hidden as architecture-only,
and passing original surface/behavior/CLI tests. Supported language/security
mappings are listed publicly. Until then, report partial coverage and remaining
members explicitly. Exact Python drop-in compatibility MUST NOT be claimed.

Proposed example syntax, with original content and a caller-provided byte sink:

```javascript
const document = await Document();
document.add_heading("Coastal survey", 0);
document.add_paragraph("Spring observations").add_run(" — verified").bold = true;
await document.save(outputSink);

const presentation = await Presentation();
const slide = presentation.slides.add_slide(presentation.slide_layouts[0]);
slide.shapes.title.text = "Coastal survey";
await presentation.save(outputSink);
```

Actual public package import paths must be documented only after export and
packed-consumer verification. Examples are acceptance targets, not released APIs.
