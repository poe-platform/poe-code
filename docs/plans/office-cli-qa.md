# Paired Office CLI agent QA

Status: Partially executed for PPTX on 2026-09-13; DOCX not run. See the
[execution receipt](../pptx/office-cli-execution-20260913.md) for exact scope,
failures and unrun cases. The historical documentation-only checkpoint below is
retained; it is not the current execution status.

Authority: [shared CLI](../specs/office-cli.md), [shared SDK](../specs/office-sdk.md),
[PPTX](../specs/pptx.md) and [DOCX](../specs/docx.md). Shared contracts govern
names, options, JSON, statuses and SDK parity. The
[PPTX command register](../pptx/command-coverage.json) supplies proposed detailed
PPTX arguments; it is not a released schema. See
[review evidence](../pptx/office-cli-qa-review.md) for input accounting and drift.
The [DOCX command register](../docx/command-coverage.json) supplies the counterpart
proposals; [DOCX review evidence](../docx/office-cli-qa-review.md) records the
current inventory, exact JS/security mappings and unresolved schema boundaries.
Neither register is implementation evidence. This DOCX documentation task does
not execute the recipes or advance later implementation tasks.

## Execution boundary and preparation

This is an agent-executed Markdown procedure, not a runner script. All rows are
`proposed_not_run` until an implementation executes them; subsequent receipts
assign only the actually observed checks. Documentation checks,
source test passes and acquisition inventories never promote a row to passed.

For future execution, supply an explicit rooted in-memory VFS and bounded byte
streams to safe-bash and the SDK. Paths below are inside that VFS, not ambient
host paths. No implicit network, native runtime, host fonts/time/identity or
external-link resolution is permitted. Use caller-supplied timestamps where needed.
No reference-project names belong in product code, comments, tests, fixtures or
CLI output; research and required standalone notices retain provenance.
Supply the fixed context timestamp `2026-01-02T03:04:05Z` for fixture creation
where required by the model contract. Bare Q01 must either create without
inventing time metadata or report a missing explicit capability; it must never
read the host clock. Record any mismatch with its expected successful creation
as a contract/implementation gap, not a passed case.

Author these tiny independent inputs through the public SDK once available:

- `Coastal café.docx` and `Coastal café.pptx`: two body paragraphs/two slides,
  each with `Draft café 🌊` split across styled runs; literal `Draft` twice in
  the default scope, once in a DOCX header/PPTX notes, and once in a PPTX master.
  Include a hyperlink and an untouched styled paragraph/shape.
- Two image occurrences sharing one original media resource and one distinct
  resource. PPTX slide 1 has both shared occurrences. Use authored bytes for
  `new emblem.png`. Record original media hashes and occurrence locations.
- A 2-by-2 table with unmerged B2 and a separate merged-table variant. Use
  `table 1` in the body/slide 1. Include two PPTX shapes both named `title`.
- Original `Letter.dotx` and `Briefing.potx` templates with a declared text
  binding `heading`; a missing-binding variant and a repeated-binding variant.
  Prepare `docx bindings.json` and `pptx bindings.json` using each format's
  declared binding schema. A plain token spelling alone is not a binding contract.
- Independently admitted copies named `-résumé draft.docx` and
  `-résumé draft.pptx`, malformed packages, and sentinel destination bytes.

Do not assume bare `create` populates any of these rich inputs. Test minimal
creation separately, then prepare the rich inputs with declared public methods
and typed operations. Missing creation/binding schemas block those setup steps;
record the gap rather than inventing undocumented flags or adopting publisher bytes.
Reset each mutation case to its admitted original unless a row explicitly tests
an ordered sequence. Record input hashes, decoded part hashes, selected locations,
expected text/media and adapter permissions before execution.

## Ordinary workflows, side by side

Each row uses fresh output paths. Successful commands return 0 unless stated.
Repeat reads with `--json`; compare direct CLI results with the same SDK operation.

| ID / purpose               | DOCX recipe                                                                                           | PPTX recipe                                                                                                   | Expected observation                                                                                      |
| -------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Q01 minimal creation       | `docx create -o 'Empty café.docx'`                                                                    | `pptx create -o 'Empty café.pptx'`                                                                            | Original valid package; reopen, validate and inspect; no imported defaults or implicit metadata           |
| Q02 create from template   | `docx create --template Letter.dotx -o letter.docx`                                                   | `pptx create --template Briefing.potx -o briefing.pptx`                                                       | Explicit template admission, retained intended structure, correct output content types                    |
| Q03 text                   | `docx text 'Coastal café.docx'`                                                                       | `pptx text 'Coastal café.pptx'`                                                                               | Same output as `text get`; body/slide-list scope, no implicit header/notes/master text                    |
| Q04 preserving replacement | `docx text replace 'Coastal café.docx' --find Draft --with Final --all -o final.docx`                 | `pptx text replace 'Coastal café.pptx' --find Draft --with Final --all -o final.pptx`                         | Two scoped matches; surrounding formatting/hyperlink and excluded scopes unchanged                        |
| Q05 occurrence             | `docx text replace 'Coastal café.docx' --find Draft --with Final --occurrence 2 -o second.docx`       | `pptx text replace 'Coastal café.pptx' --find Draft --with Final --occurrence 2 -o second.pptx`               | Only second match; repeat with `--first` and check first only                                             |
| Q06 image occurrences      | `docx images list 'Coastal café.docx' --json`                                                         | `pptx images list 'Coastal café.pptx' --json`                                                                 | Three occurrences; owner-scoped fingerprinted locations                                                   |
| Q07 unique images          | `docx images list 'Coastal café.docx' --unique --json`                                                | `pptx images list 'Coastal café.pptx' --unique --json`                                                        | Two resources grouped by content hash, with occurrence associations                                       |
| Q08 replace occurrence     | `docx images replace 'Coastal café.docx' --image 1 --file 'new emblem.png' -o image.docx`             | `pptx images replace 'Coastal café.pptx' --slide 1 --image 1 --file 'new emblem.png' -o image.pptx`           | Other shared occurrence unchanged; preserved placement/crop according to declared image contract          |
| Q09 shared replacement     | `docx images replace 'Coastal café.docx' --image 1 --file 'new emblem.png' --shared -o shared.docx`   | `pptx images replace 'Coastal café.pptx' --slide 1 --image 1 --file 'new emblem.png' --shared -o shared.pptx` | Both shared occurrences change with explicit affected-occurrence report; distinct resource unchanged      |
| Q10 image extraction       | `docx images extract 'Coastal café.docx' --output-dir 'docx images'`                                  | `pptx images extract 'Coastal café.pptx' --output-dir 'pptx images'`                                          | Original bytes/hash, safe deterministic names and manifest; no rasterization                              |
| Q11 read cell              | `docx tables get 'Coastal café.docx' --table 1 --cell B2 --json`                                      | `pptx tables get 'Coastal café.pptx' --slide 1 --table 1 --cell B2 --json`                                    | Logical cell coordinates and owner identity, independent of XML part names                                |
| Q12 set cell               | `docx tables set 'Coastal café.docx' --table 1 --cell B2 --text 'Harbor 🌊' -o cell.docx`             | `pptx tables set 'Coastal café.pptx' --slide 1 --table 1 --cell B2 --text 'Harbor 🌊' -o cell.pptx`           | Whole-cell text assignment, documented run removal and required paragraph retained; other cells unchanged |
| Q13 property list/get      | `docx properties list 'Coastal café.docx' --json`                                                     | `pptx properties list 'Coastal café.pptx' --json`                                                             | Types and values; follow with `properties get INPUT --name title`                                         |
| Q14 property set           | `docx properties set 'Coastal café.docx' --name title --value 'Coastal café' --in-place`              | `pptx properties set 'Coastal café.pptx' --name title --value 'Coastal café' --in-place`                      | Declared string type, exact Unicode, no automatic revision increment                                      |
| Q15 custom property        | `docx properties set 'Coastal café.docx' --name Review --type boolean --value false -o property.docx` | `pptx properties set 'Coastal café.pptx' --name Review --type boolean --value false -o property.pptx`         | Boolean false, not inferred string/null; omission of new custom type fails                                |
| Q16 property removal       | `docx properties remove property.docx --name Review --in-place`                                       | `pptx properties remove property.pptx --name Review --in-place`                                               | Only requested custom property removed                                                                    |
| Q17 template binding       | `docx template apply Letter.dotx --data-file 'docx bindings.json' -o bound.docx`                      | `pptx template apply Briefing.potx --data-file 'pptx bindings.json' -o bound.pptx`                            | Declared bindings filled, unsupported/missing bindings fail before publication                            |
| Q18 batch file             | `docx batch 'Coastal café.docx' --ops-file 'office edits.json' -o batch.docx`                         | `pptx batch 'Coastal café.pptx' --ops-file 'office edits.json' -o batch.pptx`                                 | Ordered effects with one final publication; same domain result as direct operations                       |
| Q19 equal diff             | `docx diff 'Coastal café.docx' 'Coastal café.docx' --json`                                            | `pptx diff 'Coastal café.pptx' 'Coastal café.pptx' --json`                                                    | Exit 0, `ok: true`, `data.equal: true`                                                                    |
| Q20 different diff         | `docx diff 'Coastal café.docx' final.docx --json`                                                     | `pptx diff 'Coastal café.pptx' final.pptx --json`                                                             | Exit 1, `ok: true`, `data.equal: false`; expected text changes only                                       |
| Q21 global capabilities    | `docx capabilities --json`                                                                            | `pptx capabilities --json`                                                                                    | Actual edit/read/preserve/reject support, subsets, reasons and host capabilities                          |
| Q22 input capabilities     | `docx capabilities 'Coastal café.docx' --json`                                                        | `pptx capabilities 'Coastal café.pptx' --json`                                                                | Detected requirements and affected unsupported operations; unknown content explicit                       |

For Q18, the proposed `office edits.json` content is the following shared version-1
batch. Common property fields need no format-specific selector or batch options.
Use the same content with `--ops-json` and require equivalent results. Unknown
fields, operation IDs and versions are rejected, never interpreted as code.

```json
{
  "version": 1,
  "operations": [
    {
      "operation": "properties.set",
      "arguments": { "name": "title", "value": "Coastal café" }
    },
    {
      "operation": "properties.set",
      "arguments": { "name": "subject", "value": "Harbor observations" }
    }
  ]
}
```

For PPTX Q17, the register's proposed binding payload is
`[{"name":"heading","kind":"text","text":"Coastal café"}]`. Repeat using
`--data-json` with that exact payload, subject to the authored template binding.
DOCX uses its own declared binding schema; do not infer identical payloads from
the shared command path. Both reject simultaneous file/inline data sources.
The current DOCX register names `DeclaredTemplateRecord` but does not define its
record fields. Q17 setup and its ambiguity/expansion variants remain blocked on
a concrete binding schema; no fabricated DOCX JSON example is supplied here.

## Shell, streams, selectors and publication

`INPUT` below means the admitted corresponding document. `TOKEN` and `OLD_TOKEN`
are literal substitution slots for real returned locations, not tokens to invent.
Put all options before `--`; everything after it is positional, even flag-like text.

| ID / purpose                   | DOCX recipe                                                                              | PPTX recipe                                                                              | Required result                                                                                 |
| ------------------------------ | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Q23 leading dash               | `docx text -- '-résumé draft.docx'`                                                      | `pptx text -- '-résumé draft.pptx'`                                                      | Exact filename, spaces and Unicode; equivalent JSON with `--json` before `--`                   |
| Q24 document stdin             | `docx text - < 'Coastal café.docx'`                                                      | `pptx text - < 'Coastal café.pptx'`                                                      | One bounded binary stdin consumer; same text as Q03                                             |
| Q25 operations stdin           | `docx batch 'Coastal café.docx' --ops-file - -o stdin.docx < 'office edits.json'`        | `pptx batch 'Coastal café.pptx' --ops-file - -o stdin.pptx < 'office edits.json'`        | Stdin owned by operations JSON, document from VFS                                               |
| Q26 competing stdin            | `docx batch - --ops-file - -o invalid.docx`                                              | `pptx batch - --ops-file - -o invalid.pptx`                                              | Usage exit 2 before waiting/consuming; no output                                                |
| Q27 binary stdout pipe         | See DOCX pipeline below                                                                  | See PPTX pipeline below                                                                  | Inspect each command's status and byte stream; no banner/JSON/progress mixed with package bytes |
| Q28 dry-run                    | `docx text replace 'Coastal café.docx' --find Draft --with Final --all --dry-run --json` | `pptx text replace 'Coastal café.pptx' --find Draft --with Final --all --dry-run --json` | Effects reported, no destination required and no writes                                         |
| Q29 dry-run stdout destination | `docx properties set INPUT --name title --value Final --dry-run --output - --json`       | `pptx properties set INPUT --name title --value Final --dry-run --output - --json`       | JSON allowed because no binary publication; validate proposed destination                       |
| Q30 in-place                   | `docx text replace INPUT --find Draft --with Final --first --in-place`                   | `pptx text replace INPUT --find Draft --with Final --first --in-place`                   | Conditional/atomic replacement; stale source or incapable adapter fails before writing          |
| Q31 opaque selector            | `docx images replace INPUT --select TOKEN --file 'new emblem.png' --dry-run --json`      | `pptx images replace INPUT --select TOKEN --file 'new emblem.png' --dry-run --json`      | Correct occurrence; combining token with `--image 1` fails usage 2                              |
| Q32 stale selector             | `docx images replace INPUT --select OLD_TOKEN --file 'new emblem.png' --in-place --json` | `pptx images replace INPUT --select OLD_TOKEN --file 'new emblem.png' --in-place --json` | After an intervening edit to that input, exit 1; unchanged post-intervention input              |
| Q33 missing match              | `docx text replace INPUT --find Absent --with Final --all --dry-run --json`              | `pptx text replace INPUT --find Absent --with Final --all --dry-run --json`              | Exit 1; repeat with `--allow-empty`, exit 0 and no changes                                      |
| Q34 cardinality conflict       | `docx text replace INPUT --find Draft --with Final --first --all --dry-run`              | `pptx text replace INPUT --find Draft --with Final --first --all --dry-run`              | Usage 2; omitted cardinality and repeated scalar options also fail                              |
| Q35 merged cell                | `docx tables set INPUT --table 1 --cell B2 --text Final --dry-run`                       | `pptx tables set INPUT --slide 1 --table 1 --cell B2 --text Final --dry-run`             | On unresolved merged-cell variant, selection failure 1; no silent neighbor/origin choice        |

For Q27, execute the unescaped pipes as normal safe-bash syntax:

```bash
docx create --output - | docx text -
pptx create --output - | pptx text -
```

1. **Ambiguity and recovery:** run `pptx text replace INPUT --slide 1 --shape title
--find Draft --with Final --first --dry-run --json` on duplicate names. Require
   exit 1 and bounded candidate locations, then inspect and retry with exactly one
   fresh `--select` token. For DOCX, use an authored ambiguous template binding;
   require a missing/ambiguous binding error rather than arbitrary selection.
   DOCX has no invented `--shape title` equivalent. Re-list after Q32 and retry
   with a fresh token only after reviewing the new target.
2. **Scope:** discover valid scopes in help/schema. Repeat Q04 in explicit DOCX
   header/PPTX notes and masters scopes; only that scope changes. Unknown scopes
   fail usage validation. Simple ordinals are one-based within their owner;
   zero/negative ordinals fail. SDK sequence positions remain zero-based and
   placeholder IDs remain sparse keys.
3. **Destinations:** omit both output modes on a real mutation, supply both, use
   `--in-place` on stdin, or use `--force` without an explicit destination: usage
   error 2. Existing output without force fails without overwriting it; retry a
   corrected explicit destination with `--force`. An output alias of input still
   requires `--in-place`; force never grants permissions or skips validation.
   Add `--json` to a real `--output -` mutation: usage 2, no binary prefix emitted.
4. **Extraction transactions:** Q10 uses an adapter transaction. On an incapable
   adapter require rejection before writes; retry only with explicit
   `--allow-partial-output`. Inject failure after one published file and require
   exit 3 with exact partial manifest. Existing unrelated files survive, including
   when force is requested. Verify safe collision handling for Unicode, traversal
   and case-equivalent names. Never remove a directory as recovery.
5. **Batch rollback:** append a valid-schema operation selecting an absent resource
   after Q18's first property edit. Semantic failure is exit 1 and nothing is
   published. Repeat with an unknown field (exit 2 before operations run), a
   cumulative limit breach (4), cancellation (130), and injected publication
   failure (3). Retry only corrected intent or explicitly retryable I/O; re-admit
   and re-inspect after stale-state failures. No automatic force retry.
6. **Template bounds:** exercise repeated bindings and expansion limits; omitted
   required bindings, wrong binding kinds and unsupported edits fail without
   mutation. Binding text that resembles code remains literal data. A binding
   pointing at a URL cannot grant network authority.

## Help, errors and shared SDK acceptance

| ID                          | DOCX recipe                           | PPTX recipe                           | Required result                                                                                         |
| --------------------------- | ------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Q36 help                    | `docx --help`                         | `pptx --help`                         | Compare with `-h` and `help`; common naming and usable examples                                         |
| Q37 nested help             | `docx help images replace`            | `pptx help images replace`            | Required file/selection, shared-resource effects and applicable flags explained                         |
| Q38 schema                  | `docx schema text replace`            | `pptx schema text replace`            | Versioned input/result schema, literal operation ID `text.replace`, cardinality and supported selectors |
| Q39 version                 | `docx --version`                      | `pptx --version`                      | Same discovery convention as `version`; no input needed                                                 |
| Q40 failed diff             | `docx diff INPUT missing.docx --json` | `pptx diff INPUT missing.pptx --json` | Exit 2 and `ok: false`; cancellation is 130                                                             |
| Q41 legacy grammar rejected | `docx image list INPUT`               | `pptx image list INPUT`               | Usage 2 with helpful plural spelling; also reject `table`, `metadata` and top-level `replace`           |

Inspect terminal screenshots of root/nested help, a successful ordinary edit,
ambiguous/stale selection errors and a schema error using the maintained
`screenshot-poe-code` route once the CLI is reachable through it. Check wrapping,
Unicode, actionable diagnostics, and stdout/stderr separation. Do not write
screenshot unit tests or claim screenshots exist before execution.

For every JSON read/mutation check exactly the shared fields `version`,
`operation`, `ok`, `data`, `warnings`, `errors`, `affected`, `locations`.
Reads and failed prepublication mutations have `affected: 0`. Errors have
`ok: false` and `data: null`, except explicit partial-output failures. Check
stable codes, deterministic ordering, owning scope/fingerprint and absence of
sensitive document text in diagnostics. Successful differing diff is not an error.
Ordinary statuses are 0 success, 1 document/selection/unsupported/validation,
2 usage/schema, 3 I/O/publication, 4 limits, 130 cancellation. Diff uses 0 equal,
1 different, 2 comparison trouble, 130 cancellation.

Run matching SDK operations with camelCase options (`dryRun`, `inPlace`,
`outputDir`, `allowEmpty`) through the same engine. Reject unknown/inapplicable
options equally in CLI, JSON and SDK. Enumerate generated schema/help for every
supported operation and compare capabilities against actual behavior. Preservation
support must expose inspection/retention, not a fictional editor.

These workflows do not replace whole-public-API acceptance. Reconcile every
inventory record, inherited member, enum/alias, helper, collection, returned
underscore-prefixed interface and API without upstream tests to the declared
signature and an original test. Retain neutral model names (`text_frame`,
`core_properties`, `add_slide`); no blanket camelCase aliases. Verify async
admission/save, collection bounds/slices, live ownership, invalidated handles,
null versus false/zero, unit rounding, dates, image metadata, creating getters
and bounded XML/package views according to the exact mappings in the review.
CLI reads must not invoke creating model getters. Advanced operations use closed
typed batch schemas, never arbitrary method evaluation.
Use the [DOCX mapping table](../docx/office-cli-qa-review.md#exact-js-and-security-mappings)
for DOCX and the linked PPTX review for PPTX. A format-specific value/helper does
not create an equivalent in the other SDK. Conflicting shared language mappings
remain visible gaps until reconciled and tested; neither recipe count nor a
reference test pass establishes whole-public-API coverage.

## Additional paired recovery recipes

These Q42–Q49 cases are `proposed_not_run` for both tools. `INPUT` denotes the
fresh corresponding admitted fixture; `TOKEN` is a returned location. Use the
Q18 file's exact JSON for inline operations, and declared format-specific binding
JSON for templates. Do not run these on the ambient host shell.

| ID / purpose                   | DOCX recipe                                                                                | PPTX recipe                                                                                  | Required observation                                                                                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q42 help for cells             | `docx tables set --help`                                                                   | `pptx tables set --help`                                                                     | B2 logical addressing, owner selectors, destructive text assignment and output rules agree with schema                                                   |
| Q43 missing resource selection | `docx images replace INPUT --file 'new emblem.png' --dry-run --json`                       | `pptx images replace INPUT --file 'new emblem.png' --dry-run --json`                         | Reject without writes; inspect images and retry Q31 with one fresh location                                                                              |
| Q44 template stdin owner       | `docx template apply Letter.dotx --data-file - -o stdin-bound.docx < 'docx bindings.json'` | `pptx template apply Briefing.potx --data-file - -o stdin-bound.pptx < 'pptx bindings.json'` | One JSON stdin owner; same result as Q17, subject to binding-schema setup gate                                                                           |
| Q45 competing template stdin   | `docx template apply - --data-file - -o invalid.docx`                                      | `pptx template apply - --data-file - -o invalid.pptx`                                        | Usage 2 before consuming stdin; retry Q44 with a VFS template                                                                                            |
| Q46 output alias               | `docx properties set INPUT --name title --value Final --output INPUT --force --json`       | `pptx properties set INPUT --name title --value Final --output INPUT --force --json`         | Reject alias before writes, including a second VFS path to the same object; retry with explicit in-place intent after inspecting current input           |
| Q47 unknown scope              | `docx text INPUT --scope unknown --json`                                                   | `pptx text INPUT --scope unknown --json`                                                     | Usage 2; discover scopes in help/schema and retry an applicable scope                                                                                    |
| Q48 lowered limit              | `docx inspect INPUT --limit xmlDepth=1 --json`                                             | `pptx inspect INPUT --limit xmlDepth=1 --json`                                               | On fixture deeper than one, limit exit 4; duplicate limit names/unknown names/raising host ceiling reject before work; confirm spelling with each schema |
| Q49 discovery recovery         | `docx schema tables set`                                                                   | `pptx schema tables set`                                                                     | Compare with Q42 and actual capabilities; unsupported behavior stays read/preserve/reject with reason, never silently succeeds                           |

For Q28/Q29, repeat with an invalid proposed destination and a sentinel output:
destination validation still runs, and sentinel/input hashes remain unchanged.
For Q32, record the token's original fingerprint, the intervening committed
revision, the rejected attempt, and the fresh selection used for retry. For
Q35, retain both the unmerged success and unresolved merged failure; a successful
alternative coordinate must not substitute for B2. These are ordered recovery
observations, not permission to repair or force an ambiguous user's intent.

## Evidence, reduction and completion

For each execution, record case ID, implementation revision, schema version,
adapter/capabilities/limits, original input hash, exact arguments, expected and
actual exit/JSON/bytes, changed and retained parts, screenshot reference and
status (`passed`, `failed`, `blocked`, `not_run`). Keep DOCX evidence under
`docs/docx` and PPTX evidence under `docs/pptx`; link paired receipts by case ID;
keep procedures and outstanding QA work here. Separate semantic checks from
independent rendering/playback; no runtime/native rendering is authorized by
this documentation task.

Downloaded publisher decks/documents and cloned binaries remain disposable QA.
No cleanup is performed here. Before any later cleanup, reduce each meaningful
case to an original small memfs unit test with independent expected results;
reproduce a failure before fixing product code. Keep provenance and reduction
links, then delete only enumerated owned artifacts no active campaign needs.
Never commit ignored inputs, downloaded wording/images or cloned binary fixtures.

Historical PPTX documentation verification: parse both PPTX inventories, review
these recipes against shared contracts and the command register, validate the
literal batch/binding examples against their proposed schemas, check local links,
run installed scoped Prettier and `git diff --check`, then inspect staged paths.
Commit only this plan and its companion review using a Conventional Commit on
main. Preserve unrelated work; no README/product edits, push or release.

## Historical documentation check results

- Passed the installed repository Prettier check scoped to this plan and its
  companion review; `git diff --check` passed.
- Verified local links and unique recipe coverage Q01–Q41. Parsed both complete
  inventories and confirmed 2,407 source API records, 2,424 target rows, 2,700
  unit variants and 973 BDD examples. All four input audit/inventory hashes match
  the review receipt; no input evidence was rewritten.
- Installed AJV validated the literal shared batch against the relevant closed
  property-operation/envelope schemas and the PPTX binding example against
  `Bindings`. Negative examples rejected unknown fields, unsupported version and
  invalid binding kind. This does not validate template resolution or runtime
  operation semantics, and does not assert a matching DOCX binding schema exists.
- Reviewed the shared operation/flag/status contracts and retained the existing
  exact J01–J10/D01–D18/C01–C04 decisions as described in the review. No API
  coverage percentage or new published-source verification is claimed.
- No product code/tests, runtime schemas, CLI recipes, screenshots, native
  runtime, implicit network, README edits or binary cleanup. All product
  acceptance remains proposed. The owned commit contains only this plan and
  `docs/pptx/office-cli-qa-review.md`; report its local hash after committing.
  No push or release is authorized.

## 2026-09-13 bounded execution and follow-up

Executed the available built PPTX commands interactively against an explicit
MemoryFileSystem rooted at `/work`, using original SDK-created inputs. No saved
QA runner or screenshot test suite was introduced. Product code and tests remain
unchanged under this task's documentation/research-only boundary. The receipt
records observed defects, rather than changing the contracts to bless them.

Future implementation work must first add focused failing original memfs tests
for B2 cell addressing (Q11/Q12), shared property batches (Q18/Q25), missing
validation (Q01), and actionable legacy-name diagnostics (Q41). Template creation
(Q02) remains explicitly unsupported. Confirm each against the then-current
build before editing. Do not count the working `2,2` alternative as passing B2.

Continue Q06–Q10/Q17/Q31/Q35 with the exact authored image/template/merged-table
fixtures above, and repeat simplified text cases with styled split runs,
hyperlinks and excluded notes/master text. Complete counterpart DOCX cases,
adapter failure/cancellation tests and per-operation schema/capability comparison.
The receipt's successful simplified probes do not waive those requirements.

PPTX is a virtual command rather than a root poe-code subcommand. This run used
the maintained `terminal-png` renderer used by `scripts/screenshot.ts` on captured
built Shell output; screenshots are disposable under
`screenshots/office-qa-20260913`. Inspect root/nested help, errors and selector/edit
output. This is not a fixed-width terminal, application render or font-fidelity
test. Keep the actual output text in `docs/pptx`, not a replacement runner.

The maintained `npm run screenshot` route additionally executed built nested
help with the explicit in-memory adapter; its output was visually inspected.
Scoped Prettier, local-link checks, complete inventory destination checks,
recorded JSON envelope checks and `git diff --check` passed. No product unit
suite, counterpart run, native rendering or release verification is claimed.

## DOCX documentation review procedure and result

This task owns only this plan and `docs/docx/office-cli-qa-review.md`. Preserve
the existing PPTX receipts and unrelated plan edits/moves. No product code,
README, inventory, shared specification or disposable binary is changed.

1. Read root/scoped instructions, all three specifications and the four complete
   DOCX audit/inventory inputs. Parse both inventories; compare the later API and
   command maps without treating their planned tests as executed evidence.
2. Before editing, assert the plan has DOCX register/evidence links and does not
   route all receipts to PPTX. The assertion failed with `DOCX QA lacks its
evidence/register links and routes all receipts to PPTX`. This is documentary
   defect evidence; failing original memfs tests before product code remain the
   responsibility of later implementation tasks.
3. Review Q01–Q49 against shared grammar, flags, selectors, publication, JSON and
   statuses. Check literal Q18 fields against both documentary contracts; do
   not claim runtime schema validation for DOCX or invent template fields.
4. Verify input hashes/counts, local links, unique case IDs and unchanged test
   adaptation statuses. Run installed scoped Prettier and `git diff --check`.
   Product tests/builds and CLI screenshots are inapplicable to Markdown-only
   edits; no recipe execution is claimed.
5. Inspect the diff/index, stage only the two owned paths, and make one atomic
   Conventional Commit on main without bypass/coauthor flags. Verify its files
   and report the local hash. Do not push or release; keep later tasks pending.

Review/check results are recorded in the linked DOCX evidence. All DOCX recipes
remain proposed and unexecuted, including the newly added recovery cases.
