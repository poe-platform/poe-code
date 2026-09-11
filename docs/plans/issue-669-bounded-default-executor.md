# Issue 669: reuse the bounded default executor

## Validated finding — September 8, 2026

The reported absence of a built-in portable provider does not describe the
current backend. `createBoundedRegexProvider()` already exists in
`packages/safe-bash/src/commands/regex-execution/bounded-provider.ts`; all its
options are optional. Its existing tests cover bounded matching, resource
admission, copied request ownership, cancellation, retirement, and explicit
unsupported expression matching. No new executor or backend rewrite is needed.

The remaining API request belongs to default preset and entry-point integration:
select this provider when none is injected, retain the injected-provider contract,
and remove eager host-specific dependencies from the default import graph.
The root integration owner controls those changes and public-runtime acceptance.

## Bounded implementation and dialect tradeoff

- The provider reuses `EreLedger`, `compileEre`, and `matchEre` directly. The
  separate ERE wire engine uses a different validated transport protocol and is
  not needed to construct this provider.
- Compiler, matcher, and literal preprocessing/search charge work and allocation
  budgets and cooperate with cancellation at checkpoints. Input/pattern/row/result
  admission and state limits remain unchanged. Literal search uses bounded KMP,
  not native `RegExp`. Executor startup/request deadlines are additional controls,
  not the only defense against unbounded native matching.
- Defaults remain two endpoints, 32 patterns, 8192 pattern bytes, 128 rows,
  65536 input bytes, 2048 result bytes, 2000000 work units, 1000000 allocation
  units, and 65536 states per provider/request as applicable. Options retain
  their existing finite ceilings; executor worker-memory options do not turn a
  cooperative provider into an RSS sandbox.
- Supported regex selection is non-NUL ASCII ERE and an explicitly restricted
  grep BRE subset. Fixed grep/rg selection supports validated non-NUL UTF-8
  literals with original byte offsets. Current exclusions include case folding,
  word selection, all-match enumeration, nonfixed rg, and glob descriptors.
  `expr-match` returns the protocol's explicit `unsupported` category. Commands
  such as sed/awk inherit restrictions through their actual descriptors; merely
  registering a command does not establish full mode compatibility.
- This is cooperative, metered execution on a trusted JavaScript host, not
  hostile-host-JavaScript isolation, arbitrary host callback preemption, or a
  native worker's memory boundary. No networking, filesystem, or native command
  capability is enabled by selecting the provider.

## API and lifetime integration

Use the existing provider factory, not a second backend. The proposed common
preset default is equivalent to supplying `createBoundedRegexProvider()` through
the current provider option. The exact public export/version transition remains
root-owned. An explicit injected provider must win consistently for all command
families, including expr and grep aliases.

Each `RegexExecutor` owns the endpoints it creates, not the provider factory.
Session close drains its admitted work; last-session close retires idle endpoints.
Executor disposal closes admission, rejects queued/active work, and awaits its
endpoints' termination. Cooperative endpoint termination shares one promise,
aborts its private signal, drains tasks, clears listeners, and returns capacity
to the factory. There is no provider-level disposal hook to call. Disposing one
executor must not invalidate a sibling executor or a caller-shared provider.
Factory endpoint capacity is shared across its executors; concurrent consumers
must fit the configured cap, and admission must not silently raise that cap.

Changing a Node-default preset to this restricted dialect is an observable
semantic compatibility change even with the same command inventory. Root must
provide the explicit Node opt-in and compatibility/versioning decision; retaining
the existing portable alias does not alone eliminate that migration requirement.

## Host-only explicit Node factory

The separately authorized Node API addition is
`createNodeRegexProvider(): BoundedRegexProvider` in `regex-execution/client.ts`.
It factors the existing worker construction unchanged: the same source/dist
worker URL, empty `execArgv`, and executor-supplied old-generation/stack limits.
The existing Node `RegexExecutor(options)` now passes this factory to its portable
base class; its options, native matching behavior, and endpoint ownership remain
unchanged. It does not alter preset pool composition or defaults.

The factory exposes explicit injection into a portable executor/preset without
forcing a new transport implementation. It must be exported only from root's
host-specific Node entry, never the portable/default import graph. Its native
worker behavior is distinct from the cooperative bounded provider: native regex
execution is terminated through the existing worker deadline policy, not moved
onto the caller's JavaScript thread. No provider-wide disposal is introduced.

## Focused validation and ownership

The executor leaf changes this document, `regex-execution/client.ts`, and two
new tests under `packages/safe-bash/tests/commands/regex-execution/`:
`default-provider.test.ts` and `node-provider.test.ts`.
No bounded-backend fix is justified by the inspected evidence. Its new controls
are GREEN characterization, not a fabricated RED claim. They cover
shared-provider disposal isolation, active deadline retirement/capacity reuse,
falsey queued cancellation, and bounded matching without native RegExp or Node
immediate scheduling. Existing bounded-provider tests retain dialect, expr,
input/result/work/allocation, snapshot, and active-cancellation coverage.

The new Node factory followed RED/GREEN: all three new Node tests failed against
the original client (`createNodeRegexProvider` was undefined), then passed after
factoring the existing implementation. They exercise real worker memory/stack
policy, implicit and injected Node regex/expr semantics, native-regex deadline
termination, and caller-owned factory reuse.

On September 8, 2026, the Node v22.22.0 toolchain selected through
`/tmp/kamilio-toolchain.path` passed the following focused node:test invocation
from `packages/safe-bash` (five test files, exit 0, approximately 1.74 seconds):

```sh
PATH="$(cat /tmp/kamilio-toolchain.path)/bin:$PATH" node --import tsx --test --test-concurrency=1 \
  tests/commands/regex-execution/bounded-provider.test.ts \
  tests/commands/regex-execution/default-provider.test.ts \
  tests/commands/regex-execution/node-provider.test.ts \
  tests/commands/regex-execution/provider.test.ts \
  tests/commands/regex-execution/executor.test.ts
```

The native-worker tests use the existing built worker artifact; they do not
replace root's fresh build/public-entry acceptance. Tests create no disk fixtures.

Root owns registration of both new tests in `scripts/integration-inputs.test.mjs`,
default/alias injection controls, package exports and host-specific entry points,
lint, build/typecheck, full tests, actual workerd/browser/Node/Bun acceptance,
compatibility communication, and Git/release operations. Leaf checks do not
establish those acceptance gates.
