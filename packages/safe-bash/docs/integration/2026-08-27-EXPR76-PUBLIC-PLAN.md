# Declared expr76 public integration — HOLD, August 27, 2026

This is a source-inspected API/policy and author-candidate plan, **not wiring,
a candidate, public acceptance or an executed76-command inventory**. Root requires
the different reviewer's freeze before integration. Preserve HTML74aff899aa and
DU75 candidate0895de2d; neither is silently rebuilt or recounted as76.

## Inspected API and compatibility

The existing `src/commands/expr/index.ts` exports:

```ts
createExprCommand(options?: ExprCommandsOptions): CommandDefinition;
createExprCommands(options?: ExprCommandsOptions): readonly CommandDefinition[];
exprCommands(options?: ExprCommandsOptions): VirtualShellPlugin;
```

It exports types `ExprCommandsOptions` and `ExprLimits`. Options currently contain
`replace?: boolean`, `limits?: Partial<ExprLimits>` and
`regex?: RegexExecutionOptions`. Plural factory returns only `expr`. No new module
signature, dependency, context field, default resource limit or worker operation
is required. Root and an explicit `virtual-bash/commands/expr` mapping will expose
these same exports after authorization; runtime/type targets will be
`./dist/commands/expr/index.js` and `./dist/commands/expr/index.d.ts`.

Declared aggregate property:

```ts
readonly expr?: Omit<ExprCommandsOptions, "replace" | "regex">;
```

This fits `AgentCommandsOptions`' existing family-local limit options and single
collision-preflight/replacement policy. Existing global `regex` feeds standard
grep and standalone-backed egrep/fgrep definitions; expr will join that route.
This does not silently change rg's separately configured family route or imply
every regex-capable command already uses the global property.

## Runtime authority, including unknown JavaScript fields

| Entry point/configuration | Declared behavior |
| --- | --- |
| Aggregate `regex` supplied | Forward that exact policy to expr; nested `expr.regex` cannot override it |
| Aggregate `regex` omitted | Omit expr's executor option and use its existing executor defaults; nested `expr.regex` still cannot supply a policy |
| Runtime JavaScript adds nested `expr.regex` or `expr.replace` despite the TS omission | Ignore those fields, rather than validate, merge, use or spread them into the factory |
| Aggregate `replace` | Sole registration replacement authority; false/omitted preserves collision preflight before mutation |
| Direct factory/plugin `regex` | Preserve the existing independent option and validation |
| Direct `exprCommands({ replace })` | Preserve its standalone registration policy |

Implementation will explicitly forward the known nested `limits` property, then
conditionally forward global `regex`; it will **not** use a spread that accidentally
retains nested regex when global is undefined. This is a configuration-selection
rule, not a sandbox for hostile host objects or arbitrary accessors. Tests should
include conflicting and invalid nested regex values with/without a global policy,
global invalid-policy rejection, and direct-factory policy controls. No queue cap,
timeout or worker default is reset merely to make those tests pass.

## Accepted restricted profile remains visible

Initial runtime `c3e40f8b`, scoped acceptance `c14363bd`, consolidated handoff
`b158d1e5` are the baseline. Inspection found expr entry SHA-256
`e7cf6a0077a291578f4c669fe41da37188be8cebcb19bdb574838fd7fae2eb8e`,
equal to that accepted revision; no new behavior was executed for this plan.
Read accepted detail at
`tests/commands/expr-stress/initial-profile-closure-20260827/CONSOLIDATED-HANDOFF.md`.

- Keep one bounded invocation budget, async encounter order, worker-only matching,
  exact rejection identity and awaited cooperative worker cleanup.
- Preserve the qualifying nullable-repetition capture-reference guard: marked
  captures under nullable repetition with maximum greater than one cannot be
  backreferenced. This is not a ban on all nullable captures. TEMP history research
  and model patches remain outside production and the integration write-set.
- Preserve named encoding profiles C/POSIX/C.UTF-8/C.utf8/en_US.UTF-8 with their
  documented collation/bracket restrictions; no broad locale/GNU/POSIX claim.
- Normal output/diagnostics use the existing quota; the separate fixed34-byte
  emergency diagnostic remains explicitly disclosed, not called an absolute
  combined output cap, RSS limit or realtime guarantee.
- Expr is argv-driven. Do not promise arbitrary stdin reads, owned-output adoption,
  new cancellation APIs or upstream preemption as part of mechanical wiring.
- Default inventory will be precisely DU75 plus `expr`; curl/SafeJS remain optional,
  getopts remains a builtin. Exact names are verified after the independent freeze,
  not inferred from a count or promoted from TEMP work.

## Bounded author candidate plan after the freeze

1. Authenticate the root-supplied independent freeze and inspect live/root index
   cleanliness and the accepted expr/shared-regex source closure. If production
   differs from the accepted closure, report exact paths/hashes before assembly;
   do not fold TEMP research or another owner's unaccepted behavior into a claim.
2. Change only `src/index.ts`, `src/plugins/index.ts`, the explicit `package.json`
   export entry, root usage docs and the module README's formerly-internal public
   availability paragraph if root includes that doc path. No expr/runtime/worker
   behavior or lock/dependency change is planned.
3. Add focused author fixtures under `tests/plugins/expr-public-author/**` using
   `.ts.fixture` for staged consumers. Test exact76 names; root/subpath identities;
   limits; global regex authority; standalone policies; collision atomicity;
   shell arithmetic/string/BRE, refusal/quotas and VFS pipeline output; caller and
   sink reason identity/cleanup. Worker controls must settle naturally with actual
   source/worker binding, not arbitrary global worker-zero assertions.
4. Migrate only actually affected current75-name fixtures/maintained consumers and
   their exact inventory hashes in a separate commit. Preserve all old75 artifacts
   and independent freezes. Do not churn historical counts to make a suite green.
5. Declare a committed isolated candidate before reviewer execution. Build and
   pack complete package, physically move a regular installed consumer, compile
   strict root/subpath consumers and negative nested-regex/replace types. Observe
   real loaded candidate modules/worker entry; test absent JS/export/declarations
   and source-read denial, no fallback. Bind runtime/tool/package hashes and
   before/after source/emitted/package inventories including unexpected additions.
6. Seal raw scoped results and any failed attempts. Supply exact source/candidate/
   tarball hashes and policy mapping to the different reviewer. No whole gate,
   native rerun, private SafeJS access or current-global-green claim is planned.

Until the freeze is received, **no source/export/default/count-fixture changes**
are authorized or performed for expr76. This declaration alone does not open
reviewer execution or mean a76-command package exists.
