# Node-local API freeze v1

Status: implementation contract, before author tests or compiler/engine activation. Date2026-08-29. CONTRACT.md remains the profile; BASELINE.json supplies the accepted public79 composition. No root export or default registration.

## Trusted provider

createNodeCommand({provider, grants?}) returns a command named node; the required provider is never discovered, imported or created by the command. NodeRuntimeProvider has exactly profile, identity, prepare. Profile is NP1-CJS-WRQ-L-SYNC-1; identity is a bounded nonempty host-selected string. prepare(request,services) is synchronous and inert. Its returned own-data callable start/cancel/retire methods are detached callbacks, not receiver-dependent. The host is trusted to satisfy inert preparation, genuine synchronous guest bridges, exact guest inventory, engine isolation, entry-return cutoff and actual retirement. A self-label is not qualification.

NodeSourceRequest own fields: profile, selector(eval/print/file/stdin), source, program, filename, cwd, argv, env, grants, limits. Strings and arrays are immutable data snapshots; program is the complete admitted interpreted program, NEVER native code. The provider must not replace the existing shared Shell budget or expose host globals/factory/ports/SAB/process/fs. Fixed module limits are exported readonly literals in types.ts, not new ShellLimits fields. Provider-side allocations retained on behalf of the command use services.reserve(label,bytes); native evaluator/heap allocation remains separately qualified, not whole-guest ledger accounting.

start() resolves only an exact NodeCompletion {kind,observation}. kind is entryReturned/guestFailure/profileFailure. observation is {state:captured|unknown,fault:boolean,name:string|null,message:string|null,code:string|null}; unknown has null fields. No observation/false-fault may imply observed success. retire() resolves exact {acquisition:none|exited,exitCode:number|null}; none requires null and proven nonacquisition; exited requires an integer actual exit code. Unknown acquisition or cleanup rejects, never becomes a clean receipt. cancel({present:true,value}) receives the actual reason without serialization, including undefined. retire is idempotent, covers startup rollback and stops/joins the owned Worker. Entry return is lifetime cutoff, not all Promise settlement.

NodeHostServices: signal (invocation-private cooperative signal), request, delivered, reserve, cutoff. request resolves an own-data NodeHostResponse after the actual operation. delivered(sequence) is only called after the guest has made its own response/error copy, NOT on transport ACK. cutoff closes all new request admission and the admission deadline; already acquired parent work remains owned and drained. No new operation after cutoff. Providers must not catch host rejections and substitute guest errors. Control/sink/cleanup raw reasons stay parent-side. Local usage/denial and authenticated FS failures use only the finite DTO below.

## Exact wire records

NodeHostRequest has all eight own fields and no extras: sequence,op,authority,path,flag,text,moduleKey. sequence is the next positive safe integer1..128; no gaps/repeats. All nullable fields MUST be present. Metadata UTF8 <=8192 bytes; body separate <=1MiB. Only one active operation/delivery record at a time. The operation is completely admitted before acquisition:

|op|authority|path|flag|text|moduleKey|
|---|---|---|---|---|---|
|authorizeModule|module|null|null|null|fs/path/process or node: alias normalized by guest|
|authorizeJson|json|explicit relative/absolute .json|r|null|null|
|readText|json|previously authorized canonical .json|r|null|null|
|readText|data|virtual string path|r|null|null|
|readText|stdin|null|r|null|null|
|writeText|data|virtual string path|w or wx|string|null|
|writeOutput|stdout or stderr|null|null|string|null|
|path|path|null|null|JSON dense string array <=16|join/resolve/normalize/dirname/basename/extname/relative/isAbsolute|

Metadata string paths are <=1024 UTF8 bytes, no NUL; normalization may not exceed the same cap. Path method results are virtual POSIX, resolved against invocation cwd, never host cwd. Path-only computation has no FS authority. JSON resolution is against entry dirname (inline/stdin cwd); each cache hit first reauthorizes using the bound context.fs realpath. JSON request must match its successful current authorization; namespace1 is session-local, not globally reusable. JSON read budget counts attempted input including failed parse; at most32 distinct successful guest roots,1MiB aggregate JSON input. The provider retains parsed values inside the guest and ensures cache identity; the command never manufactures identity through host-object reuse.

NodeHostResponse all own fields: sequence, kind(void/text/fsError/unsupported/denied),text:string|null,error:NodeGuestError|null,cacheKey:{namespace:1,path:string}|null. void has null text/error/key; text has string and no error, optional key only JSON; fsError/unsupported/denied has error and null text/key. NodeGuestError all own fields: name,message,code:string; errno:number|null; path,syscall,dest:string|null. Each error string <=1024 bytes; total metadata <=8192. Genuine FsError optional own undefined/absent is normalized to null; nontransported stack ignored unread. No Proxy/getter invocation or arbitrary error serialization. FS classification is only on context.fs call rejection; source errors remain raw before guest. A denied grant uses ERR_VNODE_DENIED, unlisted form ERR_VNODE_UNSUPPORTED. A granted provider EROFS stays EROFS. No access-probe-before-write or check-then-exclusive-create.

The command retains the actual typed FS rejection until delivered(sequence); an undelivered error rethrows its original raw reason even if the provider reports entryReturned or no terminal. Other operation rejections are escaping raw failures and cannot be acknowledged into success. Each operation holds its owned source/payload/result buffers until actual settlement and guest delivery/retirement. Completed writes are never rolled back. Closed output stops this invocation only; prior committed filesystem effects remain.

## Source and builtin admission

A complete bounded module-owned lexical/recursive grammar validates the whole source before provider start. It recognizes the exact CONTRACT grammar, with parser nesting bound128 and total work bounded by256KiB source plus fixed token work. Every guest identifier decoded before reserved __vnode transport-name checks. Unlisted syntax and literal direct require targets refuse before any guest effect. No private engine parser import. Provider still enforces value kinds, unlisted intrinsic members, dense arrays, primitive coercion and same-session guest values; syntax admission does not certify arbitrary-source containment.

Interpreted builtin construction may be shared through an exported Node-local program builder but NEVER installs native host eval. Exact supported fs overloads are validated before request. The private transport is not a guest parameter or accessible identifier; no module/exports/CommonJS local JavaScript loader. The production module is useful through an explicitly qualifying provider, not a claim that every arbitrary engine implements the contract.

## Lifecycle ordering

The command registers its single idempotent cleanup before source/stdio/provider acquisition. Source/grant/CLI errors admit no provider. Parent pending work is enrolled before producer invocation, including synchronous throws. On normal terminal, close admission/timer, request provider retirement, join actual parent work and preserve undelivered FS errors. On failure, save explicit raw presence, close admission, wake/cancel provider, retire and drain; cleanup errors remain secondary unless no higher-priority reason. Existing context.signal actual reason wins on settlement. Local typed usage/private cap outcomes map2, guest failure1, entryReturned0 only after cleanup. Source adapter failures and shared ShellLimitError are never converted into usage by shape. Borrowed stdin is pulled only after required grants, copied before producer advance, not arbitrarily returned/disposed. Source selection consumes fd0 once; later guest fd0 returns empty. No automatic reentry or retry.

## Validation remains unrun

This seal fixes interface and decisions before tests. Exact executable fixture/tool/build/package/load/Worker/capture inputs and planned counts must be sealed separately before the one authorized author-validation dispatch. Original feasibility cases remain historical, not module passes.
