# H02 independent SOURCE/DATA adjudication

2026-08-29. No candidate execution, compiler, native oracle, Worker or private engine.
Precode commit: d9e466af6212a35fe190ee7ca8636f0e491df628.
Candidate source: 6fde455bcc103117a6424b95156b152721f5735f.
Independent derived composition: 501ad98748e639c909f717007dac4f1da19c67dc.

## Recommendation to ROOT

H02 does not establish a new conditional ownership defect. Its immediate-finalizer
assertion requires a barrier expressly excluded for opaque FS promises. Preserve
all three failures. Authorize a separately versioned controlled-release observer
and an explicitly registered-cleanup companion before actual review; no product
fix is justified by this evidence. This is SOURCE adjudication, not a runtime pass,
proof of no leak, or observation of eventual finalization in the original run.

## Exact original assertion and evidence

Authenticated author RESULT.json at 97eba3743f4c00998d5f0f4c05cc2e0bbc04e1cd:
SHA256 9bd896f86fcd7f0a037da512bceb617550092e5ac56b8f0d660d0c7cdffe557e.
Authenticated conditional.mjs SHA256
29593d551f6e4fe310907036b82d9f3494ac0b76780ae6008ef4b5cb1647af25, line61.

Script: `[[ -f file ]]`. Custom stat aborts the caller with one frozen object,
throws options.signal.reason, then its finally awaits setImmediate before
`closed = true`. The first assertion compares the captured public reason by
identity; the second is `assert.equal(closed, true)`.

SOURCE, INSTALLED and MOVED each retain `false !== true` at consumer61:499.
The preceding reason-identity assertion passed. Each row records created1,
disposed1, cleanupFailure:false. Those fields mean Shell.dispose fulfilled;
they do not observe the provider's later finally completion. No completion
observer exists after disposal. No resource acquisition other than the fixture's
scheduled continuation is identified, and no callback is registered. The author
SOURCE clarification11599f523f1706f54052927ee6806d4726e65c35 is consistent with,
but not substituted for, these independently authenticated fixture/result bytes.

## Actual source ownership chain

At the exact candidate, src/shell/conditional.ts:116 awaits stat/lstat. Its
async leaf at133–135 returns the unary promise (async assimilation, not detached
work); evaluateConditional at163–176 awaits the leaf. Runtime at1517–1535 awaits
evaluateConditional. No new void call, forgotten provider promise, resource handle
or unregistered conditional-owned asynchronous cleanup was found in this route.
The provider rejection remains attached to the awaited operation chain.

The unchanged public shell boundary is different from awaiting that chain until
arbitrary host completion. src/shell/shell.ts:46–74 captures cancellation, observes
the losing raw rejection, and may select caller reason first; exec:184–190 then
awaits scope.close and selects outcome. Its existing execution race at271 and
runtime.ts:130–141 likewise observes/assimilates the losing promise. The latter
function is byte-identical to baseline. Runtime conditional catch:1537 checks
caller signal before any unsupported/provider classification.

The unchanged InvocationScope in src/shell/cleanup.ts:43–58 drains registered
callbacks and child scopes, not an inventory of arbitrary FS promises. FsOptions
in src/contracts/filesystem.ts has signal, not an operation-enrollment handle.
The new helper does not remove a previously registered FS callback.

The controlling unchanged contract is src/contracts/command.md:103–129:
public settlement drains accepted cleanup, including nested scopes losing an
abort race; lines114–116 explicitly exclude opaque handler/middleware/FS/sink/input
promises while requiring observation of late rejection. Lines122–129 preserve
caller identity, then selected execution rejection, then cleanup failures.
This is not a license to ignore registered callbacks or turn cleanup failures into
success. Exact source/contract hashes are in BINDINGS.json.

## Prospective boundary, not a golden rewrite

H02-V2-PROPOSAL.json seals three bounded variants: direct opaque-provider abort,
explicitly enrolled bridge/child cleanup, and normal completion. All are UNRUN.
A host-controlled release plus actual terminal observer replaces setImmediate
race inference. Harness finally must release and join its own task even when an
assertion fails. Registered control requires capability checks before acquisition,
registers before child invoke, and records callback-before-public-settlement order.
It must retain original caller identity. No new FS API or implicit raw-promise
barrier is proposed. A failed ordinary assertion is reported only after known
fixture cleanup; unknown retirement is a safety stop.

## Independent composition and scope

All293 selected stored blob identities/bytes authenticated: 2,685,865 bytes,
289 unchanged, three modified (parser/runtime/display), one added conditional.ts,
zero removed. Canonical source subtree b928c4d446c46175646ba99d9b09efa53ff01c1e
and opaque inherited root recompute exact501ad987... without requiring the derived
tree in the object database. shell/cleanup/cancellation/input/contracts/root APIs,
package and default80 registration are unchanged at source. The parser's new
public conditional AST variant is authorized, not a claim of AST clone/serialization
compatibility. Instruction entries remain opaque; no AGENTS content is archived.

Full954 tar4df865... is AUTHOR-bound only at this phase: not independently unpacked,
rebuilt, installed, moved or executed. No product or type passes have been added.

## Concrete remaining policy decisions

1. Aggregate -v: candidate runtime:1526–1530 explicitly accepts a[@]/a[*] and
   returns nonempty array membership (or scalar presence). Author A27 expects
   sparse a[@] true. ROOT's stated profile is scalar/canonical index, with array
   edges OPEN. Recommend reached aggregates refuse2 until explicitly authorized;
   canonical index0..2147483647 remains frozen. This is an observable scope choice,
   not an H02 failure or a candidate-executed counterexample. A27 cannot silently
   ratify it. Ask ROOT to admit this explicit extension or route a narrow author
   correction; do not alter author expectations independently.
2. Errnos: candidate conditional.ts:126–129 gives ENOENT/ENOTDIR false for all;
   access-only EACCES/EPERM/EROFS false; ENOSYS/ENOTSUP/EOPNOTSUPP unsupported2;
   metadata EACCES/EPERM and ELOOP propagate. Confirm whether documented denial
   false includes metadata EACCES/EPERM. Recommend explicit per-operation mapping,
   not blanket errno false or unobservable permissions synthesized from mode bits.
3. Redirected diagnostics: source uses current io.stderr (runtime:1539), consistent
   with accepted Unit1. Recommend ROOT confirm this interpretation of design's
   original-caller wording before unholding N11 exact routing; not native bytes.

Other source clarifications, not new policy: node admission counts expression
nodes before constructing each node, parentheses count depth not AST nodes;
all parsed branches admitted (parser:619–648). Non-C/POSIX comparisons explicitly
refuse. Pattern work is a conditional-local counter initialized from existing
maxExpansionBytes (runtime:1522), not a new public limit or demonstrated global
shared-work/RSS cap. Dynamic boundary/quote/errno tests remain required.

## Case identity and readiness

Original design C01–C40 GNU differential recipes plus H01–H10 design protocols are
UNRUN. Author A01–A40 product-profile scripts plus H01–H10 host protocols are a
separate set; 49/50 per layout is author evidence only. A14/A33/A34/H10 are deliberate
unsupported refusals, not successful native comparisons. Twelve independent N01–N12
were committed before candidate body inspection; N11 remains explicitly held.
Do not sum overlapping host identities or call 62 independent product passes.

PROTOCOL.md plans three layouts, retained201/layout plus acceptedUnit2 independent16,
author50 and novel12, typed AST consumers, ten activated mutation families with
restores and binding refusals. These are future planned groups, not actual counts.
Exact executable/tool/application closure and final role census must be committed
before a separate actual GO. No product execution is authorized by this receipt.
Inherited Unit2 eleven OPEN identities, array SOURCEONLY/MIXED/AST limitations,
qualified fixed-loader/applicationWorker distinction and no universal preemption
or native/full-Bash/global-HEAD guarantee remain unchanged.
