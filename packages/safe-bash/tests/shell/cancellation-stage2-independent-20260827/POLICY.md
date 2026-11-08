# Stage2 independent pre-integration freeze

This is the different reviewer's Stage2 fixture freeze, **after** private helper
`fbbe1ef793b7434871403125efbeb46624a8e081`, **before** any Stage2 invocation
integration or public signal option. It is not a pre-helper freeze. The reviewer
read that helper and the existing runtime, scope, budget, getopts and root barrier
implementations before writing these fixtures. Helper repair remains under
Locke's separate review. No Stage2 author implementation was supplied or read.
Root design: `7b812873c884a432951e981bfa908d7ca7407494`.

There are **32 obligation families**: 25 actual-runtime families R01–R25, one
private control-order seam C01, and six public/internal type families T01–T06.
Reason/container/order variants are not extra independent cases. The future
feature is NOT accepted by freezing tests. No timeout command, timer scheduler,
status-124 mapping, global counter, product Promise.race, new Shell, budget reset,
or root export change is proposed. Numeric 124 appears only as an arbitrary
command result in the cleanup-priority control.

## Required policy and exact cases

| ID | Obligation |
| --- | --- |
| R01 | Omitted options, explicit undefined argument, absent signal, and signal undefined borrow the existing delivery signal. Child completion cannot close the borrowed parent. Parent listener balance, continued admission and the existing two native controller allocations (invoke scope plus command scope) survive. |
| R02 | Inherited getter, Proxy, function and array containers use ordinary lookup, exactly one signal read, and detach the valid local listener. Effects of host getters/traps are not counted as runtime zero-admission promises. |
| R03 | Invalid containers and non-native-branded signal values yield TypeError before any child scope or leaf handler. AbortController is not AbortSignal. |
| R04 | Preaborted original root caller wins without reading options at all; exact reason, zero child scopes. |
| R05 | Throwing getter preserves undefined/null/false/0/-0/empty/NaN/object identity; its own single effect remains visible; zero child scopes. |
| R06 | Root abortion inside the getter outranks its staged thrown error after the priority recheck. |
| R07 | Preaborted local reasons reject exactly before input acquisition or child scope creation. Native-branded own-undefined reason is an explicit host fixture. |
| R08 | Live child cancellation replaces a numeric result only after registered cooperative cleanup drains. Exact object and six native falsy reasons survive nested invocation; parent stays live after catching the child rejection. |
| R09 | First delivered inner reason stays immutable; later outer then root events during held cleanup improve open-boundary settlement to original root reason. No early public settlement. |
| R10 | Outer-first delivery and ranking cannot downgrade when inner aborts later. |
| R11 | Completed child result/delivery are not retroactively changed by later local abort; another invocation still succeeds. |
| R12 | Canceled child cannot poison parent, same-parent sibling, or a separate Shell. |
| R13 | An actual captured invoke env-getter rejection outranks a later local cancellation during child scope closure. No assumption that arbitrary command-handler errors escape the existing diagnostic/status mapping. |
| R14 | Same-object error from a later sibling's env getter is not the prior sibling's descendant cancellation report. A newly aborted outer origin cannot erase that unrelated captured error. |
| R15 | Existing cumulative maxCommands admission is shared across local-signal and omitted-signal invocations; original ShellLimitError identity survives. No added/getopts/deadline tick. |
| R16 | Deterministic downstream head-zero close during a real invoke keeps pipeline control local and permits following `true`; no caller abort. |
| R17 | Sole cleanup failure undefined/false/0 beats numeric 0/7/124 at the root public barrier. |
| R18 | Already selected execution Budget failure beats cleanup failure. |
| R19 | Root caller abort during cleanup beats both captured execution and cleanup failure; cleanup still runs. |
| R20 | Multiple cleanup failures retain exact ordered AggregateError members; no swallowing falsy errors. |
| R21 | Local subscriptions detach after success, preabort, and post-admission argv failure; healthy sibling remains usable. |
| R22 | A native signal method that attaches and then throws rolls back its listener and all scopes admitted before failure; no unapproved requirement that this valid-signal setup failure allocate zero scopes. |
| R23 | Literal argv (including Unicode values), selected cwd, replaceEnv, middleware resolution and result survive the additive signal. |
| R24 | getopts child cloning, explicit child OPTIND environment and temporary same-scope prefix restoration preserve the parent's clustered cursor. |
| R25 | Binary stdin provenance, exact bytes, sink overrides, iterator return and unrelated redirect lifecycle survive. |
| C01 | First live observed control event drives delivery. If multiple controls were already aborted before first observation, use explicit configured order (budget then pipeline in this fixture), not invented historical chronology. This is a private seam control, not a public runtime case. |
| T01–T06 | Native signal on public/internal options; readonly consistency; four invalid signal classes rejected; old options/undefined third argument unchanged; streams plus literal argv accepted; result remains CommandResult without new status channels. |

## Boundary instrumentation and limits

Tests use the **existing context.invoke**, registry, middleware, shared Budget,
Shell state, VFS and scope closure. No replacement invoker is installed.
R03–R07 count calls to the existing InvocationScope.child method to observe the
admission boundary. R13/R14 attach a cleanup callback to the first actual child
scope to place cancellation after execution capture. R22 also observes closure
of any admitted scopes. Prototype instrumentation is restored in finally and
tests run serially. C01 alone calls the private helper directly. A candidate
review must authenticate both public implementation and these private seam bytes.

Held-cleanup tests use explicit gates, never timeouts as success. Host work is
released even on the pre-integration baseline so missing signal support yields
an assertion failure rather than a hanging producer. The test runner's 2500ms
case bound and failure-only fixture abort are watchdog/teardown, not product
behavior. Any watchdog or forced cleanup rescue must be reported separately;
it cannot count as a candidate pass. No uncooperative native preemption is claimed.

R01 instruments the native AbortController constructor during invocation, in
addition to delivery reuse and listener balance. A future reviewer must still
inspect the integration for a privately captured constructor or unused link
allocated then thrown away. These observations alone cannot prove absence of
invisible allocation. The same applies to private parent
subscription retention: observable native listener balance is necessary, not a
complete heap-retention proof. Targeted candidate mutations below remain required.

## Targeted weakening classes for candidate review

1. Ignore the new invoke signal or close a borrowed parent (R01/R07/R08/R12).
2. Read signal twice, skip the native brand check, or allocate before validation
   (R02–R07, scope counters).
3. Derive origin from composed reason, rank by arrival rather than ancestry, or
   rewrite the already delivered reason (R09/R10).
4. Treat normal scope close as cancellation, or mutate a settled child outcome
   after late abort (R01/R11).
5. Match a sibling report by equal reason alone, or globally retain child reports
   (R14 plus repeated sibling/resource controls).
6. Race public settlement past cleanup, swallow a cleanup-only failure, or lose
   falsy errors (R08/R09/R17–R20).
7. Leak local listeners, parent subscriptions or setup resources; inject an
   attach-then-throw signal and verify rollback (R21/R22).
8. Construct a new Budget/Shell, charge an extra admission tick, reset getopts,
   drop env/stdio/middleware, or lose literal argv (R15/R23–R25).
9. Use configured ordering for controls that were observed live, or claim
   chronology for already-aborted unobserved controls (C01).
10. Remove/loosen the public property, readonly attribute or invalid-type checks
    (T01–T06; negative compilation must fail for intended diagnostics).

These are frozen **control classes**, not executed mutant kills or acceptance
counts. Concrete source-site mutations await the actual integration candidate;
they must not modify this original freeze to hide a failure.

## Questions and boundaries for root before author integration

- **Explicit undefined in TypeScript:** runtime `{ signal: undefined }` is
  approved. The written proposal is `readonly signal?: AbortSignal`; under
  exactOptionalPropertyTypes it does not accept that object literal. Should the
  public/internal declaration instead be `readonly signal?: AbortSignal | undefined`?
  T01–T06 deliberately do not invent that unresolved typing answer: undefined
  third arguments and reading the optional property remain covered.
- **Undefined delivery:** native `abort(undefined)` stores a DOMException, not
  undefined. R07 uses the same explicitly disclosed native-branded own-reason
  fixture as Stage1 to test pre-admission exact undefined; R05/R17 cover real
  thrown undefined. Live delivery tests use normal native reasons. No assertion
  silently requires a native controller to store undefined internally; a stronger
  live-undefined requirement needs an explicit delivery profile decision.
- **Existing error mapping:** command handlers/middleware normally become shell
  diagnostics/statuses in executeCommand. R13/R14 test rejections genuinely
  captured at invokeScoped (env getter) and R15/R18 test Budget rejection. The
  policy must not be read as authorizing a blanket change to existing command
  error-to-status behavior. No new policy decision is needed if “captured” retains
  this meaning.

No production writes, broad cohort, packed acceptance, private-checkout reads,
runtime authorization, or timeout implementation follows from this seal.
