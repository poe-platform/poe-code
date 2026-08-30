# Twelve-case ERE capture observation proposal

Status: SOURCE/DATA preparation for DIFFERENT preexecution review; no actual GO.
Date:2026-08-29. No native observation, Bash/version probe, product load or entry
execution occurs in this preparation. No competing capture-reporting policy is
adopted. ROOT's R01 HOLD and all original7 model-conflict failures remain intact.

## Exact cohort and fixture inventory

| ID | Literal pattern | Literal subject | Coverage role |
|---|---|---|---|
| N01 | `(a(b)?)+` | `aba` | I01 and unchanged author E12 input |
| N02 | `((a)\|(b))+` | `ab` | I02 alternative omission |
| N03 | `((a(b)?)c)+` | `abcac` | I03 nested omission |
| N04 | `(ba(na)*s )*` | `bananas bas ` | I04/manual example; final space retained |
| N05 | `(a(b)?){2}` | `aba` | I05 fixed repetition |
| N06 | `((a)?b){2}` | `abb` | I06 optional zero occurrence |
| N07 | `((a)\|(b))+` | `ba` | one I23 witness, NOT all62 property strings |
| N08 | `(a(b)?)+` | `ab` | final inner participation control |
| N09 | `(a)?b` | `b` | omitted capture reporting control |
| N10 | `(a*)b` | `b` | empty captured-string reporting control |
| N11 | `(a)` | `b` | nonmatch-status observation control |
| N12 | `(` | `a` | invalid-ERE-status observation control |

Pipe escaping in this table is Markdown only; COHORT.json/programs/*.bash.data
contain the exact literal alternation. Twelve program identities, zero filesystem
fixtures, zero stdin bytes. **No four-fixture inheritance from the old37 cohort.**
All12 are UNRUN observations; no expected native status/capture goldens selected.

Every script uses two fixed single-quoted ASCII assignments, one `[[ =~ ]]`,
immediate status storage, array-length expansion, builtin printf, one four-element
literal `for` loop, shell-visible slot-presence expansion, `[[ == ]]`/arithmetic
conditions, and exit of the stored regex status. There are no program pathnames,
external commands/failed lookups, pipelines, substitutions, subshells, heredocs,
here-strings, redirects, dynamic descriptors, source/eval or network actions.
Pattern metacharacters inside assigned strings are regex DATA, not shell operators.
The source audit checks each complete program, not just the first case/template.
No Bash syntax check is implied: Bash remains forbidden during preparation.

## Observation protocol, not a native oracle

stdout is binary NUL-framed: magic EREOBS1, case ID, regex status, cardinality,
then four triples(index,shell-slot-present,raw value). Values are retained as bytes
and base64, with no trimming, newline normalization, `%q`, path rewriting or JSON
re-interpretation. stderr is separately preserved verbatim. Child exit must agree
with the status printed immediately after regex evaluation; nonzero status is
not automatically a failed observation. Invalid framing/cardinality remains a
protocol failure with raw capture retained, not an invented semantic tuple.

The fixed scan records shell-visible presence for slots0..3; all literal patterns
have at most3 groups. Cardinality>4 emits a refusal marker and exits125; it cannot
be silently truncated/credited. **BASH_REMATCH presence/empty strings do not reveal
hidden regmatch_t offsets or native nonparticipation.** N09/N10 may produce identical
visible outputs; that alone proves neither reset nor retention internally.

## Reused source and exact specialization

Parent source `4eea354169492b4c47d373d504e5918e1c4f3830`, evidence
`73065e68469e2e514c0ee87ff34ac1db04ba51cb`, accepted functional-v3 preseal SHA256
`ffee6eafb226ead4f9a15351c2964693971dfff7004b0d96cd6f9d0ca6098533`.
Version2 source `a5fd225af5f9985ae805f48ab1b1790a9c3fbc7f` is inert comparison
context only. Original sources are captured as DATA with Git-blob/SHA/size/mode
provenance. Old requests/approval templates/preprovision captures are inert history,
never active assets or launch authority. No activation/old GO was acquired/reused.

SOURCE-DELTA.json binds all replacements. Six modules(capture, lifecycle,
group-observer, observer-state, state, storage) retain exact v3 bytes. Draft entry
changes only namespace/cohort count/membership, zero fixtures/effects/fork
reservations, managed cap and observation decoding. Draft admission changes only
the independent/root/profile schema names, so an old37 grant cannot pass. New
observation.mjs decodes the bounded byte protocol; it has no spawning capability.
Nine draft modules are syntax-parsed **unlinked and unevaluated**, not imported.

`draft/*.mjs.data` is intentionally inert. No materialized entry exists. Before
actual approval, exact reviewed bytes must be copied to the proposed materialized/
runtime directory, with fresh regular-file mode/hash/import admission and a new
runtime PRESEAL. This is a remaining explicit activation dependency, not permission
to change source during grant-slot replacement. PREEXEC-CONTROLS-PROPOSAL.json
contains12 proposed DATA/synthetic controls, all UNRUN. No new lifecycle pilot is
claimed; inherited v2 derivative evidence stays separately qualified.

The first generator's generic forbidden-token assertion has an overbroad OR
condition; it is not credited as an audit control. A separate exact-body, all12
program audit seals the actual finite corpus without relying on that predicate.
No program or expected observation is changed by that additional DATA check.

## Host, environment and loader boundary

Target only `/bin/bash`,1293840bytes,0555,SHA256
`35536aea9733aa345b61134a98d00232380898e55b2ea2a07c497011f7dfc7a3`.
Historical captured metadata is Bash3.2.57, reauthenticated from stored
`822e82a70dfebc071d3b6e27bc78967afa40a993` evidence, NOT a new version probe.
Node/env/zsh executable pins are also freshly stream-hashed; no executable is
decoded. Existing load-command metadata names dyld/libSystem/libncurses, but the
current runtime loader/shared-cache closure is **not independently qualified**.
Do not label eventual results glibc/GNU5.3, all Darwin builds, POSIX conformance or
all GNU Bash versions. Bind the actual host to the future run's metadata record.

Node-launched children receive exactly LC_ALL=C,LANG=C,TZ=UTC and per-case fresh
owned HOME,TMPDIR,empty PATH; stdin is empty/closed. BASH_ENV,ENV,SHELLOPTS,BASHOPTS,
function exports and ambient environment are absent. Args are exactly
`--noprofile --norc -c <sealed-program> ere-capture-case`. All cwd/HOME/TMP/PATH
directories are fresh0700; captures0600. Before/after namespace membership and
content/modes must be equal. No program file effects are allowed.

Initial exec_command tool-shell startup is explicitly **trusted host behavior
outside child clean-environment and owned raw-capture qualification**. login:false
does not prove startup suppression; no user startup files are read or changed.
This is functional observation without a custom OS fence or containment claim.
Source review of these benign scripts is not an OS-wide hostile-code guarantee.

## Proposed actual bounds and approval chain

Not yet granted:600seconds total including setup60s and finalization tail60s;
3s/case, TERM at actual stop time, KILL2s later, final group observation within1s.
Serial12 Bash children + one exec-replaced Node owner =13 managed starts/peak2.
Proposal40 ALL known starts/peak3 allows up to27 explicitly accounted admin starts
across materialization, metadata, fresh preauth, publication and Git. Expected
runtime starts remain13, not40. Source-level extra-fork reservation0 means no
forking program constructs; it is **not measured OS-wide fork census or a quota**.
Before actual GO the admin command list must be pinned; the reservation is not
permission for arbitrary helper launches or retries. Per-stream64KiB, combined
capture32MiB, working128MiB; emergency64KiB adds bytes, never time.

Inherited v3 semantics require real exit+close+absent owned process group, successful
fsync/size/hash/close of both regular captures, verified file snapshots and durable
receipt before observation credit. Regular-file completion is not pipe EOF. Enforce
inclusive final deadline before/after publication/flush/credit; necessary late
cleanup may be attempted but cannot make the run compliant. Capture/integrity/
unknown-retirement/deadline stops cannot retry or silently renew authority.

Approval order is acyclic: exact runtime source/assets PRESEAL → independent
accepted receipt binding PRESEAL+REQUESTS → fresh ROOT GO pinning both, fixed limits,
namespace and absolute expiry → sole grant-SHA slot substitution → independent
DATA-only resolved-command check → exact exec_command require_escalated approval.
Neither PRESEAL nor review receipt embeds GO/resolved-command hashes. Later mutation
is only the designated SHA slot; changing any source/path/env/limit needs resealing.

APPROVAL-PROPOSAL.template.json is **not an issued request**. It retains
require_escalated, login:false, explicit /bin/zsh, no prefix_rule, fresh owned
capture parents and read/write FD reopening with MULTIOS disabled. Actual inode/
device/mode preprovisioning and source/tool reauthentication remain future work.
No old37 grant, expired receipt, native40/43 authorization or P2 build is reused.

Return this packet to a DIFFERENT reviewer. No automatic runtime follow-on.
