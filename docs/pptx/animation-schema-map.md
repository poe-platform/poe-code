# Animation inventory schema and API research

This receipt covers F45's bounded timing inspection. It does not complete F46
editing, playback verification, or the proposed live media object model. The
source baseline and provenance remain in [the test audit](upstream-test-audit.md)
and [the API audit](upstream-api-audit.md). [The focused ledger](animation-case-map.json)
retains 48 unit variants and six expanded BDD scenarios, including all three
video-timing variants. There are no directly timing/animation-named BDD scenarios
in that baseline, and no timing/animation/trigger-named public member in the reconciled API inventory. Generic sequence collection tests are unrelated to timing.

The three timing variants respectively create timing when absent, append a second
video, and replace timing whose child list is absent. Read-only inspection of
original structures is useful observational coverage, but cannot satisfy any of
those creation assertions. All creation obligations stay pending. Adjacent media
rows retain their existing evidence and limitations; this receipt does not upgrade
them. The original TypeScript tests use authored XML and explicit expectations;
no source implementation or fixture bytes were copied. The existing standalone
[MIT notice](upstream-license-notice.txt) remains retained.

## Format mapping

The format baseline is ECMA-376 Part 1 fifth edition (December 2016), as pinned
by the format specification. The links below are vendor schema/API documentation
consulted September 13, 2026; their remarks cite ISO/IEC 29500 first edition. They
support element interpretation, not a claim of fifth-edition schema validation
or complete animation support. No extension is inferred solely from its prefix.

| Structure                                                                    | Observable interpretation                                                                                                                             | Evidence                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `timing`, `tnLst`, `childTnLst`, `subTnLst`                                  | Retain document hierarchy and ordering; a sub-time-node list is distinct from a normal child list. Runtime scheduling remains opaque.                 | [Sub-time-node list](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.presentation.subtimenodelist?view=openxml-3.0.1)                                                                                                                                                       |
| `seq`, `par`, `excl`                                                         | Classify sequence and parallel nodes; retain exclusive nodes as opaque structure without scheduling them.                                             | [Sequence time node](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.presentation.sequencetimenode?view=openxml-3.0.1), [time-node child alternatives](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.presentation.subtimenodelist?view=openxml-3.0.1) |
| `cTn`                                                                        | Retain timing identity and raw timing/preset/node-type attributes, without assigning undocumented defaults.                                           | [Common time node](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.presentation.commontimenode?view=openxml-3.0.1)                                                                                                                                                          |
| `cond`, condition lists, `tn`, `tgtEl`                                       | Expose event/delay and timing or object references. Stored reference edges are distinct from XML parent/child edges.                                  | [Condition](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.presentation.condition?view=openxml-3.0.1)                                                                                                                                                                      |
| `anim`, `animClr`, `animEffect`, `animMotion`, `animRot`, `animScale`, `set` | Identify behavior kind. Keep motion path strings and unsupported behavior XML opaque.                                                                 | [Motion behavior](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.presentation.animatemotion?view=openxml-3.0.1), [behavior alternatives](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.presentation.subtimenodelist?view=openxml-3.0.1)              |
| `audio`, `video`, `cMediaNode`                                               | Retain media interaction, target and timing hierarchy; volume, mute, slide count and stopped visibility are declared metadata, not verified behavior. | [Common media node](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.presentation.commonmedianode?view=openxml-3.0.1)                                                                                                                                                        |

Unknown namespaces/subtrees retain raw XML and qualified names. Strict and
Transitional namespace handling follows package XML admission. Inventory does
not normalize paths, evaluate formulas/commands, resolve runtime triggers, open
media resources, or repair missing lists. A missing target, duplicate timing ID
or cycle is a graph diagnostic; it is not permission to silently redirect an edge.
Bounds come from caller-supplied byte/archive/XML/relationship limits; expanded reference destinations per slide also cannot exceed xmlLimits.maxNodes. Traversal
must terminate independently of cycles; reference analysis must not recursively
execute a graph. Deterministic slide-list order and XML preorder are structural
ordering, not visual or playback ordering.

## Exact JS and security mappings

`readAnimations(input, options, context)` is an asynchronous detached inventory
operation. Byte acquisition uses explicit input/context capabilities. A string
is not unrestricted filesystem authority; CLI input is read through safe-bash's
configured VFS. No ambient filesystem, clock, network, renderer or native runtime
is available through this operation. Raw XML and motion-path strings are data;
they never become JavaScript, XPath, shell commands or executable animation code.

Result arrays are readonly snapshots. Their array indexes are ordinary zero-based
JavaScript indexes; CLI `--slide` is one-based and IDs remain opaque strings scoped
to the owning slide. Missing metadata remains null/absence according to the typed
result, not a fabricated zero or resolved target. Node identities used for tree
navigation are distinct from document timing IDs, so duplicate document IDs can
be represented and diagnosed. `executionVerified` is always false. Shared SDK
errors retain stable categories; CLI mapping is 1 for document/selection failure,
2 for invalid usage, 3 for I/O, 4 for resource limits and 130 for cancellation.

This operation is not a renamed live `Movie`, `_MediaFormat` or `SlideShapes`
interface. The focused ledger individually retains all 48 directly media-related
public API rows: four previously implemented enum values and 44 pending public
model records. Inherited geometry/actions, returned objects, enums/helpers,
constructors and untested members remain public obligations. Leading underscores
do not justify exclusion. Their complete transitive closure remains in
[the public register](public-api-map.json), with [J01–J10 mappings](api-language-mappings.md).

The documented `add_movie` return annotation drifts from actual behavior: the
future target returns `Movie`, not `BaseShape`. That future model must retain
neutral `add_movie`, `media_type`, `media_format` and `poster_frame` spellings;
raw XML constructor internals do not imply unrestricted public allocation.
Explicit byte admission is asynchronous; owned object getters remain direct
properties. Inventory adds no model constructor, mutation, poster-default or
collection semantics. The model's nullable poster default and command contract's
explicit poster requirement remain distinct pending obligations.

Historical audit phrases such as “adaptation not started” describe the original
checkpoint. They do not erase later bounded implementation receipts. Conversely,
a completed read inventory does not establish whole-public-API parity. QA
procedures and verification commands belong in `docs/plans`; this file records
schema interpretation and evidence boundaries only.
