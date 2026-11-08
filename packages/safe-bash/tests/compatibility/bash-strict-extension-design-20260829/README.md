# Strict-mode extension: source-only design for ROOT

2026-08-29. **Not ratified, implemented, executed, or a native golden set.**
No runtime/compiler/build/install/Bash/Worker/engine/private/network work occurred.
The original eleven Unit2 identities remain OPEN; source findings narrow the
implementation choices but do not turn them into runtime passes.

## Authority and inspected baseline

Accepted Unit2 `928be5585f05c15867fbbb5f4b5debe153b0734e`, derived
`26215b99cb379a9f825f803454f758fab5a3c8e9`, remains immutable. This design inspects
its accepted public80/Unit1 lineage with the **provisional Unit3** overlay:
`7a5c620005fb04518d44bb284f4e99284e4a7c33`, selected tree
`74dfe69135a3fc5ba89396b20dd32d9c9daae131`, full954 package
`46a845f6c12933308aef11dbbf8f861afcc38ff9973b83bcccea13c3329c0a09`.
The package was not loaded in this investigation. Frozen retained source files
were hashed against its293-input SOURCE-v4 manifest; no live HEAD substitution.
`BINDINGS.json` records the inspected files and exact source/data identities.

GNU authority is Sagan's `41d4880614cdb02659f7cdbe1f94cc3564c68d26`,
`tests/compatibility/bash-strict-reference-source-20260829/REPORT.md` and
`FIXTURES-v1.json`: authenticated GNU5.3 base +patches001–015 source analysis.
The report binds signed-source handoff `efcd8b49a63ceb4276ae9d075da59bfb027b3510`
and inventory `75c692f66095ad85848915f50e9357e506ed9664415f48ce6104cafa7269368e`.
This design consumes that source analysis; it does not independently reverify
the signature, execute a GNU binary, or qualify the local3.2 profile.

## Smallest implementation units and write scope

**Recommended future product write-set: `src/shell/runtime.ts` only**, plus a
new author fixture directory. No production edits are made under this design GO.

1. **Read-sensitive arithmetic and preserved control:** change the existing
   arithmetic-variable Proxy and its catch sites, not the arithmetic grammar or
   evaluation order. Preserve the original typed nounset failure until the
   existing diagnostic/logical-execution boundary handles it.
2. **Incremental finite `set`:** scan supported e/u flags in encounter order;
   terminal o consumes a supported name or performs an explicitly limited listing.
   Preserve earlier mutations on a later invalid option. Keep existing positionals,
   `--`, `-`, sh-profile distinctions, errexit and pipefail evaluation machinery.
3. **Aggregate-length continuation:** distinguish absence from an existing empty
   array object; add a private discard-current-input-unit control distinct from
   fatal nounset. This needs the explicit boundary/status decisions below before
   implementation; it must not become ordinary command failure/continue-next-command.

No arithmetic.ts change is currently necessary: it already evaluates `=` RHS
without reading LHS, reads compound/increment operands, lazily visits logical and
ternary branches, and recursively reads named values. No public AST, Budget,
limit, option, contract, export or default-command changes are proposed.
Parser/shell.ts changes are **not** requested: existing parsed-unit loops suffice
for the initial root-boundary proposal; if nested GNU continuation needs more
parse provenance, return a separate concrete scope request rather than extending
the AST silently. Array binder/ledger code remains untouched.

Unit3 review remains frozen. A future runtime patch overlaps Unit3's earlier
runtime additions and eventual coherent Node integration: derive from this exact
selected runtime blob, preserve conditional dispatch unchanged, and serialize
runtime ownership through ROOT. Do not overwrite any later live runtime edits.

## Read-sensitive arithmetic, without a new evaluator API

Frozen `arithmetic.ts:134–215` is already the correct structural seam:

- name reads occur at174–178, including recursive names; only these reads should
  consult nounset. Missing is not present-empty: parseArithmetic at115 maps empty
  source to zero; retain it. Diagnose the *inner reached name* for `value=missing`.
- Plain assignment at193 evaluates only RHS, then writes at201. Do not pre-scan
  all identifiers or probe the LHS to establish initialization.
- Compound assignment reads LHS at195 before RHS; ++/-- reads at182 before
  writing at188–190. A missing read prevents that write.
- Ternary at180 and &&/|| at196–197 visit only selected branches. Skipped names
  neither diagnose nor consume a new lookup. Preserve checked/signed64 behavior,
  64-level parsing/variable recursion,10,000 evaluation-step bound and existing
  assignment/readonly/indexed-arithmetic restrictions. No full GNU arithmetic claim.

`runtime.ts:1044–1051` currently rejects indexed bindings, then Reflect.gets the
scalar value. Proposed getter: preserve that existing indexed refusal; for an
actual string-name read, inspect the returned scalar value, and throw the existing
private NounsetFailure when nounset is on and value is undefined. Present empty
stays empty for the evaluator to interpret as zero. Optional **private diagnostic
line context** can be passed from the arithmetic call site; recursive reads retain
their own name. Absent line context falls back to the current command's existing
diagnostic line, not invented GNU BASH_SOURCE/lineno metadata.

Preserve existing read-admission layers: LET's preflight validates all argument
strings/field count before evaluation (`2897–2926`); LET and substring wrappers
check signal and variable byte size before recursive parsing (`2921–2926`,
`3612–3617`). Do not relocate these checks after growth or add an eager variable
scan. New presence checks need no retained collection or public quota. Existing
synchronous arithmetic is not hard-preemptible; this is not an RSS/CPU guarantee
or a general repair of all historical arithmetic-resource behavior.

### Catch-site closure is required, not optional

| Frozen runtime site | Present behavior | Minimal proposed change |
| --- | --- | --- |
| 1017–1018, integer OPTIND write | Any arithmetic error becomes ExpansionFailure | Preserve typed nounset/control/limit/syntax first; keep ordinary error treatment. Do not invent new OPTIND rules. |
| 1549–1550, arithmetic compound command | Any error becomes `Error("((: ...")` | Forward private nounset/control and real resource/cancellation failures; decorate only ordinary arithmetic diagnostics. |
| 2921–2934, LET | Flow/limit/syntax survive, nounset would become ordinary `let:` Error | Add nounset to the preserved path before decoration. Do not add `let:` to a reached inner-name nounset. |
| 3517–3519, arithmetic word expansion | Any error becomes ExpansionFailure | Preserve typed nounset/control/limit/syntax and raw caller cancellation before ordinary wrapping. |
| 3612–3634, substring arithmetic | Limit survives; other errors are recast | Preserve the same private control categories without changing substring grammar. |
| 1731–1737, inline input expansion | Nounset already survives; generic ExpansionFailure is recast | Preserve the new discard category if an aggregate-length error travels this path. Keep existing explicit-parameter isolated-input policy separate. |

Prefer one private runtime classification/helper, using actual private classes,
not matching error text, arbitrary error codes, or reason equality. Check the
existing signal first where the current boundary requires caller precedence.
`evaluateArithmetic` itself already rethrows errors other than its recognized
syntax/arithmetic errors (`208–215`); it need not know shell-private nounset types.

## Fatal status and diagnostic policy: do not universalize127

The existing private NounsetFailure (`runtime.ts:284`) is diagnosed once through
the guarded path at1627–1635, then throws Flow(exit,1). Functions/source propagate
that logical fatal control; isolated stages catch at their own boundary. Retain
this accepted **product profile** initially, including its public caller/limit/
sink/cleanup contract; it is not a GNU final-status golden.

Sagan's source analysis distinguishes initial failure1 from default noninteractive
GNU ONESHOT `-c` FORCE_EOF→127, versus reader-loop/DISCARD paths. Root Shell.exec,
`bash -c`, VFS scripts, stdin, substitutions and pipeline stages cannot all be
mapped to127 on the evidence available. Recommend **no status-map change in the
first read-sensitive patch**; keep native status/prefix/line tuples OPEN and
record exact product outcomes. A future invocation-specific map requires native
qualification and an explicit private boundary design, not a new public mode knob.

U17 is a separate explicit `:?` path: existing ParameterExpansionFailure at3593
maps to127 only when not isolated (`1642`). Preserve this distinction, not a new
blanket nounset rule. Its dynamic prefix/nested tuples remain unproved.

One source caveat requires attention: the generic diagnostic catch at1639–1640
can swallow a non-abort diagnostic sink failure. New nounset/discard paths must
use the existing guarded nounset diagnostic pattern, not that generic catch.
Whether to extend that exact guarded handling to U17's explicit-parameter branch
is a narrow ROOT choice, not evidence of a newly executed defect or permission
to rewrite all command diagnostics.

NounsetDiagnosticFailure retains the raw diagnostic-sink reason; root invocation
cleanup is awaited before selection. Preserve actual escaping caller/control/
resource/sink values and falsy reasons, while retaining secondary cleanup failures.
A nonzero mapped shell status is not automatically an escaping JS exception.
No new wait on arbitrary opaque provider work is proposed.

## Finite incremental set and honest discovery

Frozen runtime3254 validates a whole token before applying any letter. Replace
that all-or-nothing gate with encounter-order scanning of the *already supported*
e/u letters, and terminal o with `errexit`, `nounset`, `pipefail` only. Proposed
ordinary-Bash invalid-tail status is1 with budgeted diagnostic and ordinary return;
earlier supported mutations remain. A later command may therefore execute unless
existing errexit logic stops it. Do not replace special `sh`/POSIX handling as part
of U06; do not enable -z or arbitrary Bash flags. Unknown/nonterminal-o ordering
outside this finite grammar stays explicitly unsupported, not guessed GNU parity.

Bare `-o` proposal: write **only actual supported option state**, stable order
errexit/nounset/pipefail, one `name\t(on|off)\n` record each. Bare `+o` proposal:
the same three states rendered as `set -o NAME\n` or `set +o NAME\n`, suitable for
restoring this finite profile. Both return0, preserve positionals and await the
budgeted sink. This is truthful **subset discovery**, intentionally not GNU's full
table/spacing, nor a claim every omitted option is implemented and off. Keep
dotglob under its real shopt interface; do not fabricate SHELLOPTS/BASH_VERSION.
ROOT may instead leave listing OPEN; explicit approval is needed for these bytes.

Keep no-argument `set` outside this small listing change; no environment dump is
invented. Retain existing `--` and positional-only handling. Failure after earlier
flags must not roll them back; failure before positional publication must not
silently replace positionals. Test both +/- and failure-order neighbors.

## Aggregate presence is not aggregate length

Frozen `runtime.ts:3559` currently returns0 when both binding/scalar are absent;
`arrays/bindings.ts:45–65` distinguishes an existing IndexedBinding with an empty
Map from no binding. Proposal for ${#a[@]} and ${#a[*]} under nounset:

- Existing empty indexed binding:0; sparse binding:actual element count, not
  highest index+1. Preserve existing binder ownership/admission and no allocation.
- Absent binding **and** absent scalar: new private missing-aggregate-length
  failure naming `a`, not `a[@]`. Under nounset off, preserve existing0 behavior.
- Do not conflate `${a[@]}` expansion presence/default operators with length, nor
  restore Unit3's now-refused `[[ -v a[@] ]]` profile.
- Scalar-only aggregate-length behavior and nested/native edge tuples stay
  separately qualified; do not classify every `binding === undefined` as missing.

For U27 propose private Flow kind **discard**, distinct from exit/return. Emit
one guarded/budgeted diagnostic, then unwind the current parsed input unit with
status1. Root `runUnit` can return `{exitCode:1, terminated:false}` after updating
state.status, allowing the caller's existing parse loop to advance to unit.next.
This does **not** mean continue with the next command in the abandoned unit.

Concrete existing boundaries:

- Shell.exec loops parseShellUnit (`shell.ts:269–277`); command-string and stdin
  interpreter loops already call runUnit (`runtime.ts:2399–2455`). These can honor
  the new private result without shell.ts/public AST edits.
- Functions catch return only (`2125`); source cleanup/restoration is in finally
  (`2830–2839`). They must not convert discard to an ordinary local return.
- `runCurrentText` for source/eval directly calls script (`2697–2717`), not runUnit.
  Whether the source/eval reader consumes discard locally or propagates it to the
  caller reader needs ROOT/native qualification. Do not casually catch every
  ExpansionFailure there or assume each newline is its own execution boundary.
- Isolated pipeline commands currently catch exit/return (`1468–1473`); a discard
  must end only their own logical unit, not escape as a raw public JS error or
  terminate siblings. Command substitution/subshell bodies may already be one
  parsed Script; their next-line continuation is not proved by root reader loops.

Recommend staging root reader U27 first and keeping source/eval/nested/-e variants
explicitly OPEN until their boundary policy is ratified. If ROOT instead requires
all nested forms in the same unit, freeze and qualify those variants before
implementing their catches. No universal GNU DISCARD claim follows from the
proposed private kind. No change to existing errexit/pipefail algorithms is proposed.

## Eleven original IDs: candidate changes versus questions

| ID | Source-based candidate action | Still unqualified |
| --- | --- | --- |
| U06 | Incremental supported flags; retain u before invalid z; ordinary return1 | Exact GNU diagnostic/usage, sh-special behavior, -e neighbors |
| U07 | ROOT-selected truthful three-state listing, or retain OPEN | GNU full table/spacing; +o/cluster tail details |
| U17 | Keep explicit-parameter class and isolated/nonisolated distinction | Actual -c/stdin/nested status/prefix/line; sink guard choice |
| U27 | Separate absent aggregate length/discard from scalar fatal/zero | Same-unit vs next-unit, nested source/eval/substitution/pipeline, -e |
| U28 | Preserve existing empty binding length0 | Runtime original tuple and separate presence/default tuple |
| U31 | Enforce nounset on evaluated scalar read; preserve sentinel through expansion | Native FORCE_EOF final mapping/diagnostic |
| U32 | Preserve plain assignment RHS-only evaluation/write | Actual original program; readonly/resource ordering neighbors |
| U33 | Same read gate on compound LHS before RHS/write | Native final mapping; no eager pre-scan |
| U34 | Same increment gate; prevent LET catch from ordinary-error recast | Native final mapping/prefix; all cleanup boundaries |
| U35 | Preserve present-empty0 and lazy OR/ternary | Original tuple remains UNRUN, not inferred pass |
| U36 | Recursive reached-name gate diagnoses inner missing | Native prefix/line/status; recursion/limit/caller controls |

## Concrete ROOT ratification questions

1. Approve runtime-only read gate/catch closure, preserving accepted fatalstatus1
   as explicitly provisional while GNU invocation-specific mapping stays OPEN?
2. Approve incremental ordinary-Bash invalid-option return1 and preserved partial
   mutations, leaving sh-special policy unchanged?
3. Approve the exact truthful three-state -o/+o listing bytes above, or keep bare
   listing unsupported pending fuller compatibility work?
4. Approve a private discard control for root input-unit U27 with existing empty
   array0, while holding source/eval/nested/-e continuation questions; or require
   those additional boundaries in the same future implementation grant?
5. Include a narrowly guarded U17 diagnostic-sink path, or leave that separate
   source caveat OPEN? No generic error swallowing is proposed for new paths.

## Future finite recipe, not execution authority

`CASES.json` declares **28 identities**: Sagan's11 original literals unchanged,
his7 source probes unchanged, plus5 neighboring programs and5 host protocols.
All expectedNativeRuntime fields are null and all execution fields UNRUN. Each
is a proposed versioned identity, not a pass/skip or an implementation-derived
golden. Native invocation profiles remain separate (-c/default ONESHOT versus
stdin); no local3.2 substitution, output normalization, or diagnostic filtering.

A future author grant should build only the ratified selected source, bind whole
pack/installed/moved consumers, then independently review read/assignment/lazy
and continuation mutants. Caller/limit/falsy-sink/registered-cleanup protocols
need existing public APIs, not test-only runtime hooks. Native execution needs
its separate controlled-oracle authorization. No held native43/P2/fullgate/XAN
work is resumed by this document.
