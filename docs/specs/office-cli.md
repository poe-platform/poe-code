# Office CLI Specification

Status: Proposed

Implemented Through: Not applicable

Purpose: Define the shared command conventions for `docx` and `pptx`.

## Normative Language

MUST and MUST NOT identify requirements; SHOULD identifies a recommendation and
MAY identifies optional behavior. This contract defines proposed behavior only.

## 1. Problem Statement

Users should learn one command pattern for both utilities. Equivalent operations
MUST use the same names, option meanings, selection rules, output structure and
exit status. Format-specific features remain explicit rather than becoming
unrelated command dialects.

## 2. Goals and Non-Goals

The common CLI MUST make ordinary reading, text replacement, image operations and
property editing possible without JSON or knowledge of XML part IDs. Structured
JSON supports complex content and batches; it MUST NOT be the only route for
ordinary single edits. CLI and SDK MUST expose equivalent supported operations.

Consistency does not mean both formats support identical features. DOCX stories
and PPTX slides retain their own domain models and support levels. This contract
does not expand preservation-only features into semantic editing promises.

## 3. Authority and Grammar

This document is authoritative for shared CLI/SDK conventions. The format specs
define format behavior and limits and MUST NOT override shared option semantics.

```text
<tool> <operation> [<input>] [options]
<tool> <resource> <action> <input> [options]
<tool> diff <left> <right> [options]
```

`<tool>` is exactly `docx` or `pptx`. The operation/resource precedes the input.
Common options MAY occur anywhere after the command path, including after input.
`--` terminates option parsing so a filename beginning with `-` remains usable.
Exactly one input is required except creation/help/schema/capabilities/version,
two-input diff and explicitly declared multiple-input operations such as merge.

Resource families use plural names: `images`, `tables`, `styles`, `sections`,
`links`, `notes`, `comments`, `properties`, `shapes`, `charts`, `equations`,
`objects` and `signatures`, wherever the format supports that resource. Shared
action names are `list`, `get`, `add`, `set`, `remove`, `replace` and `extract`.
Use `set` for property updates and `replace` for content substitution, not
interchangeable `edit`/`update` variants. Only applicable actions are exposed.

Common operation paths are `create`, `inspect`, `validate`, `text`, `text replace`,
`xml get`, `xml set`, `template apply`, `batch`, `diff`, `extract`, `pack`,
`sanitize`, `help`, `schema`, `capabilities` and `version`.
`text` is a deliberate shorthand for `text get`; it is identical in both tools.
`--help`/`-h` and `--version` are consistent discovery aliases. `-o` is the only
required output alias, identical to `--output`.

There are no `image`, `table` or `metadata` compatibility spellings: use `images`,
`tables` and `properties`. Literal replacement is `text replace`, not a separate
top-level `replace`. Format-only resources retain this resource/action pattern:
for example `docx revisions accept`, `pptx slides move`, `pptx layouts apply`.

## 4. Common Operations and Options

| Operation | Required common arguments | Behavior |
| --- | --- | --- |
| `create` | `--output PATH` | Create an original document; `--template PATH` selects a template |
| `inspect` | input | Summary and addressable locations; `--json` for structured data |
| `text` / `text get` | input | Logical text; supports common selection/scope options |
| `text replace` | input, `--find TEXT`, `--with TEXT` | Literal replacement; exactly one of `--first`, `--all`, `--occurrence N` |
| `images list` | input | Occurrences by default; `--unique` groups resources by content hash |
| `images add` | input, `--file PATH` | Insert explicit image bytes at a format-specific placement |
| `images replace` | input, selection, `--file PATH` | Replace selected occurrences; `--shared` explicitly replaces the shared resource |
| `images extract` | input, `--output-dir DIR` | Extract original bytes with safe names and a manifest |
| `properties list` | input | List properties and types |
| `properties get` | input, `--name NAME` | Read a named property |
| `properties set` | input, `--name NAME`, `--value VALUE` | Use the declared type for a known property; new custom properties require `--type TYPE` |
| `properties remove` | input, `--name NAME` | Remove the selected property |
| `batch` | input, one of `--ops-file PATH` / `--ops-json JSON` | Execute versioned ordered operations with one publication |
| `template apply` | input, one of `--data-file PATH` / `--data-json JSON` | Bind structured records using the format's template rules |
| `diff` | left, right | Compare structure; common equality exit status below |
| `schema` | optional command path | Versioned machine-readable operation/option/result schemas |
| `capabilities` | optional input | Support levels and host capabilities, optionally checked against input features |

Shared flags are `--json`, `--output`/`-o`, `--output-dir`, `--in-place`, `--force`,
`--dry-run`, `--select`, `--scope`, `--first`, `--all`, `--occurrence`,
`--allow-empty` and `--limit NAME=VALUE`. They MUST have identical meanings where
applicable, and MUST be rejected where inapplicable rather than silently ignored.
Repeated scalar options and conflicting selection cardinalities are usage errors.
`--limit` MAY repeat for distinct names; duplicate names fail. Limits can lower,
but never exceed, explicit trusted host ceilings. No hidden environment settings.

Dates and authors required by an operation are explicit `--timestamp` and
`--author` options, with identical corresponding SDK fields. No implicit clock
or identity discovery. Geometry accepts explicit `emu`, `in`, `cm`, `mm` or `pt`
suffixes, with the same conversion/rounding rules in both formats. Image sizing
uses `--width`, `--height`, and `--fit contain|cover|stretch` consistently.
Convert to integer EMUs once, rounding nearest with halfway values away from zero;
validate finite safe ranges before and after conversion. Property value parsing
uses the declared property schema, rejects invalid values and never guesses a
custom property's type from its spelling. Explicit conflicting `--type` fails.

## 5. Selection and Scope

`--select TOKEN` accepts a fingerprinted location emitted by inspection/listing.
It fails if stale. Simple selectors resolve against the input acquired for the
current command and MUST NOT require users to supply fingerprints manually.
Examples include `--paragraph 5`, `--table 2`, `--image 1`, and PPTX
`--slide 3 --shape title`. Ordinal values are one-based and scoped by owner;
shape labels are not assumed unique. Ambiguous labels fail with candidate
locations rather than choosing the first match. `--cell B2` uses logical table
coordinates and rejects a merged-cell selection that the operation cannot resolve.

An opaque token and simple selectors MUST NOT be mixed. `--all` applies only
inside the explicit scope; it MUST NOT silently select notes/masters/headers or
shared resources. Missing selection on a destructive resource edit is an error.
`--first`, `--all` and `--occurrence N` set text-match cardinality. Ordinary edits
resolve one resource unless all-selection is explicit. Empty search results are
successful reads; a mutation matching nothing fails unless `--allow-empty`.

Default text scope is document body for DOCX and slide-local content in slide-list
order for PPTX. `--scope` selects explicit format-specific scopes. Both utilities
MUST document them in generated help/schema; unknown scopes fail. Ordinary slide
edits MUST NOT mutate masters; ordinary image replacement MUST NOT change other
occurrences sharing the resource without `--shared`.

## 6. Output, Streams and Publication

Read operations emit human-readable data to stdout by default; `--json` emits one
JSON value. Diagnostics and progress go to stderr. Binary stdout has no banners,
progress or JSON mixed into it. Input `-` means stdin; each invocation has only one
stdin consumer, so document bytes and operations JSON cannot both consume stdin.

Package mutations require exactly one of `--output PATH` or `--in-place`.
Creation requires `--output`. Stdin cannot be edited in place. Existing output
paths require `--force`; `--in-place` itself authorizes replacing the selected
input after stale-state checks. `--force` is only valid with an explicit output
destination and never bypasses validation, limits, protection or permissions.
Output aliases of the input MUST require `--in-place`, not `--force`.

`--output -` emits the complete bounded, validated package and conflicts with
`--json`. Package stdout cannot be rolled back after transport begins. Multi-file
operations use `--output-dir` and produce a manifest; they MUST use an adapter
transaction or require explicit `--allow-partial-output`, never pretend to offer
atomicity on an incapable adapter. Existing files in output directories MUST NOT
be deleted as cleanup or silently replaced without explicit force intent.

`--dry-run` performs admission, selection and semantic validation and reports
effects, with no publication. It does not require output flags; if supplied, they
are validated as proposed destinations. `--json` works for dry-run regardless of
the proposed binary output destination, because no binary stream is produced.
Errors before publication leave inputs and preexisting destinations unchanged.

## 7. JSON and SDK Contract

Version 1 results contain `version`, `operation`, `ok`, `data`, `warnings`,
`errors`, `affected` and `locations`. Operation names use the CLI path with dots,
such as `text.replace` and `images.replace`. `affected` is a count of directly
targeted logical objects, with operation-specific details in `data`. It is zero
for reads and failed prepublication mutations. Locations carry owning scope and
fingerprint; warnings/errors contain stable codes and bounded public messages.
On error `ok` is false and `data` is null, except an explicit partial-output
failure may include a precise published-output manifest. No document text leaks
into diagnostics by default. Object/list ordering is deterministic.

Both SDKs use the same operation IDs, versioned input/result schemas and common
option semantics. Camel-case SDK option names correspond mechanically to CLI
kebab-case names, for example `inPlace`, `dryRun`, `allowEmpty`, `outputDir`.
CLI JSON input is validated by the same schema as SDK input. A batch envelope is
`{ "version": 1, "operations": [...] }`; each item names its operation and typed
arguments. Unknown fields fail. No SDK-only supported feature is allowed without
a declared CLI operation or the same typed operation available through batch.
Common single edits MUST still have direct flags as specified above.

## 8. Exit Status and Failure Model

| Exit | Meaning for ordinary commands |
| --- | --- |
| 0 | Successful read, mutation or explicitly allowed no-change result |
| 1 | Invalid document, unsupported edit/profile, stale/ambiguous/missing selection or validation failure |
| 2 | Usage or operation-schema error |
| 3 | I/O or publication failure |
| 4 | Resource limit exceeded |
| 130 | Cancellation |

`diff` consistently follows comparison-command semantics: 0 means equal, 1 means
different, and 2 means comparison failed for any reason except cancellation,
which returns 130. A completed differing comparison still has `ok: true` and
`data.equal: false`; a failed comparison has `ok: false` and a detailed error code.
SDKs expose equality as data, never an exception merely because documents differ.
They preserve detailed error categories independently of shell exit codes.

## 9. Test and Validation Matrix

`capabilities --json` MUST classify every declared feature as `edit`, `read`,
`preserve` or `reject`, with supported subsets and reasons. With input, it also
reports detected feature requirements and affected unsupported operations. Unknown
content is reported explicitly; absence of a known tag is not proof of support.

The command register MUST map every format-spec feature ID to operation paths,
arguments, SDK operation IDs, read/edit/preserve/reject levels and independent
acceptance cases. Preservation-only features map to inspection plus retention
tests, not nonexistent editing commands. Every supported public operation has
generated help and schema. There MUST be no unaccounted feature or SDK-only gap.

| Contract | Required evidence |
| --- | --- |
| Naming and grammar | Same shared paths/actions/options in both schemas; old conflicting spellings rejected |
| Simple usability | Create, extract text, replace text, list/replace/extract images, set properties without JSON/XML IDs |
| Selection | One-based positions, ambiguous names, stale tokens, scope isolation, merged-cell behavior |
| Shell ergonomics | Spaces, Unicode, `--`, quoting, stdin, pipes and executable safe-bash `.sh` workflows |
| Output and failures | Same envelopes/statuses, binary purity, force/alias checks, dry-run and partial-output reports |
| Coverage | Every format feature mapped and every supported SDK operation accessible through CLI |
| Help | Inspected help/error screenshots; no screenshot unit tests |

## 10. Conformance Criteria

Both utilities conform only when shared operation schemas agree, the validation
matrix passes through actual public CLI and SDK entry points, and the feature
register has no unexplained gaps. Examples below are proposed acceptance targets,
not claims that the commands are currently available.

```bash
docx text report.docx
pptx text slides.pptx

docx text replace report.docx --find 'Draft' --with 'Final' --all -o final.docx
pptx text replace slides.pptx --find 'Draft' --with 'Final' --all -o final.pptx

docx images list report.docx --json
pptx images list slides.pptx --json

docx images replace report.docx --image 1 --file logo.png --in-place
pptx images replace slides.pptx --slide 3 --image 1 --file logo.png --in-place

docx properties set report.docx --name title --value 'Annual review' --in-place
pptx properties set slides.pptx --name title --value 'Annual review' --in-place

docx capabilities report.docx --json
pptx capabilities slides.pptx --json
```
