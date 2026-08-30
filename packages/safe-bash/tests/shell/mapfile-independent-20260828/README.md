# Independent MAPFILE / READARRAY design review

2026-08-28. **Design feasible with the decisions below; native executor NOT ready.**
Reviewed author `1fe588eeba0cdb09adfb948eeded681d15d134f2`. No implementation,
product import, candidate inspection/execution, native invocation, Bash syntax
check, private-engine operation, build or install. This leaf owns only this
directory. Original 13/54 versus 47/54 and the old array observer remain intact.

## Bound evidence and scope

`audit-data.mjs` reads Git blobs, local primary files and JSON as data; it does
not interpret recipe strings or import product modules. `DATA-AUDIT.json` records
its result and script/Node hashes. The first revision completed75 metadata
checks; adding independently authenticated GNU `general.c` adds three checks.
These are not native/product/synthetic-supervisor passes.

- All six original packet files match author Git and seal; all32 row hashes,
  3264 script bytes and217 stdin bytes authenticate, with null expectations.
- Eight selected product source bindings and eight documentary references match.
  This is selected-source authentication, **not a replay of coherent78/fullpack**.
  Accepted runtime/shell are the d2502aae blobs; input/contracts are selected
  67eab12e blobs. No moving HEAD or in-progress arrays implementation is authority.
- Existing native binary is regular/executable,1395864 bytes,
  SHA256 `8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c`.
  Inherited LET metadata says GNU5.3.0(1), aarch64-apple-darwin25.4.0, C locale.
  Binary, archive and five selected primary files authenticate before/after;
  archive members match local bytes. No new version call or signature validation.
- Author packet contains six JSON/Markdown files and **zero executable observer
  modules**. No dependency stubs/synthetic lifecycle tests can qualify nonexistent
  implementation. The new protocol is not an old-observer repair or certification.

Primary manual/source actually read: authenticated `bashref.texi:5412`,
`builtins/mapfile.def:137,240`, `builtins/common.c:988`, `lib/sh/zgetline.c:64`,
and additive `general.c:248`. Full hashes are in the audit. Primary web search
located GNU's manual; direct page retrieval yielded no content, so the pinned
local manual supplies details. URLs are references, not downloaded execution:

```
https://www.gnu.org/software/bash/manual/html_node/Bash-Builtins.html
https://www.gnu.org/software/bash/manual/html_node/Arrays.html
```

Manual establishes indexed destination/default MAPFILE, delimiter/limit/skip/
origin, clear when origin omitted, callback-before-assignment, descriptor input
and readarray synonym. The C source, not a new observation, shows first remaining
operand selection, empty-name usage2, nonempty invalid-name1, unsigned32 range
checks, and NUL-prefix consequences of C strings. `general.c` uses decimal
`strtoimax` plus surrounding whitespace, so signs/whitespace are not ruled out by
native source. Native origin permits values beyond the project's array maximum;
do not mislabel a project-domain refusal as full GNU parity.

## Concrete root decisions recommended (not ratified here)

| ID | Recommendation | Phase and qualification |
| --- | --- | --- |
| D01 | Support `-u0`, `-u 0`, and equivalent decimal zero forms; every nonzero descriptor refuses2. `-C`/`-c` refuse2, including no-op-looking `-c`. | Same effective `context.stdin`, not a lookup of host FD0 or stale descriptor map. No builtin acquisition/pull/target mutation on refusal. Existing expansion/prefix/redirection effects remain. |
| D02 | Leading short clusters; required option value is attached suffix or next argv verbatim (even `-C`); stop at first operand, `--` consumed; validate each occurrence left-to-right, last valid repeated value wins. | `-d -C` means delimiter argument, not callback. `-u1 -u0` refuses at1, not silently overridden. Missing value/unknown flag/long option2. Invalid numeric value1. No preflight of the whole shell script. |
| D03 | Prefer C-locale decimal syntax `[ASCII whitespace]*[+-]?[0-9]+[ASCII whitespace]*`, reject negative nonzero; accept negative zero. Counts/skips0..4294967295; origin0..2147483647. | Concrete recommendation beyond author's unsigned-only grammar, pending N31/root. ASCII whitespace is SP/TAB/LF/CR/VT/FF, no JS Unicode trim. Bounded digit scan/checked accumulation, not unbounded BigInt/Number coercion. No arithmetic expressions. `-n0` reads until EOF subject to real caps. |
| D04 | Select the first operand and ignore extras after option scanning, matching the primary source; empty name2, nonempty invalid identifier1; absent name MAPFILE. | Pending N30/N32/root. `A -u99` is trailing data, not a parsed FD option. No eager validation of ignored operands beyond existing invocation argv admission. Identifiers include `__proto__`/`constructor` without prototype lookup. |
| D05 | Empty `-d` selects byte0; otherwise first ASCII byte only, remainder ignored; non-ASCII first character refuses2 before target/pull. | Unicode payload is supported, not Unicode delimiters or arbitrary native byte strings. No locale-sensitive decoder or normalization. This is an explicit narrow profile, not byte parity. |
| D06 | Decode completed representable payload with fatal UTF8 and preserve U+FEFF/BOM as content; for nonzero delimiter store prefix before embedded NUL while consuming its physical record; NUL-delimited row stores no terminator. | Source-supported NUL proposal, pending observations/root. Empty EOF differs from a present NUL-only row. Malformed representable payload fails1 after a complete row is consumed; earlier rows remain. Bytes skipped or discarded after NUL are not decoded. `TextDecoder` default BOM stripping must not silently change content. |
| D07 | Validate caller/options/target; check readonly then kind/export/control rules; privately admit and publish clear/convert before skip/read. `-O0` preserves tail; explicit origin converts eligible scalar with element0 retained, even at EOF. | Publication after final caller/readonly/stale validation. No automatic whole-unset workaround. Invalid entry causes no builtin pull; root iterator/redirection acquisition is not promised absent. |
| D08 | Publish one completed row at a time; stop after exactly `-n` committed rows with no peek/parent return. At max index, if more requested, scan one next record: EOF0; present record index-error1 without insertion. | Earlier clear/rows/consumption persist. Never synthesize index2147483648. Abort/ledger failure mid-record overrides a full-record-consumption promise: stop at bounded progress and return the unconsumed suffix. Do not drain arbitrarily to manufacture overflow1. |
| D09 | Keep existing escaping/caller/limit/cleanup precedence and one invocation Budget/private ledger; final readonly before stale. Rewatch after this builtin's own successful publication only. | Unrelated mutation during awaited input may produce conservative G3 conflict. Shared internal descendants cannot reset capacity; fresh public exec remains a fresh boundary. No global scalar-overlay changes. |

D01 callbacks are already directed by root; its zero-FD support is the recommended
choice. D03–D08's unsettled native/profile choices require root selection, not
implementation proof before design can advance. All recommendations keep array
foundation acceptance as the **product** prerequisite. Standalone native
observations do not logically depend on it.

## Shared cursor and target mechanism review

`input.ts:15,19,32,84,95,126,238` is sufficient architecture for a private
record operation: root owns the iterator; ShellInput views share a serialized
cursor, copied producer chunks and retained suffix. Borrowed close only closes
the view. Root construction already acquires an iterator (`shell.ts:234`).
`-u0` therefore needs no public descriptor table exposure and naturally follows
VFS redirects and forwarded stdin. One precise effect choice remains: native
explicit `-u` checks descriptor validity during parsing, before target lookup.
Recommend explicit `-u0` against the runtime's known `closedSource` fail1 before
target mutation, without probing arbitrary raw sources. A later producer rejection
is instead a read failure after admitted target effects, never empty EOF. Do not
pretend an opaque source can be validity-probed without consuming it. Default
no-`-u` follows the proposed ordinary read-failure phase, not native C's potential
read-error-as-EOF behavior. Other FD numbers remain unsupported, not host authority.

Do **not** call current `line()` unchanged. Plain read removes NUL and replacement
decodes; bounded read removes NUL and fatal-decodes. Its returned triple lacks a
physical-record-present bit. Empty EOF, NUL-only unterminated data and adjacent
NUL records cannot all be classified correctly from value/terminated alone.
The new operation must retain consumed byte count, delimiter presence, physical
presence and private ownership, including all chunk boundaries/zero-length pulls.
It must restore the unread suffix in finally before releasing the record lease,
including decode/capacity/abort failure; no second iterator or per-row wrapper.
Lease serialization is record-level, not a whole-file transaction/fairness claim.
Do not hold the lease across diagnostic writes or arbitrary registered commands.
Author's literal “no lease held across ... user code” needs narrowing: a lease
necessarily spans `ByteSource.next()`, which can itself be trusted host code.
The enforceable rule is no additional shell callback/command while holding it,
not universal exclusion/preemption of host producer execution or protection from
a producer recursively waiting on that same cursor. Preserve opaque-input policy.

**Concrete remaining owner gap:** dispatch's middleware terminal (`runtime.ts:1535`)
passes raw replacement stdin through. Current read's fallback (`2742`) constructs
a throwaway view; copying that pattern cannot promise remainder across repeated
raw-source replacements. Normal Shell.exec/redirect/pipeline input is already a
ShellInput. Invoke with explicit replacement makes an invocation-owned view
(`2251`), and omitted input borrows. A host repeatedly presenting the same raw
ByteSource object does not establish one shared cursor/owner by identity alone.

Recommended implementation contract: canonicalize a raw replacement once in its
actual owning invocation, register cooperative close before acquisition, forward
that canonical view to its downstream consumers, and never globally cache by raw
object. Across independently replaced scopes, no cross-scope remainder promise
without explicit shared ownership. Before code GO, author should name the exact
terminal/input-owner path; this needs no new public API but cannot be faked by a
mapfile-local wrapper. Do not broaden stronger opaque-return settlement policy.

`InputCursor.close:61–72` observes abandoned return rejection; awaits eligible
return, preserves prior read failure, and avoids awaiting return queued behind
pending next. Mapfile -n does not close the parent. Borrowed cleanup, explicit
registered owned drain and opaque input promises are distinct; caller identity,
execution-over-cleanup precedence and no-double-return remain obligations.

Publication uses accepted arrays' actual typed watches/tickets/local restore,
not environment serialization or a private array approximation. Default clear
must preserve readonly/export attributes and local identity rules. A scope-local
typed empty remains distinct from absent/scalar-empty/missing element0. Prefix
export/conversion refusal leaves existing prefix restoration intact. Subshells/
pipeline stages/invoke keep their existing cloned state, not parent mutation.

## G4A and bounded work

Peak notation: **P + E_input + E_command**, never a finite combined/RSS bound.
Existing cursor/caller chunk copies are E_input. New mapfile retained record
fragments, decoder carry, staging, decoded rows, watches, snapshots, joins and
array-to-argv bridges before transfer are P. Overlap remains charged until actual
release; a Uint8Array view retaining a whole owner is not ownership-free. Existing
registered formatting after admitted argv transfer is E_command, even before
sink.write. Do not add command/basic/internal/contract hooks or reset any Budget.

Apply the ratified seven counters/refusal order atomically, watch slots under F,
nonrefundable cumulative charges and prepaid shared cleanup. Counts billions are
not permission to preallocate/iterate billions. Skips need byte/empty-pull/record
work credits, not retained skipped payload. Check inside new cooperative scans,
not only between potentially huge chunks; check before/after flat primitives,
without claiming primitive preemption or W as CPU time. Raw private reservation
failure must leave already-consumed prefix effects honest and unread suffix owned.

Author's3x decode reservation is conservative, not an observed natural maximum
or permission to lower caps. Document actual UTF8-byte payload versus backing
UTF16/allocation conventions, lifetime overlap and live-only refunds. New builtin
diagnostic construction is not automatically E_command merely because it writes
stderr: bind it to existing error machinery or privately admit/prepay new bridges.
Do not mask a limit/caller error with allocation failure while formatting it.

## Original32 recipe audit and bounded gaps

All scripts are literal reviewed data, no unknown input evaluation. Commands are
native builtins: mapfile/readarray, printf, declare, unset, read, readonly, export,
local and return, plus bounded functions/loops/array syntax. No external command,
host path write/read, substitution, background job or free-form eval command.
N29 deliberately invokes the fixed native `cb` callback via mapfile; this does
not authorize callbacks in product. N27 subshell and N28 pipeline add contexts.
32 launches + at most3 additional contexts fits conservative36, not a measured
process count. Static call expansion gives46 mapfile/readarray calls (N30 two,
N31 eight, N32 seven); this is not46 observations/passes or execution coverage.

N01–N08: defaults/alias/empty/scalar/sparse/origin/unlimited. N09–N14:
skip/remainder/unterminated/empty/CRLF. N15–N20: custom delimiters/NUL. N21–N25:
Unicode/invalid-byte/readonly/export/control. N26–N29: locals/subshell/pipeline/
callback. N30–N32: bundled/duplicate/options/numeric/error multi-call sequences.

**No rewrite of the32 is justified.** They are safe bounded neutral observations,
but the following claims need separately sealed additive data if desired:

1. N30's delimiter `é` starts with C3, but its input contains decomposed65 CC81
   and **no C3**. It observes no-match behavior, not splitting at the first
   non-ASCII delimiter byte. Add a composed C3 A9 hit; preserve N30 unchanged.
2. N32's intermediate invalid forms print statuses but no individual target and
   remainder snapshots. Its final read cannot attribute consumption to one form.
   Standalone failures with initial target/status/after/remainder are needed for
   exact effect-order claims; statuses are still usable original observations.
3. No exact project-origin2147483647 boundary row; native permits a broader
   origin/index profile. Add finite one/two-record cases, never huge iterations.
4. N07 covers absent explicit-origin EOF, not scalar explicit-origin EOF. Add
   `A=before; mapfile -O3 A` with empty stdin to observe conversion separately.
5. N22 has malformed bytes first; it does not establish earlier-row retention,
   partial-invalid final row or discarded malformed bytes after NUL. BOM
   preservation at each record start is also absent. Add distinct tiny inputs.

These are proposed additions, **not extra authorized launches or changed32**.
Chunk reuse, cancellation, readonly/stale races, synthetic array cap boundaries
and raw middleware ownership require later actual product controls, not native
oracle inference or this metadata checker.

## Observer readiness: five old gaps, five still-unproved fixes

| Old static gap | New proposed correction | Required different execution evidence |
| --- | --- | --- |
| Missing-close/group polling can wait forever | Hard terminal reporting deadline, uncertainty stops next launch | Controlled absent close/surviving group; bounded report without false reap |
| Final protected identity omissions | Before each launch and final full protected manifest/new-entry checks | Last-row observer/config/authorization/seal/row drift and appended file must refuse |
| mkdir before cleanup registration | Prospective ownership before mkdir; acquire then identity | Inject post-mkdir stat failure/replacement; no delete of replacement; owned path remains accounted |
| Post-spawn receipt failure undercounts | Irreversible attempt record before spawn; PID independently recorded | Inject write failure after actual launch; reap/uncertainty recorded; no retry or unexecuted label |
| Spawn failure manufactures close | Separate attempted/spawned/error/actual close states | Sync throw and async error cannot become fake close/success |

The prose addresses all five conceptually; **zero implementation fixes have been
tested here**. Original STOPPED_FINAL_INTEGRITY and prior five findings remain.
Do not retrofit this proposal onto the old16 captures.

Literal native argv and eight-key replacement startup environment are sound:
no PATH fallback, startup files/functions/options/credentials inherited; only
owned HOME/TMPDIR/cwd. Source identity is native5.3 Darwin/C, not GNU/Linux or
UTF8-locale parity. Native auto-generated shell variables are not absent merely
because the inherited env is replaced. No external bucket/private cwd.

Before separate reviewer seal/ROOT GO, actual observer must bind its executable
module closure, Node binary/path/hash, literal recipes/config/authorization and
all direct-child/group controls. Array acceptance is not a native-run prerequisite.
Use canonical regular-file identities and no-symlink paths; include result-root
ownership before mkdir, not only fixture-root ownership. Stop/report final drift,
unexpected entries, output overflow, admission expiry and cleanup uncertainty.
Stdout/stderr combined cap must charge before retention (including base64/receipt
overlap); stdin write/early-close errors need explicit observed handling.

The specified32 sequential launches, per-script/stdin4096 and total32768, output
65536/row and1048576 total, fixture3 entries,2.5/2.75/3-second child boundaries,
110-second admission and4MiB receipt caps are coherent finite budgets. A deadline
is reporting/stop policy, not an OS reaping guarantee. Avoid unbounded synchronous
metadata reads or uncapped serialized intermediate objects under that promise.
No all-PASS/nonzero-coordinator acceptance; ordinary native nonzero observations
remain neutral results, while guard/capture/cleanup failure halts admission.

## Handoff

Ready for root policy selection and an independently inspectable NEW observer
implementation. **Not ready for native GO today: no observer executable/control
receipts exist.** No array implementation window or API changes requested here.
Likely future product scope is runtime.ts + input.ts + optional private mapfile.ts;
if input-owner integration/accepted array helpers require other scope, propose it
first. No parser, contracts, registry/default-count or host-command changes.
