# Restricted synchronous Node module contract v1

Status: Accepted implementation target under ROOT's2026-08-29 module-only GO; not product/provider/default acceptance.

Implemented Through: Not applicable. No production Node module existed at inspected baseline83888110998816ce168d184a38f7419beeb7888f.

Purpose: Implement the explicitly injected NP1-CJS/Worker-L synchronous command without host fallback or shared-core changes.

## Authority and boundary

ROOT's current GO and reviewer1bd9948bd7ed6ece209b38f694adfce0547220f3 supersede feasibility HOLD only for implementation. Original NP1 whole-guest8MiB/Q and all historical failure records remain unchanged. Governing CLI/grant/UTF8/facade details are np1-cjs-v1/CONTRACT.md with Worker D1–D3 overrides, and Promise constructor explicitly unsupported. This module MUST NOT register itself, add root exports/default entries, vendor the engine, add dependencies, or spawn a host subprocess.

The module MUST require an explicit TRUSTED NodeRuntimeProvider. A provider label is not qualification. A production Worker reference provider MAY use only a static module-owned Worker entry plus an explicitly supplied trusted engine-adapter entry. Guest text is interpreted only; it MUST NOT be native eval/Function/module code. Native Worker/SAB/ports/fs/process and adapter functions MUST NOT be guest values. Engine/public source archives are test dependencies only.

## Node-local API

createNodeCommand(options: NodeCommandOptions): CommandDefinition creates one unregistered command named node. Options are an exact own-data record with required provider and optional grants; explicit undefined is invalid. No provider-absence stub exists. No new CommandContext/ShellLimits/Budget/public root interface is introduced.

NodeRuntimeProvider is an exact trusted capability record: profile literal NP1-CJS-WRQ-L-SYNC-1, bounded identity string, and prepare(request, services): NodeSession. prepare MUST be synchronous and inert: no Worker, VFS pull, timer, output or other resource acquisition. NodeSession owns start(): Promise<NodeCompletion>, cancel(reason: NodeReason): void, and retire(): Promise<NodeRetirement>. Methods are detached trusted callbacks. start is once-only; retire is one idempotent shared completion. A completion is provisional until actual retirement AND enrolled parent jobs settle. Retirement distinguishes proved-no-acquisition from observed Worker exit; unknown acquisition/exit is never clean.

NodeSourceRequest contains profile, selector(eval/print/file/stdin), owned admitted program/source, logical filename, virtual cwd, bounded argv and env data, explicit grants and fixed limits. No raw CommandContext/FileSystem crosses to a guest/Worker. Each invocation owns a new source/session/cache/ledger. Host services provide only the exact finite NodeHostRequest union and a local signal. Requests are serialized, sequence-bound, finite own-data records; unknown fields/types/accessors/proxies refuse before effects. Caller reasons stay parent-side with explicit present/value, never inferred from equality.

## CLI and source admission

Preserve prefix -e/--eval/--eval=, -p/--print/--print=, --input-type commonjs or --input-type=commonjs. No attached short options/clusters or invented flags. Selector next operands are literal, including empty/dash-leading values. Conflicting selectors, missing operands and unknown prefix flags return2 without pulling stdin or creating a session. After the first argument-tail token all tokens are literal. File selection ends parsing. --/no operands/- select stdin source; no REPL. Input-type with a file refuses. Only .cjs source files qualify; unsupported suffixes/trailing slash refuse before VFS lookup. No package metadata or local executable-module search.

Eval empty source is valid. Print requires exactly one expression and only primitive String conversion plus LF; objects/functions/Promises refuse without inspection/coercion. argv starts /virtual/bin/node; file adds absolute virtual filename, stdin adds -, eval/print add no fabricated filename. __filename/__dirname exist only for file sources. There is no module/exports API, process.exit or modeled exitCode status override.

Source-file access requires sourceRead. Preserve the original stricter stdin-source rule: sourceRead AND stdinRead; inline source needs neither. This record does not interpret 'already provided source' as authority to pull an ungranted stream. Source stdin consumes through EOF once; later fd0 returns empty. Eval/file stdin is one-shot data, with no replay/implicit root iterator disposal. Retained fragments MUST be copied before requesting the next. Failed/cancelled admission retires local pull admission and awaits admitted pulls; no uncooperative-producer cleanup-time guarantee.

Complete-source grammar preflight MUST precede guest execution/effects; regex-only filtering is insufficient. Preserve the closed NP1 grammar and deferred syntax. Literal unsupported require targets refuse in preflight; computed targets refuse at that call after any earlier effects. Private transport identifiers/scopes MUST be inaccessible from user source. Source text MUST never enter native execution. Promise constructor is unsupported; qualified statics/race([]) are not an all-jobs guarantee.

UTF8 decoding follows the original replacement policy, counts bytes before decode and handles split sequences. Strip exactly one leading BOM from source and JSON modules only. Ordinary data retains BOM. Lone UTF16 surrogates encode as replacement. No shebang, binary buffers, ESM/TLA/.js, asyncfs, npm/npx or local JS module execution.

## Facades, VFS and grants

Grants are an exact finite own-data record of optional boolean sourceRead/dataRead/dataWrite/jsonModules/stdinRead/stdoutWrite/stderrWrite. Omitted/empty denies everything; explicit undefined/accessors/extras refuse. Grants bind the supplied virtual filesystem namespace, never ambient host paths. SourceRead does not imply dataRead. Writes default DENY. Granted readonly providers retain actual EROFS; unsupported exclusive creation retains ENOTSUP without check-then-write mutation.

Only fs, path, process and node: aliases plus explicit relative/absolute .json require forms exist; fs/promises and fs.promises are excluded. JSON modules require jsonModules AND dataRead, resolve from the immutable entry directory (or cwd for inline/stdin), authorize freshly even on cache hits, preserve same-session canonical-key identity, never cache failures or invalidate on subsequent writes. At most32 successful JSON roots/1MiB cumulative JSON input; guest-owned parsed values are not host-object identity claims.

Synchronous text overloads and POSIX path/process/console inventory remain exactly the NP1 table, excluding promise-fs/modeled exit. readFileSync requires explicit utf8 options; writeFileSync supports string or finite options, default w, actual exclusive wx. Arity/type/encoding/flag failures are catchable ERR_VNODE_UNSUPPORTED before host acquisition. No Promise may replace a synchronous return. process.argv/env mutations are guest-local data; native launch env is never copied from them. Primitive-only console formatting includes newline in byte admission.

Actual parent services MUST adapt context.fs/stdin/stdout/stderr, not the feasibility Map. Every request validates full metadata/options/grants and reserves all retained buffers before any effect. Writes/output receive the complete bounded body before effects. Fresh JSON authorization precedes cache lookup. FsError classification is only inside an authenticated FS operation and preserves bounded own code/errno/path/syscall/dest; optional absent/own undefined fields omit in guest. Ignore nontransported stack accessors without reading them. Arbitrary sink/control/errors MUST NOT become typed FS errors.

## Lifecycle, failures and diagnostics

Register the same invocation cleanup synchronously BEFORE preparation/start/ownership acquisition, with finally fallback for direct hosts. Source/stdio/VFS jobs are enrolled before invoking producers. start/rollback/cancel/retire coordinate actual Worker exit/proved-none with all parent job settlements. Cancel closes admission, wakes blocked Sync and requests termination immediately; no grace, retry or sibling/root cancellation. Normal entry cutoff closes the5s admission timer, does not abort preadmitted work, and permits no new guest effects. Explicitly abandoned/unobserved language continuations are not called settled.

Preserve caller signal reason first, then first escaping execution/control/sink failure, then cleanup-only failure, then numeric result. Explicit presence preserves undefined/falsy values. Retain secondary cleanup faults without replacing primary. Numeric0(entryReturned),1(guest failure),2(private profile/usage failure) is returned only after retirement and parent cleanup. Shared Shell budget/owned-output errors retain existing raw identity/mapping, never reset counters or become usage errors. Root stdin is borrowed; no arbitrary iterator return/disposal. Destination closure is local, not permission to abort caller or sibling work.

Failure observation uses bounded precharged own-data fields only, no getters/proxies/coercion/arbitrary serialization. Production publication MUST propagate its explicit success/fault-presence receipt to the observer owner; absent observation is UNKNOWN, never inferred success. Capture failures cannot mask actual guest/control/sink/cleanup outcomes. Raw identity and serialized diagnostics are separate. Diagnostic writes obey stderr grant and shared output/budget ownership.

## Fixed resource profile

16MiB logical command-owned ledger, fixed197056-byte SAB, V8 old32/young8/code8/stack4MiB,5s ADMISSION from ownership enrollment. No5s completion/cleanup, RSS or wholeguest8MiB claim. Preserve256KiB combined trusted interpreted+user source,64KiB context,1024-byte paths,8192-byte metadata,1024-byte error fields,128 operations,4096 frames,8192 wakes,1MiB per-operation/read-result/output payload and4MiB cumulative read/write. Parent diagnostic reserve1MiB. Precharge before copy/encoding/allocating, retain credit until owned references retire; no counter reset or byte-as-Shell-command charge. Host-producer/engine native allocations are not silently charged0 or claimed bounded by this ledger.

## Frozen validation obligations

CLI/selector/no-pull/entry argv; complete grammar and unsupported preflight; UTF8/BOM/source/context bounds; real VFS Memory/owned Real/readonly/mock behavior; missing grants versus EROFS/wx; JSON identity/alias/reauthorization/write cache; stdout/stderr ownership/backpressure; borrowed stdin; caller/falsy/limit/sink/cleanup identity; inert preparation/acquisition rollback/unknown exit; separate sessions; diagnostic publication faults; no host globals/private transport; strict positive/negative Node-local API types; actual loaded negative/mutant controls and restoration; source/installed/moved internal consumers. Real Worker/public engine qualification is separate from DATA/provider stubs. Exact finite tool/source/archive/package/load/capture recipes and cumulative Worker/guest counts MUST be committed before activation.

## Conformance and current gaps

Implementation is accepted only after source, types, actual provider/Worker, real adapters, lifecycle and built/moved evidence are independently reviewed. There is no default/public/root registration, upstream license grant, arbitrary-source containment certificate or full Node claim. Existing11 cross-version qualifier identities and older HOLDs remain historical; this module must not overwrite or merge their counts.
