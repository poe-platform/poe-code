# Early independent continuation findings

Baseline freeze `471f4ca`, consumed HEAD `329eb2722052e8ace0ec18a751f12c30ed87a25b`.
No dynamic continuation replay yet. This callpath is read from frozen source;
the concrete observed reproduction is immutable production-review final evidence.

## F1: existing public contract does not express the required barrier

Public reproduction: construct `new Shell({fs: new MemoryFileSystem()})`,
`.use(agentCommands())`, then
`await shell.exec("grep -E '^a' | head -n 1", {stdin: 'ab\n'.repeat(200)})`.
Observe exact native Worker exit/termination through a test-only subclass before
importing the compiled public module. Expected stdout `ab\n`, status 0, stderr
empty AND zero pending owned Workers at exec settlement. Prior final evidence
records one pending termination even after `await shell.dispose()`; exact child
eventually exits. This is premature settlement, not an indefinite leak.

Frozen path: `grep.ts:28` opens a session; `grep.ts:86` awaits close in finally.
`search/rg.ts:130` opens and `:165` awaits close in finally. Runtime dispatch
awaits definition at `shell/runtime.ts:858` but the middleware execution is
wrapped by `interruptible(execute(context), signal)` at `:870`. `interruptible`
at `:100–111` races the promise against abort and observes rejection without
waiting for the original promise. Pipeline stage has another race at `:345`,
pipeline aggregate at `:371`, public Shell execution at `shell/shell.ts:107`.
Upstream abort on downstream close can therefore settle those outer promises
before the definition's asynchronous finally finishes. Await inside a losing
promise's finally does not make the race winner await it.

`CommandContext` contains signal/invoke but no cleanup registration/barrier;
`CommandDefinition` has name/description/execute only. `VirtualShellPlugin.dispose`
is plugin-wide and runs only when the host invokes Shell.dispose. It cannot
retroactively delay an already resolved exec. Definitions' existing finally
blocks are necessary but insufficient. Removing all races or awaiting all
handler promises would hang on uncooperative user host code: not an acceptable fix.

## Minimal typed proposal — NOT implemented, requires owner approval

```ts
export type InvocationCleanup = () => Promise<void>;

export interface CommandContext {
  readonly registerCleanup?: (cleanup: InvocationCleanup) => void;
}
```

Refined to match the author's minimal spelling after reading the preliminary
API note; no extra exposed scope object is needed. Only additive context
capability is proposed. Shell supplies it; direct/custom
hosts may omit it and retain definition-finally behavior. The owner may select
a different name. No runtime method is exposed and no command receives drain
authority. Each actual dispatch gets a distinct registration scope, with parent
exec tracking nested invoke/pipeline/substitution scopes. Register idempotent
owned-resource cleanup synchronously before first suspension/acquisition (or a
closure over an initially absent resource before acquisition). Close admissions
when dispatch is interrupted/settled; reject late registration and never acquire
a resource after closed scope. Normal command finally and host drain share the
same cleanup promise; cleanup is once-only and awaited before public exec settles.
The outer exec drain must itself sit outside cancellation races: racing that
drain against the already-aborted signal would recreate F1. Scope closure must
prevent late continuation from acquiring more resources, not merely reject a
late callback after acquisition. A parent cannot forget a child's registered
drain just because its command/middleware promise lost a race.

Proposal history: the earlier scope-object draft is preserved unchanged at
August 27, 2026 commit `ab05eb9` in this same document. It is historical only,
not a second active proposal. Root reconciled on registerCleanup in its notes.

Drain registered cooperative resource terminators only, not handler completion,
arbitrary middleware, input iterators, sinks or host FS promises. Commands must
stop resource creation on abort; late handler rejections remain observed. A
registrant that supplies a nonsettling cleanup violates the cooperative contract;
this API cannot force arbitrary JavaScript promises to settle. Worker retirement
is concrete bounded-by-termination owned work, not an all-host-work wait.

Error precedence proposal: preserve original caller abort reason by identity;
otherwise preserve original execution rejection; otherwise reject cleanup error
(AggregateError for multiple failures). Do not let cleanup replace primary error
or silently turn failed retirement into success. Secondary cleanup errors must
be observed/retained by the drain, without modifying the primary thrown value.
On downstream-close success,
drain still runs before returning pipeline's selected exit status. Drain all
registered cleanups even if one rejects. Plugin-wide disposal is separate and
must not cancel unrelated concurrent invocation scopes.

Exact path correction for author's preliminary note: `src/shell/shell.ts`, not
`src/shell.ts`; the public race specifically wraps `runtime.runUnit` at line 107.
Shell.dispose would additionally await outstanding registered drains, not all
handler promises, so disposal cannot become a backdoor uncooperative-host wait.

## Construction and host glob observations

RegexExecutor construction only validates policy/stores options. Native Worker
construction occurs lazily in Slot when a request is admitted, not plugin setup.
`open` checks abort/disposed then increments sessions; grep/rg currently call open
just outside try. No Worker is created by open, but placing resource acquisition
under protected ownership would make that invariant explicit. Grep pattern-file
reads happen before session creation; rg preabort check precedes open; invalid rg
arguments are inside finally. A constructor failure in native Worker itself
cannot provide a Worker handle to retire; partial postconstruction setup must be
owned by a protected path. These are source observations, not newly run controls.

`search/glob.ts` creates native RegExp from filename globs and invokes `.test`
on host; `walk.ts` synchronously calls these for CLI globs and ignore rules.
This untrusted filename path is still outside worker content matching at freeze.
Latest root notes assign its narrow correction to author. No reviewer source fix.

Risk budget remains 0; all six additional probes UNUSED, old twelve untouched.
