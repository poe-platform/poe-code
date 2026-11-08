# Expr76 public author binding

This is the author handoff, not Meitner's independent acceptance. The independent
freeze is f8b982f09e51b9a0a073b0b7bb393cb54796dd62; its files are unchanged.
PRE-WIRING.json authenticates Git absence at that freeze and at the clean
pre-wiring revision200237e95f41ece9c2e639eb4e9c2a51dbb55345. It also binds the
literal accepted DU75 names at0895de2dc63014989f23912c3d48f7c4d0d35a47 and all nine
engine/shared-regex TypeScript files to acceptedc3e40f8b. This is inspected
pre-wiring absence, not an executed expected-red baseline.

## Public declarations and authority

- Root and explicit `virtual-bash/commands/expr` export `createExprCommand`,
  `createExprCommands`, `exprCommands`, `ExprCommandsOptions` and `ExprLimits`.
  The command factories take optional ExprCommandsOptions and return respectively
  CommandDefinition and readonly CommandDefinition[]; the plugin returns
  VirtualShellPlugin. Root and subpath share runtime factory identity.
- `AgentCommandsOptions.expr?: Omit<ExprCommandsOptions, "replace" | "regex">`.
  Aggregate construction reads only expr.limits. Global regex settings win;
  unknown runtime nested expr.regex is ignored, including when global regex is
  absent. There is no promotion of nested regex into an ambient default.
  Direct factories continue to accept their own regex and replacement options.
- Top-level replacement remains authoritative and collision preflight remains
  atomic. The exact literal inventory is DU75 plus expr,76 unique default plugin
  names. Getopts is a builtin outside that list; curl and SafeJS remain opt-in.
- Integration source is a1c95fc52ddeef2d753950b09dd2a26b44b4ab6e. Only root barrel,
  aggregate, package export and availability documentation change. No expr or
  regex engine TypeScript source, guard, quota or owned-output contract changes.
- This is the accepted restricted expression profile, not full GNU/POSIX parity.
  Nullable-repetition capture-reference guard, locale/collation restrictions and
  separate fixed emergency diagnostic remain. TEMP history work is not promoted.

## Worker observer protocols R25 and R26

observer.mjs installs its Worker subclass and syncs builtin exports before product
imports. It records the original shipped constructor URL/hash/resource limits,
actual worker URL/hash, online/ready/request/exit/terminate events and actual
worker module-load hashes. Test-only worker loader hooks are appended to the
product's original execArgv, and stderr receipts are captured. No product reply
is synthesized, no worker is manually terminated by the observer, and successful
children exit naturally. This hook is a trusted test observer, not a product API.

R25 uses the frozen50ms startup/1000ms request/maxWorkers1 configuration and actual
Shell.exec("expr abc : a"). Its disclosed constructor substitution launches the
authenticated silent-worker.mjs, which comes online and listens without a ready
handshake or CPU spin. Require zero ready messages/requests, status3, empty stdout,
an expr diagnostic and product retirement before public settlement. The paired
ordinary shipped worker produces exact1LF/status0. No deadline increase/retry
turns an unavailable observation into a pass.

R26 uses one real direct factory/maxWorkers2 and two independently signalled
contexts. Both real requests complete inside their workers, but the observer
holds their genuine reply events at the main-thread transport boundary. At that
boundary both invocation promises remain live. Abort the first with the unique
EACCES-shaped reason; require identical rejection, product retirement and
idempotent shared cleanup completion while the sibling remains live/unaborted.
Release only the sibling's unchanged real reply; it produces exact1LF/status0
and retires its worker. A separate actual Shell exec/dispose case uses the same
held-reply boundary and requires caller reason identity plus retirement before
both public settlements. This proves cancellation of admitted pending work, not
that the worker CPU was still computing when cancellation arrived.

Per-case observer begin/end records actual creation/request counts and resource
settings. Ordinary workers must load shipped worker.js, protocol.js, matching.js
and expr/bre-worker.js from the same authenticated installed package. A separate
positive/missing-worker-entry control verifies real package layout dependence.
These observations supply a concrete binding for the two frozen protocols; the
reviewer must still run and judge its unchanged26-case cohort independently.

## Lifecycle and errors

Expr is argv-only and must not acquire stdin. Existing withRegexSession registers
cooperative cleanup before worker admission. Cleanup-registration failure admits
no resource; caller abort, output sink rejection and registration failure retain
their exact existing identities. Repeated close shares completion. No implicit
ownedOutput adoption, pre-first-write cancellation, opaque-host preemption or
stronger whole-context promise is added. Evaluation errors use existing stderr
behavior and limits, including the separate fixed emergency diagnostic.

## Package and scope qualifications

verify-public.mjs builds a fresh committed regular-file selection, npm-packs the
complete package, checks installed and physically moved root/subpath consumers
under authenticated Node22.22.2 and24.11.1, and preserves permission fences.
Strict declarations resolve only to that package; six invalid type controls,
missing runtime/export/type controls and source-read denial remain distinct.
Protected source/emitted/installed inventories detect additions as well as
changes/removals; no canonical fixture writes captured evidence.

The author12 public cases and74 source tests are not the independent26 cases.
Supervision180s/64MiB per command is a failed-experiment bound, not an expr limit
or the independent fixture's narrower scheduling policy. No whole-suite/typecheck
gate, native parity, performance, private SafeJS or full release is claimed.

Relative to immutable DU75, the complete candidate also contains the separately
authored private shell/cancellation.ts update. It is disclosed, not approved by
this expr integration; recorded main-thread load receipts determine whether it
was loaded. No TEMP regex, untracked which command or moving-worktree source is
overlaid. The complete source/package inventory in the receipt is authoritative.
