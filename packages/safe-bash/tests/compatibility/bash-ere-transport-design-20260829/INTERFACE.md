# Proposed private additive interface and lifecycle

DESIGN ONLY. Pure engine candidate f97fd06024cb63edfd01873d81d84576a22189db is NOT independently accepted. Only its types.ts/errors.ts/limits.ts bodies and supplied evidence handoffs are inspected; compileEre/matchEre signatures below are author-declared, not matcher/syntax source inspection or execution. No production/type fixture is created.

## Exact source-defined engine mapping

- types.ts: EreFragment={text:string,literal:boolean}; EreProgram={pattern:string,groups:number}; EreResult is matched:true with captures/values or matched:false with empty captures/values. It is NOT the proposed wire result.
- EreResource has exactly patternBytes,subjectBytes,work,states,allocationUnits,captureBytes,captureSlots. EreLimits/EreUsage are readonly records of those seven keys.
- limits.ts: new EreLedger(bounds,lowering?) validates lower-only overrides; usage getter snapshots all seven counters. admitInput records maximum input length for patternBytes/subjectBytes, not a sum. charge is cumulative for other resources and rejects before incrementing over the cap. captureBytes/captureSlots are already charged for complete engine-returned strings/vectors. No input ownership/temporary JS allocation/RSS guarantee.
- Author-declared compileEre(stringOrLiteralFragments,ledger,signal?) returns a same-ledger/module WeakMap-bound handle; matchEre(program,subject,ledger,signal?) returns the pure result. Compile and match must stay in the SAME Worker/module/ledger. Do not postMessage the handle, reconstruct its branded appearance, or cache/reuse it across fresh grants.
- errors.ts has local EreSyntaxError/EreUnsupportedError(status2), EreProfileLimitError(resource,limit,status3), and EreUsageUnknownError(status3,cause). Unknown-usage is NOT interchangeable with validated profile-limit and must not be recognized merely by status3/name/cause shape.

## Separate wire schema proposal

```ts
import type { EreExpansionBounds, EreLimits, EreUsage, EreFragment, EreSpan, EreResource } from "./ere/types.js";
interface EreTransportResult {
  readonly matched: boolean;
  readonly groupCount: number;
  readonly spans: readonly (EreSpan | null)[];
  readonly steps: number;
  readonly allocatedUnits: number;
}
interface EreTransportRequest {
  readonly version: 1; readonly operation: "shell-ere";
  readonly id: number; readonly grantId: number;
  readonly profile: "ascii-c-posix-v1";
  readonly bounds: EreExpansionBounds;
  readonly allowance: EreLimits;
  readonly pattern: readonly EreFragment[];
  readonly subject: string;
}
type EreTransportReply = {
  readonly version: 1; readonly operation: "shell-ere";
  readonly id: number; readonly grantId: number;
  readonly kind: "result"; readonly result: EreTransportResult; readonly usage: EreUsage;
} | {
  readonly version: 1; readonly operation: "shell-ere";
  readonly id: number; readonly grantId: number;
  readonly kind: "failure"; readonly category: "syntax" | "unsupported" | "profile-limit";
  readonly resource: EreResource | null;
  readonly message: string; readonly usage: EreUsage;
};
```

Do not shadow/redefine the engine's EreUsage/EreLimits/EreResult exports. Transport types live separately; existing protocol.ts unions/RegexExecutionOptions and expr remain unchanged. ASCII non-NUL strings make UTF8 byte counts equal code-unit counts after explicit admission; they are not permission to accept Unicode or flatten literal-origin fragments. A bounded fragment vector is retained exactly; no matcher quoting algorithm is invented here. An explicit finite metadata/fragment count is still required, including empty fragments; do not derive it from nonempty pattern bytes alone. No new case-fold flag is implied.

Worker validates full request before constructing ledger/copying operands, then creates new EreLedger(bounds,allowance), compiles and matches using that same ledger. It snapshots usage both after success and after a recognized semantic exception; a snapshot/serialization failure is unproved transport failure, never a zero-usage semantic reply. The seven-key allowance includes absolute pattern/subject caps and the reservation's remaining cumulative resources. Re-deriving limits from smaller B/F is WRONG: that would also shrink unrelated input caps. Use the exact original bounds plus lower-only per-resource allowance.

Success conversion: groupCount=program.groups; matched=true spans=result.captures (validated complete groupCount+1); matched=false expands the source-defined empty vector to groupCount+1 null slots. The latter canonicalization is a proposed wire rule requiring ROOT signoff, not a pure-engine change. Copy no result.values into the wire: result.steps=usage.work and result.allocatedUnits=usage.allocationUnits. Envelope retains usage.states and all capture/input counters. Duplicate values must agree exactly. Already allocated engine values remain charged even if their bytes are not transported.

Semantic errors: only exact local engine exception routes may become syntax/unsupported/profile-limit envelopes. Syntax/unsupported resource=null; profile-limit has a finite resource. Proposed transport message maximum512 UTF8 bytes, bounded scalar-prefix truncation/constant fallback BEFORE own concatenation/encoding; no stack/cause/error.toString or arbitrary-error serialization. Unexpected engine errors escape to the owner as execution/transport failures, preserving the no-unproved-refund rule. EreUsageUnknownError cannot silently become no-match or “syntax”; it marks a poisoned owner/ledger route and retains the underlying failure separately.

IDs/grantIds are own safe integers starting1, never wrap. Every usage/allowance number is finite nonnegative safe integer, not -0, and every usage component <= its corresponding grant/cap. Zero usage on a genuinely pre-work failure is allowed; do not import expr's minimum1 or invent a positive counter. Keep active expected IDs, operation and a once-only reply bit. Duplicate/stale/other-family replies are PROTOCOL. Whole envelope and usage validate before any refund/semantic publication.

Result has exactly five keys. groupCount is <= source-declared32; spans length exactly groupCount+1. matched=true requires non-null spans[0], while matched=false requires every span null. Each participating span has exactly own start/end and0<=start<=end<=subject.length; subgroups are contained in group0. null is nonparticipation; [k,k] is an explicit empty match. Validate exact cardinality, every field and checked aggregate lengths before copying/decoding parent captures. No provisional/truncated capture success.

Cross-realm validation uses exact finite own-data keys/types/values and sequence order, never realm prototype identity. Reject proxies before reflection, accessors/symbol extras/holes/oversized arrays, nonboolean matched/literal, fractional/NaN/infinite/-0 counters, wrong IDs and arithmetic overflow without invoking getters/coercion. null/false/0/empty-string/undefined replies are protocol failures, not no-match. Node structured clone already allocated received data before validation: trusted static Worker code bounds message construction; this is NOT a hard preallocation/RSS guarantee against an arbitrary compromised Worker. Future synthetic malicious records themselves must be size-bounded.

## Root/session facade and exact ownership

```ts
interface EreTransportInput { readonly pattern: readonly EreFragment[]; readonly subject: string }
interface EreSession {
  match(input: EreTransportInput): Promise<EreTransportResult>;
  close(): Promise<void>;
}
interface EreRootOwner {
  open(scope: InvocationScope, signal: AbortSignal): EreSession;
  close(): Promise<void>;
}
```

Creation is inert: no Worker/timer/listener/copied operands/public callback. At Shell.exec's fresh Budget+InvocationScope register root cleanup BEFORE activation, then bind one private owner in a WeakMap keyed by Budget. No new fields on Budget/ShellLimits/State/public options. Missing descendant binding is an invariant failure, not authority to create/reset a root. Closed binding remains closed while Budget is reachable; late continuations cannot recreate it. New independent public exec creates fresh owner even on the same Shell. All internal invokes/pipelines/substitutions/interpreted descendants share Budget/root, but capture visible-state cloning remains separately owned runtime behavior.

Session open registers its own idempotent close with child InvocationScope BEFORE signal composition/listeners/request acquisition. Sessions own their pending jobs/retirements, share the one root ledger/executor, and never cancel sibling sessions on local close. Root close seals every admission first, cancels owned jobs, then awaits every session/Worker/host observer cleanup. Prefer one serial ERE active job per root and a bounded precharged cancellable queue initially; this does not change public RegexExecutionOptions.maxWorkers or expr scheduling. Never hold the Worker job lease across operand expansion, VFS, output or capture-publication callbacks. No automatic retries.

A private successful session result may return while the now-idle Worker remains owned for reuse; it is not an exit receipt. Public root settlement still awaits actual root-owned Worker retirement. Active cancellation/protocol failure retires that Worker before the failed job settles. If all available compute credit is merely outstanding in the active grant, a bounded waiting ticket must wait for its verified settlement rather than pretend the credit is already spent; matcher allowance is finalized at dispatch. Queue metadata/input ownership needs a separately precharged bound, with no unbounded queue or early operand copying.

## Reservation and failure accounting

Keep a parent reservation book separate from worker-local EreLedger. It tracks spent and outstanding cumulative work/states/allocationUnits/captureBytes/captureSlots plus input high-water and separately defined live transport bytes. Parent copies/queue/frame validation are not included magically in worker usage. Bind exact parent charge weights/live capacity before implementation; do not relabel host copies as public shell command/loop charges or invent an RSS promise. Current pure allocation units explicitly exclude input ownership.

1. Admit scope/caller/finite ASCII/limits and checked sizes. Reserve queue metadata/input copies/reply capacity and non-overlapping allowances BEFORE growth or postMessage. The root supplies original B/F and exact remaining cumulative allowances; input ceilings remain per-input.
2. A queued unsent ticket can release demonstrably unused engine allowance only if execution nonacquisition is proven. Parent work already performed remains spent. No proof means conservative consumption.
3. After cleanup registration, record a returned Worker handle and error/exit/messageerror ownership immediately, before timers/observers/ready publication/postMessage. Any later throw closes admission and drains that handle; constructor throw without a returned handle is nonacquisition, not an unconfirmed acquired Worker.
4. Validate a complete semantic reply, including all seven usage fields, before once-only commit. Add the five cumulative usage amounts to parent spent counters, take maxima for pattern/subject high-water, then release ONLY proven unused outstanding allowance. Parent spent charges never decrease. For capture counters already charged by pure result creation, do not charge them again merely because a transport vector is serialized; parent/ArrayLedger copies are separately budgeted.
5. Timeout/crash/malformed/missing reply/postMessage/observer failure or abort after send consumes all UNPROVED reserved cumulative components. No late reply refund. Valid usage already committed before later caller failure is not double-charged; its ordinary result still cannot publish after cancellation. Poison/refuse remaining work if usage cannot be bounded by a valid grant. No fresh Worker/session restores credit.
6. Release live owned references only when actually dropped after job/Worker settlement as appropriate; failed retirement cannot publish clean/free. Attempt every cleanup independently and preserve primary presence/value including undefined, plus secondaries. Root actual caller/control selection retains existing precedence, not an error-name or reason-equality inference.

Current unaccepted deriveEreLimits computes pattern min(B,65536), subject min(B,1048576), work min(50000000,32B), states min(65536,8F), allocation min(4000000,8B+128F), captureBytes=B/captureSlots=F, with saturating products/sum and zero unchanged. Its source constants are now pinned; that is not new ROOT integration ratification or independent numerical-boundary acceptance. Grammar remains the engine's declared4096nodes/depth64/groups32/interval255, not a shell AST limit.

## Error/output/publication

Use explicit captured return/throw and owner-established origin; undefined is an actual possible reason. Existing runtime cancellation machinery decides caller/control precedence. A validated profile-limit creates a local EreProfileLimitError; arbitrary host errors/genuine ShellLimitError/sink failures stay raw. Transport errors are execution/cleanup failures, not automatically profile-limit status3 just because expr maps its own errors to3.

At the separately authorized conditional boundary: private limits escape boolean evaluation and map once to bounded diagnostic/status3; syntax/unsupported map2; normal matched/no-match become0/1 after publication. Preserve old BASH_REMATCH on semantic errors or transport failure. Validate capture-byte sum including group0/overlap and slots before decoding, reserve complete array staging with old/new overlap and recheck caller/readonly/stale according to ratified runtime policy. No fake source/eval/arrayAssignment, no blanket ArrayFailure catch. Nonparticipation becomes the approved empty-string value only at publication. Engine-returned values already consume its capture budget even when parent publication fails; no rollback/refund of that work.

Diagnostics pass through existing awaited budgeted sinks; real maxOutputBytes or raw sink/caller failure can prevent a would-be numeric result. No production observer is added. Future admitted trusted observers, if any, are owned awaited host jobs with enrolled cleanup, including Promise rejection(undefined); no fire-and-forget telemetry or acknowledgement-as-execution proof.
