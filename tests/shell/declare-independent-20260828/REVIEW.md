# Independent declare/typeset design review

**DESIGN CHANGES NEEDED; no implementation authorization or acceptance.**
Bound author packet/correction, observed source blobs, and static counts are in
PROVENANCE.md. `c7dae6e884d1a144266dfc1bb80785bf007a667f` remains **UNACCEPTED**.
References to its interfaces describe proposals. O identifiers refer to primary
documentation in SOURCES.md; C denotes source-reading inference; P denotes a
project proposal, not a user mandate or native observation.

## Smallest complete useful profile (P)

Keep genuine runtime builtins sharing implementation, not registry aliases:
`declare`/`typeset`, scalar declaration and append, indexed declaration/conversion,
literal decimal element and compound replacement/append, `-a/-p/-r/-x`, scalar
`+x`, presence-aware listing, and local restoration. This supports building an
argument array, appending, inspecting it, freezing it, and exporting scalar
configuration. Do not add `-A/-n/-i/-g`, general index arithmetic, or a `builtin`
dispatcher: that dispatcher is absent from the inspected builtin inventory.
Keep function shadowing and existing `command` bypass/discovery; normal literal
argv invocation must work without default command plugins.

The author's two stages are feasible as **internal milestones**, not separately
complete releases. Stage one includes arrays/listing but its printer emits
`declare -a a=()` while compound declaration parsing arrives only in stage two.
The present parser rejects that text at parser.ts:717. Empty-array printing alone
therefore fails the proposed stage-one replay contract. Release only after both
stages, or move the finite compound reader into the first stage; do not quietly
replace `-a` by a successful stub or drop roundtrip from the advertised profile.

## Exact root decisions still needed

These contrasts are P, not measured GNU outputs. `out` is declaration stdout;
`LF` means a final newline. Existing bindings named below are ordinary, unexported
unless stated. Each row needs an explicit disposition before implementation.

| Decision | Concrete contrast and recommended resolution |
| --- | --- |
| R1: query/option profile | With `n=v`, `declare -ap n`: author chooses status2/out empty/no mutation; documented named-p behavior ignores a, permitting status0/out `declare -- n='v'`+LF/no mutation. Prefer ignoring supported a/r/x with named p; retain explicit2 for unsupported flags, and specify `+x` query behavior separately. Ratify last-x-sign and array-export refusals: exported `n=v; declare +x -a n` currently proposed1/no change versus sequential clear-and-convert0. Neither contrast requires adding array export or new attributes. |
| R2: unset/local state | In `n=outer; f(){ declare n=inner; unset n; declare -p n; }; f`, should the inner query be status0/out `declare -- n`+LF, or status1/out empty? Both can keep outer hidden and restore `outer` on return. DESIGN:119 removes membership, :125 retains a missing local declaration: choose an explicit declared-unset/tombstone table. Also ratify typed indexed shadowing and readonly-parent refusal rather than describing them as GNU parity. |
| R3: admission/release boundary | VFS file bytes `: > /early\ndeclare -a a[-1]=x\n`: unsupported index syntax must fail2/out empty with `/early` absent at whole-file parse preflight, not fail only after executing line1. In contrast `: > /early\ndeclare -A n\n` may be a runtime option2 with `/early` present; explicitly classify it. Freeze expanded/quoted command and prefix contexts, AST metadata policy, and publish only the completed two-stage profile. |
| R4: serializable state | Proposed `unset OPTIND; declare OPTIND='1+1'; declare -p OPTIND` prints `declare -- OPTIND='1+1'`+LF/status0, but fresh-state replay uses integer OPTIND and writes `2` (C). `unset PWD; declare PWD` similarly cannot be restored by bare declaration into fresh initialized PWD. Recommend exact roundtrip only for ordinary names absent at replay start; document control listing as inspection, not replay. Separately ratify record-level1/zero bytes for NUL or lone surrogate, without globally changing input acceptance. A lossless JS-code-unit extension is an alternative requiring new explicit design, not native compatibility. |
| R5: shell formatting ledger | Existing E_command/post-transfer registered-command formatting remains excluded from the private array ledger. Ratify **new** declaration-shell formatting/membership/argv-bridge charges separately. For already-admitted `declare -p n`, n=v, and exhausted private capacity but remaining public output capacity: proposal is1/out empty versus treating formatting as excluded and printing0. This is an admission fixture, not a proven public threshold: F=0 can fail ordinary argv expansion before reaching the builtin. No command-family budget changes or RSS claim. |

## Actionable author corrections

Locations refer to `tests/shell/declare-design-20260828/DESIGN.md` at bd5a3d34,
unless another path is given. Existing author files remain untouched.

| Location | Required correction before another design freeze |
| --- | --- |
| :50, :266, :289 | Resolve stage-one printer/reader mismatch; define fresh compatible state by target-name absence and explicit control exclusions, not just “sufficient quotas.” |
| :64, :73, MATRIX.md:18 | Record the named-p deviation prominently or adopt O2. Freeze all supported clusters, first-operand boundary, lone signs, `--`, mixed signs, duplicate operands and unsupported-option precedence; no conditional successful stubs for `+r/+a`. |
| :113, :125, :129 | Add a transition table for absent/declared-unset/set-empty/indexed-empty, unset in current versus caller local scope, and attribute-only unset scalars. Preserve exact presence/export/readonly/kind through every saved frame and overlay. |
| :147, :155, :375 | Enumerate existing scalar compatibility touchpoints and activation migration. New membership need not be initialized in shell.ts if lazy/optional, but prove that choice for initial, cloned, process, and invoked states; do not silently expand write ownership. |
| :169, :178, :183 | State what public parseShell AST does and does not expose; supply finite grammar/preflight cases below. “Authenticated” WeakMap membership is not validation of mutable attached fields or a public AST execution API. |
| :191, :207, :213 | Specify option/preparation/publication barriers and their diagnostics separately. Define exact argv/content/position/name/option binding for private evaluated operands, including transparent clones versus mutation. No text reparse, double expansion, or function/registry initializer injection. |
| :272, :283, :295 | Give exact quote vectors and record-failure continuation policy; separate Unicode text replay, control state, and malformed-byte ingestion. The missing control metadata exclusion alone does not prevent value/presence changes on replay. |
| :299, :318, :328 | Give an admission inventory and checked cap arithmetic for discovery, deduplication, comparison scans, encoding, diagnostics and cleanup. Distinguish the proposed new charge from ratified G4A; SOURCES.md:49 correctly does this after bd5a3d34. |

## Scalar and state integration (C -> P)

runtime.ts:188 stores strings plus export/readonly sets, not declared-unset scalar
membership. :343 saves value/attributes/getopts but no declaration bit. Existing
local creation (:3221), unset (:3281), writeVariable (:998), cloneState (:302),
temporary overlays (:1817, :1969), invoke (:2385), processState (:2257), and
function finally (:2050) must agree about the added bit. Local unset must not
reveal the saved parent accidentally. A caller-local unset from a nested function
needs an explicit policy too; O5 distinguishes that case from current-frame unset.
An exported-but-unset scalar must not fabricate `name=` in child env; an empty
scalar must. Readonly declared-unset blocks later assignment and unset; idempotent
attribute declaration and scalar `+x` are not value writes.

Preserve eager scalar RHS effects, no-split/no-glob assignment context, temporary
prefix restoration, and control behavior (especially OPTIND integer/cursor,
PATH unset state, PWD/cwd separation). Do not allow the new readonly publication
to leave value written but attributes missing after a resource refusal. Existing
export/readonly/local listings use JSON.stringify and `?? ""` (:3215), so they
neither distinguish unset nor supply a safe shell-quoting oracle. Preserve their
existing behavior unless root separately authorizes fixes; do not advertise them
as new roundtrip paths. No prototype-key ban: valid names `__proto__`, `constructor`,
and `toString` require own-key/null-prototype-safe state and listing.

## Parser, effects, and public surfaces (C -> P)

parser.ts:685 recognizes compound assignment independently of a command word,
then :717 rejects mixtures. runtime.ts:1782 declaration-context expansion currently
recognizes only export/local/readonly through literal command prefixes. Extend
both deliberately. Freeze literal `declare`, `typeset`, `command -- declare`,
ordinary quoted argument `a=(x)`, expanded command name, quoted command name,
and `builtin declare` independently. Compound grammar must not appear merely
because expanded argv happens to start with “declare.” Reject noncanonical,
negative, arithmetic, substituted, or nested indices before their effects where
they are syntax; numerical domain overflow remains a separately chosen runtime1.
Do not misparse unsupported compound syntax as unrelated words or commands.

parseShell is exported (shell/index.ts:2), returns mutable structural AST
(parser.ts:8), and uses private array WeakMaps (arrays/syntax.ts:21). Shell.exec
accepts **source text**, not AST (shell.ts:163); Runtime.runUnit is internal.
No public AST-consumption validator was found in these paths. Inspect public
parse results and separately execute printed text in future; never invent
`Shell.exec(ast)`. Any future AST admission requires exact finite own-data checks
across realms (no accessors/holes/extras/coercion), plus private provenance policy;
prototype identity is not a data-validity test. Internal tamper tests are not a
hostile-JavaScript sandbox claim. Whole-file parse (runtime.ts:2590) must traverse
inactive branches/functions too. Shell.exec/source remain unit-wise; do not
extend whole-file rollback to them or to semantic dispatch/host changes.

Author preparation before dispatch is plausible but invasive: precheck each
compound's statically certain demand before its own RHS, then expand once; global
usage errors publish no target, while earlier eager RHS/redirection effects may
remain. Operand-loop status1 may retain earlier successful operands and continue;
preparation/quota/I/O/cancellation stops. Freeze readonly-over-stale precedence,
target watches across awaits, same-command scalar duplicates, and no silent retry.
No transaction, rollback of RHS, or native status/diagnostic equivalence follows.

## Quoting, bounds, and cleanup (C -> P)

The proposed single-quote/apostrophe bridge plus separate `$'\xHH'` C0/DEL segments
is compatible in principle with the inspected scalar reader; close each hex
segment before following text. Print `declare`, flags a/r/x, ASCII name order,
numeric sparse index order, one LF per record, no trailing spaces. Names supplied
to -p keep request order and duplicates. Empty, unset and sparse-without-zero
must remain distinct. Registered printf's q conversion (src/commands/basic.ts:94)
uses a different backslash-oriented spelling, not this canonical encoder; neither
its spelling nor its post-transfer accounting proves declaration replay/bounds.
NUL truncation in ansiWord (:351), Unicode-escape rejection there, fatal scriptFile
UTF-8 decoding (:2344), and nonfatal collectText decoding (contracts/io.ts:178)
are distinct paths. Actual U+FFFD is valid text, not proof of original byte fidelity.
SOURCES O7–O10 justify the UTF-16/UTF-8 distinction, not a native NUL roundtrip.

Keep B/F and seven candidate caps unchanged: F, F, B, 128F, 8B+512F, 8F,
32B+256F. Admission overhead is metadata64/work15; only four live counters refund
(ledger.ts:71, :102, :113). Failed tentative reserve leaves counters/tickets
unchanged; failure after earlier successful admissions does not refund cumulative
work/allocation. Declaration calls, snapshots, pipeline clones, and local history
share the run ledger; no new ledger per listing. This is logical accounting, not
allocated heap measurement or certification of c7.

Bound reads as well as allocations: precharge name/row/element/index discovery,
union deduplication and comparison code units; avoid Object.keys/full flatten
before admission. Distinguish public argv/expansion refusal from a private
declaration refusal when selecting zero/tiny-limit fixtures. Reserve overlapping
two-vector sorting, snapshot pins, fragment
cells, joined text and UTF-8 chunks before growth; checkpoint scan/merge/encode
work. A per-code-unit Admission costs 64 cumulative bytes plus15 work even after
release: show bounded batch reservations rather than assuming scanning is free.
Alternating apostrophe/control input needs fragment-count limits, not just payload
limits; huge empty bindings need wrapper/name/slot limits. No quadratic repeated
concatenation, dense sparse-index walk, unbounded native comparator, or byte-size
check after a full output allocation. Prevalidate one record for representability;
earlier records may remain on later failure, and sink failure may split a record.

Register cooperative cleanup before owners/output operations; finally uses the
same idempotent completion. Prepay local/overlay restoration before publication,
including frames present when declaration first activates the ledger. Await owned
admitted work/root barriers, not opaque host promises; observe late rejections.
Borrowed invocation signals remain borrowed. Destination-specific output close
must not cancel sibling work. Retained ByteSource slices require owned copies
before producer advance/finalization; completed awaited transient writes do not
justify indiscriminate copying. These are existing contract obligations, not new
preemption guarantees. HOLDOUTS.md freezes future checks, not executed proof.
