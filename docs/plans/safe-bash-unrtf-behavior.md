# unrtf behavior acceptance and executed review

Responsible owner: `packages/safe-bash-command-unrtf`, private ESM workspace,
empty runtime dependencies. Its only development dependency is the canonical
`safe-bash-contracts` workspace. Public API:
`@poe-platform/safe-bash/commands/unrtf`; safe-bash only re-exports it. The
maintained guarded profile admits its contracts build edge and the artifact
bundles implementation and recursive declarations without an unpublished
runtime requirement. No standalone command publication is authorized.

The package pattern was already moved from its requested path to
`docs/plans/archive/safe-bash-command-package-pattern.md`; that copy was read.
Earlier engine-only admission documents describe earlier increments. This
receipt adds strict rendering and an opt-in command, without certifying GNU
personality compatibility. The source baseline remains GNU 0.21.10, official
archive SHA256
`b49f20211fa69fff97d42d6e782a62d7e2da670b064951f14bbff968c93734ae`.
The supplied qualified source/native controls are provenance, not new executions
by this task. No native oracle or pinned personality/charmap was loaded here.

## Acceptance matrix

| Cell | Current admission | Remaining open qualification |
| --- | --- | --- |
| Text paragraph/line/tab | Strict UTF-8 LF/LF/TAB; repeated breaks; no invented final LF | GNU body separator and low-byte projection |
| Text tables | Flat row/cell boundaries LF/TAB, including empty cells | Nested/merged cells, full native layout |
| HTML paragraphs/line/tab | Explicit paragraphs, empty paragraphs, br and tab entity | Pinned native HTML personality and aliases |
| HTML tables | Flat rows/cells, explicit empty cells; malformed boundaries E_PARSE/status 1 | Nested/merged tables, native formatting |
| HTML escaping | Body ampersand/angle brackets escaped; font names CSS-escaped | Native entity alias/charmap parity |
| Nested styles | Bold/italic/underline/strike; scoped restoration and local plain reset | Stylesheet inheritance, alignment, other character/paragraph styles |
| Font/color styles | Explicit/default font, half-point size, foreground RGB; declaration text suppressed; plain restores default font and decoder locally | Native default-font heuristics, full font-name decoding, background/automatic colors and malformed color-table grammar |
| Codepages | Fatal realm WHATWG codecs; 874, 932, 936, 949, 950, 1250–1258, 10000, 65001 have concrete byte fixtures | Deterministic codec tables and native iconv/platform parity; Symbol, Johab, OEM/unlisted Mac pages unavailable |
| Encoding diagnostics | Unsupported page/realm codec E_CODEC; malformed/incomplete bytes E_ENCODING; literal U+FFFD remains content; status 1 | Additional codec edge inventories across advertised realms |
| DBCS/binary | Existing strict prefix-preservation and exact cross-chunk opaque skip controls still pass | Native buffer/platform parity is deliberately not claimed |
| Unicode | Existing strict uc counts and surrogate combination retained | Native token skip, separate surrogate entities and low-byte/NUL emission |
| Fields/images/objects | Field results rendered as inert text; instructions/URLs/objects/pictures skipped; no execution, network or exports | VFS picture naming, collision protection, transaction rollback and exports remain OPEN |
| CLI/SDK | Opt-in command/plugin and SDK share renderer and budgets; stdin or one literal VFS operand, ENOENT-only .rtf retry; HTML default, text/html switches | Native personality/config ordering, other output formats, inline/simple/noremap/debug/dump/verbose remain OPEN |
| Host isolation | VFS reads only; no host process, ambient configurations, locale/charmap files, download or native/WASM path | Actual browser/workerd engine execution not qualified |
| Ownership/cancellation | Invocation-local state, borrowed immutable input, iterator return, owned output operations, idempotent invocation cleanup; pending-pull cancellation tested | Uncooperative external capabilities cannot be forcibly drained |
| Replay | Deterministic in-memory strict fixtures, no durable state | Shell checkpoint/replay integration not executed; OPEN |
| Delivery | Local source, tests, build and unpacked-artifact verification | No local commit, remote-main delivery or release |

The behavior task remains open for the explicit remaining cells. No matrix cell
is admitted by another cell's passing result. Unsupported native/recovery
profiles fail E_PROFILE/status 1 before input. Unknown native switches/config
requests fail E_PROFILE/status 1, without ambient search. Multiple operands fail
E_PARSE/status 1 before input; '-' and '--' remain literal filenames. Quiet and
nopict/-n are accepted under the documented strict profile: it emits no initial
comments and never creates image files. Other unadmitted RTF controls are ignored
by this limited renderer, while extraction still exposes control events.

Deliberate strict deviations remain explicit: malformed root/group/hex/binary
syntax fails E_PARSE/status 1 rather than unsafe GNU recovery; raw binary is
consumed exactly across file/stdin/chunk boundaries; incomplete encoding and
unpaired Unicode fail E_ENCODING/status 1 rather than silent data loss. Strict
text is UTF-8 without GNU's separator/byte truncation. Strict HTML is a small
first-party projection, not an imported generic serializer and not the native
personality. Font size/component/declaration references and malformed flat table
boundaries have explicit E_PARSE/status 1 controls. Delivered streaming prefixes
can precede a failure and must be discarded by consumers on nonzero status.

## Resource and lifetime review

One Budget instance spans command argument admission, tokenizer, decoder and
renderer. Input bytes, decoded UTF-8 bytes, serialized output bytes, retained
chunks/groups/font and color declarations/style stacks, tokens/spelling, binary
and image counts/bytes, depth and parser/renderer work are separately bounded.
No parser tree, image bytes or complete document is retained. Renderer iteration
is flat, with group restoration on a bounded explicit stack; no recursive calls.
Font CSS escaping charges work proportional to its bounded name; fragment UTF-8
extent is counted before encoding allocation. Fragment working strings and
encoded storage are admitted against retention, then ownership of emitted
bytes transfers to the consumer. Argument and declaration accounting is
conservative. Diagnostics have a separate explicit bound of tokenBytes + 1024
bytes so exhausted document output can still report failure.

The command uses bounded readFile only when VFS readStream is unavailable;
that retained buffer is charged before yielding. The VFS must honor maxBytes
and cancellation. Input and output capabilities remain caller supplied and
must support prompt cancellation/return. Cleanup preserves a primary invocation
failure. Tests never create files or query an LLM; input uses memory iterables
and a mocked memory VFS. Packaging/screenshot evidence uses real disk only as
ad-hoc verification outside unit command tests.

## Executed evidence, 2026-09-20

1. Initial renderer tests failed because renderRtf did not exist. The line-break
   control then failed concretely because extraction conflated line/par; boundary
   metadata repaired it without changing text bytes. Font/color and repeated
   empty-paragraph controls failed before their implementation. Initial command
   tests failed against absent command exports. The retained-markup test failed
   before fragment accounting was added.
2. Final workspace test route: 45 passes, no skips/failures, under one second in
   the final receipt. Includes six previously qualified codepages, nine additional
   codec fixtures, literal replacement content, output/retention limits, inert
   fields/objects, nested style restoration, CSS injection escaping, reentrancy,
   source cleanup and cancellation of a pending command input pull.
3. Workspace ESLint and source/test TypeScript checks passed. Maintained selected
   safe-bash build closure passed all 19 build routes. Its first run rejected the
   new contracts development edge against the prior empty guarded profile; the
   profile was deep-merged to declare that exact edge, and the rerun passed.
4. The three maintained publication/bundling Vitest files passed all 164 tests.
   An initial Node test-runner invocation was inappropriate for Vitest files and
   failed setup; the correct Vitest run passed without altering those tests.
5. Maintained artifact assembly and local npm packing passed (2411 tarball
   entries). An isolated unpacked consumer with no private workspace installed
   passed runtime controls with empty PATH and strict NodeNext declaration
   checks. Actual Shell-created arguments preserved canonical contracts runtime
   identity. CLI and SDK complete results, including byte arrays, matched. Public
   runtime requirements include existing safe-bash dependencies, but no private
   unrtf package. This is unpacked local tarball testing, not registry delivery.
6. Ad-hoc terminal screenshot used the maintained generic screenshot runner
   (the poe-code wrapper does not invoke these opt-in shell commands). Inspected
   the resulting PNG: paragraph lines, aligned tab-separated labels/cells and
   final text displayed correctly. No screenshot tests were added.
7. Artifact setup initially encountered the older Python tar API; extraction was
   rerun for the trusted task tarball. Packed fixture initially used Shell.close
   instead of dispose and omitted byte-array fields from its expected complete
   result; both fixture errors were corrected, retaining complete-result parity
   and asserting both expected byte arrays. Failed setup runs are not passes.

Repository-wide tests/lint were not run for this focused command change; focused
workspace checks, the maintained selected build closure, publication tests and
isolated artifact checks are the scope of this receipt. No actual browser,
workerd, native-personality, checkpoint/replay or publication qualification is
inferred. /out is read-only on this host; temporary task evidence used workspace
out/unrtf-behavior and an isolated temporary consumer. Both were purged after
recording these results. Existing unrelated edits were preserved. No commit,
push or publication occurred.

## Follow-up task review, 2026-09-20

This increment preserves the pre-existing implementation and unrelated working
tree edits. Review validated four defects with failing in-memory regressions:
`deff` before `fonttbl` omitted the default font from HTML; `plain` retained a
previously selected font's decoder; cleanup left declaration/style retained-byte
reservations charged; and table controls emitted boundaries before pending DBCS
characters or interrupted surrogate pairs. Each repair followed its failing
test. The latter two failures are resource-lifetime and strict encoding defects,
not evidence for GNU personality compatibility.

The renderer now retains font identifiers and resolves names when rendering;
this handles declarations after `deff` without copying font names into every
style. `plain` flushes the old decoder and restores document-default font
selection locally. Group closure restores the prior font and decoder selection.
Table boundaries flush pending encoding and reject interrupted Unicode with
`E_ENCODING`, status 1. Formatting-only controls still preserve pending bytes
under the previously documented policy. Declaration reservations and remaining
style-stack reservations release on completion, failure and consumer return.
Accounting remains conservative for repeated declarations during an invocation.

Added complete source-charset inventory controls: concrete Unicode fixtures for
all available mapped pages, charset-1 document fallback, unknown-charset 1252
fallback, and `E_CODEC` for Symbol, Johab, OEM and unlisted Mac codecs. Actual
realm codec execution is qualified here only on Node 22.22.2. These tests do not
certify the native low-byte text personality or platform iconv/charmap parity.

Executed checks after repairs:

- All 51 workspace tests pass with no skips; workspace ESLint and both
  source/test TypeScript checks pass.
- The maintained selected safe-bash build closure passes. A second build after
  the last source repair also passes; shared machine caching remains enabled.
- Artifact assembly and local packing pass: safe-bash tarball has 2411 entries.
  An isolated unpacked consumer, with the public safe-fs package and declared
  external dependencies copied from the existing installation, passes the
  maintained runtime fixture, CLI/SDK complete-result parity and contracts
  identity checks with empty PATH. Strict NodeNext declaration checking passes
  without skipLibCheck. Additional packed controls pass for default-font HTML,
  plain codepage restoration and incomplete encoding at a cell boundary. No
  private workspace package is installed independently in this consumer.
- Inspected a terminal PNG from the maintained generic screenshot runner and a
  local HTML document PNG from installed Chrome: escaped content, paragraph/cell
  boundaries, default/Courier/restored font and nested bold/italic appear. Chrome
  remained running after producing the PNG and was terminated; the image is
  visual evidence, not a completed browser lifecycle test or a browser-realm
  engine qualification. No screenshot tests or downloaded tooling were added.
- Final source review found no new proxy-only functions, host I/O, process,
  network, native/WASM or download paths in the command. Parser iteration and
  style restoration remain nonrecursive and budgeted. The additional font
  identifier state is invocation-local. Existing streaming failure prefixes
  remain part of the documented strict API, with consumers required to discard
  output on failure.

Setup failures are preserved as limits of the verification: an initial consumer
attempt used an absent Node path; declaration/runtime checks initially omitted
public safe-fs and declared external dependencies. Both were corrected before
the reported passing isolated checks. The root Playwright package was absent;
installed Chrome provided ad-hoc HTML image evidence instead. `/out` is read-only,
so temporary evidence used workspace `out/unrtf-task-review` and an isolated
temporary consumer; both were purged after inspection.

All remaining acceptance-matrix cells stay OPEN and block whole-task completion,
including GNU configurations/personality bytes and legacy/recovery profiles,
nested/merged tables, complete font-name decoding and style grammar, deterministic
codec/platform qualification, VFS picture export transaction/collision behavior,
browser/workerd execution and replay. This focused increment adds no snapshot
changes, commits, remote-main delivery or release, and publishes no package.

## Flat font-name decoding increment, 2026-09-20

[Executed review and manual QA](safe-bash-unrtf-font-name-qa.md) adds strict
codepage/Unicode decoding and scoped fallback to ordinary flat font names,
including DBCS chunk boundaries, surrogate pairs and inert binary fallback.
Malformed name encoding fails E_ENCODING/status 1. Names charge decoded and
retained bytes independently of document output; symbols cannot leak body text.
This narrows the font-name gap; complete nested/alternate-name font grammar,
native personalities/codecs, picture transactions and all other unqualified
matrix cells stay OPEN. This increment does not establish whole-task completion.
