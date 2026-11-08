# Curie → Sagan: exact nested env replacement handoff

## Runtime integrated and bounded replay verified

Sagan committed954f2302e4b2f42f90cb5ffd5670d1936f47390c. Curie's frozen replay
at that revision passes all six unchanged historical rows, including exact
`B=2\n` for the nested leak reproduction. The separate actual-shell gate is
10/10, up from historical2/10; boundary/order/Sagan author cohorts111/111 pass.
Frozen all-source/selected-test typecheck, build and built-package smoke pass.
See six-954f230.json and env-integration-954f230.json. No dirty source included;
no additional core/contract or Sagan runtime edits by Curie. Earlier pending
statements below are historical; independent broad core/env review remains due.

## Current status after root approval

Root approved the additive semantics below. Contract/core forwarding is now
committed84fc742: `src/contracts/command.ts`, `src/contracts/command.md` and
`src/commands/execution.ts`. No shell source/types edit by Curie. The separate
6b81bb3 production ordering fix implements the inspected pinned gnulib rule;
it does not change replacement semantics. Sagan can implement runtime/types now.

Actual-shell `tests/commands/core-env/runtime-acceptance.test.ts` is2/10 pass,
8/10 fail before runtime integration. Omitted/false compatibility passes; true
exact/empty/omitted-env/PWD, actual env clear/unset/prefix chains and local/export
isolation remain required red assertions. Raw evidence is committed alongside.
The boundary/order80 passes are not runtime closure. Replay the unchanged six
historical rows only after committed runtime integration, with a new output
filename; preserve six-d49d9e5.json4/6 and its exact leak bytes.

The following section retains the original proposal and reproduction history;
its “not yet accepted” wording describes the earlier4dfa0c0 handoff, not this
now-approved contract.

August27,2026. Proposed shared-contract change only; not yet implemented or
accepted. Serialize Sagan runtime changes with source/dot/eval work. Curie owns
contracts/core env; Sagan alone owns shell runtime/types. No production edit in
this handoff. Root can route the complete proposal without inspecting the repo.

## Reproduction and observed boundary

Committed source d49d9e523b99b3464b71b06ffbdfe297e0a3cf0f, original frozen
environment PATH=/usr/bin:/bin, HOME=/fixture, LANG=C, LC_ALL=C, TZ=UTC:

```ts
import { Shell, agentCommands, createMemoryFileSystem } from "virtual-bash";
const fs = createMemoryFileSystem();
await fs.mkdir("/fixture");
const shell = new Shell({
  fs, cwd: "/fixture",
  env: { PATH: "/usr/bin:/bin", HOME: "/fixture", LANG: "C", LC_ALL: "C", TZ: "UTC" },
}).use(agentCommands());
try {
  const result = await shell.exec("env -i A=1 B=2 env -u A");
  console.log(JSON.stringify({ stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode }));
} finally { await shell.dispose(); }
```

Expected stdout `"B=2\n"`, stderr `""`, exit0. Exact current stdout:

```text
PATH=/usr/bin:/bin
HOME=/fixture
LANG=C
LC_ALL=C
TZ=UTC
PWD=/fixture
B=2
```

There is a trailing newline; stderr empty and exit0. Frozen native bytes and
committed-source replay are in six-d49d9e5.json. This is not an env callback-only
test: the actual Shell invocation restores inherited exports. In contrast,
direct `env -i A=1 B=2` merely differs in output entry order (native B,A; ours A,B)
and remains a separate measured profile discrepancy.

## Minimum additive contract

Add only `readonly replaceEnv?: boolean` to
`CommandInvokeOptions` in `src/contracts/command.ts` (public re-exports unchanged).
Sagan mirrors or extends it in `ShellInvokeOptions` in `src/shell/types.ts`.
The existing optional third argument and all old callers remain source-compatible.

- Absent/false: preserve current merge behavior exactly, including current PWD
  treatment. Do not change xargs/find/directExecutor callers incidentally.
- True: the command's exported environment at invocation entry is a fresh copy
  of exactly `options.env ?? {}`. Do not merge `context.env`, restore cleared
  exports, inject PWD, or promote unexported/local variables into that map.
- `cwd` remains independently resolved and validated. Explicit PWD supplied in
  the replacement map stays a caller-provided environment value; it does not
  control cwd. A subsequently launched Bash interpreter may perform its own
  documented initialization; that is distinct from invoke injecting variables.
- Preserve parent variable values, exported/unexported attributes and function
  locals on success/failure/cancellation. This flag replaces the environment,
  not a new generic shell-state-reset API. Nonexported runtime locals must not
  become inherited environment; child interpreter creation must not import them.
- Literal argv, middleware dispatch, shared command/depth/output budgets,
  cancellation, stdout/stderr transfer and stdin cursor/origin metadata retain
  the existing invocation rules. Do not start another Shell or reset budgets.
- Keep existing key/value/NUL validation before child execution. No optional
  boolean success shim that runtime ignores; contract tests alone do not close
  the bug. No feature detection by peeking at output or EOF.

Current cause is Runtime.invoke merging
`{ ...context.env, ...options.env, PWD: child.cwd }`. Core env already computes
its exact desired child map; directExecutor's invoke closure still captures the
original context. Both the explicit replacement request and runtime branch are
necessary. A core-only callback test currently misses that second boundary.

## Ownership and acceptance sequence

1. Sagan confirms these exact semantics or identifies a concrete export/local
   conflict before changes. Curie then adds the optional field/type tests and
   routes core env through `context.invoke(childName, literalArgs, { env, cwd,
   replaceEnv: true, stdin, stdout, stderr, stdinIsDefault when defined })`.
   If no invoke exists, keep the existing callback/registry fallback. No new
   CommandContext flag and no blanket directExecutor replacement behavior.
2. Sagan implements matching runtime/types and actual-shell tests serialized
   with source/dot work. Coordinate commit order explicitly; do not announce
   fixed until both sides are committed and the unchanged native row passes.
3. Required integrated acceptance: frozen env-unset exact B=2; plain env -u
   really removes a present inherited export; prefix assignments do not survive
   env -i; empty replacement stays empty for an environment-reporting command;
   cwd/-C works without implicit PWD export; public invoke omitted/false keeps
   legacy merge behavior. Tests exercise an actual Shell registry child.
4. Export/local regressions: a nonexported SECRET and an exported PUBLIC must
   not reach `env -i KEEP=value bash -c` as SECRET/PUBLIC; KEEP must. Parent
   values/export flags and function-local bindings survive child completion,
   failures and cancellation. Cover local shadowing and explicit child exports
   without leaking them back. Interpreter-added startup values are not treated
   as an invoke leak; the boundary environment itself must be exact.
5. Preserve stdin metadata, literal argv, one middleware invocation per command,
   cancellation and shared-budget exhaustion in nested env→command pipelines.
   Different-agent verification follows; do not suppress the ordering mismatch
   or rewrite the old224 cohort. No new network/backend/lifecycle API work here.
