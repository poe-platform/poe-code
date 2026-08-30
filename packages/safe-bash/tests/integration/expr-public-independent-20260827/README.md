# Expr76 public integration expectation freeze — August 27, 2026

**NOT candidate validation. Runtime, TypeScript, build, package, worker and native
cases NOT EXECUTED.** This is a post-module, intended pre-Curie-public-wiring
freeze. Root assigned this leaf only this new directory; no subdelegation.
Expectations are independent of candidate execution, **not independent of module
knowledge**. The accepted module index/README and public-profile handoff were read.
No engine internals were audited. No product was imported or run.

## Authority and chronology

- Initial restricted product: `c3e40f8bd721da5e496f3b3abfd51aee45db5a84`
  (2026-08-27 15:52:22 -05:00); accepted evidence:
  `c14363bd191042d42defc8498c4d084cf9411375` (16:49:51 -05:00).
- Handoff: `b158d1e5732642e1386110db70fcc0cc2c4c6e20`
  (committed 16:56:21 -05:00). Its profile explicitly holds root/subpath/default
  wiring. The index blob is identical at all three revisions. README blobs differ
  between initial and accepted; both are authenticated in `provenance.json`.
- Initial observed HEAD: `a995616a48ccc3d712f2fec4f68f7a8b639086f3`.
  A narrow public-wiring history read encountered DU75 wiring commit
  `b2b4604f09f351d8130c0f2a3349e85f4b4c45e1` (17:43:20 -05:00), **not an
  accepted-baseline certification**. Only its aggregate registration delta was
  inspected; no DU/HTML implementation, admission, TAP, or gate was investigated.
- No Curie expr wiring was encountered in the immutable profiles/conventions
  inspected. This does not certify that concurrent HEAD remained unwired until
  this freeze commit. Root's held-wiring statement is the chronology premise;
  later admission must record actual freeze/candidate ancestry and times.

`provenance.json` records full Git commits, blob IDs, SHA-256 and lengths for
the exact profile/convention objects consulted. Handoff statements about engine
behavior are used as declared public profile, not independently re-audited proof.
No copied engine source, large TS snapshots, old captures, or dependencies.

## Frozen public policy

Package remains `virtual-bash`. Root and `virtual-bash/commands/expr` must expose
`createExprCommand`, `createExprCommands`, `exprCommands`, `ExprCommandsOptions`,
and `ExprLimits`. The proposed public subpath follows the already explicit
`./commands/column` and `./commands/grep-aliases` exports convention: `types` to
`./dist/commands/expr/index.d.ts`, `import` to `./dist/commands/expr/index.js`.
It is a frozen integration expectation, **not an existing accepted-module export**.

`AgentCommandsOptions.expr?: Omit<ExprCommandsOptions, "replace" | "regex">`.
Existing aggregate top-level `regex` and `replace` are authoritative; unknown
runtime nested `expr.regex` must not override even an omitted top-level regex.
Direct factories retain their own `regex`/`replace`. Custom definitions remain
usable via explicit registry replacement. No implicit optional curl/SafeJS.

Exact inventory requirement: **DU75 plus expr = 76 unique default names** through
both aggregate factories. `getopts` is a shell builtin, not counted as a registry
command. `cases.json` carries the 70 names from immutable aliases/column fixture
data, its three additions, and the public HTML/DU wiring names. This is the
explicit proposed 75-name binding, **not a claim that the supplied commits settle
the accepted DU75 revision**. Root must bind and authenticate the actual accepted
DU75 list before candidate execution, compare it byte-for-byte after sorting,
and resolve any difference openly without silently editing this freeze. Do not
infer acceptance from a commit subject or use actual candidate output as oracle.

The strict profile includes C/POSIX bytes, C.UTF-8/C.utf8 scalars, qualified
en_US.UTF-8 character encoding only, named collation refusal, nonbaseline bracket
refusal, escaped-bracket admission and the declared nullable-repeat guard.
No GNU/Linux, universal GNU parity, superiority, or full regex claim is made.
Statuses 0/1/2/3 and the exact emergency output-quota diagnostic are frozen.
Other error cases require empty stdout, explicit status and one human-readable
`expr:` diagnostic line: the profile does not pin their full wording. This does
not relax any existing canonical diagnostic assertion. Compare raw bytes for
split UTF-8, not decoded terminal strings.

## Fixture inventory and use

- **26 runtime case IDs** R01–R26; R21 and R22 each have one additional input
  variant within their case. 24 have reusable consumer implementations; R25/R26
  are concrete lifecycle protocols awaiting qualified worker observation binding.
- **1 positive strict TS fixture**, including four exact type assertions and all
  twelve ExprLimits/eight RegexExecutionOptions fields; **6 negative directives**
  in one negative fixture. The `.ts.fixture` suffix follows inspected consumer
  conventions and intentionally avoids current canonical test discovery.
- **8 package/control protocol IDs** P01–P08, not eight implemented or passed
  package tests. Run the runtime cohort in both installed and moved contexts;
  do not inflate the 26-case denominator by counting packaging repetitions.

`consumer.mjs` exports `runPublicCases({root, subpath, binding, observe})`; it does
not import product automatically and is not a full admission runner. The future
host must qualify package/loader/observer controls **before** importing either
public specifier, then supply those real imported namespaces. Booleans passed to
this consumer are not authentication evidence: the host must produce immutable
pre-run records required by `PROTOCOL.md`. The consumer explicitly returns
`fullAcceptance: false` and unresolved R25/R26. An absent observer is a hard error,
never a skip/pass. A diagnostic or lifecycle assertion failure is retained as-is.

Expected pre-wiring public-export/inventory/type failures are baseline **expected
red**, not observed red and not evidence that integration works. Do not install
the physical expr module as a baseline fallback or substitute a local source
import to make these public consumers green.

## Bounded future work and clarification

Only fixture syntax/data self-checks run at freeze. `self-check.mjs` imports no
product, builds nothing, and changes no evidence. Its recorded result is in
`FREEZE-CHECKS.json`. Freeze does not authorize a new giant admission runner.
Root still needs to bind the accepted DU75 revision and a qualified worker
observer/control implementation (including timeout/abort observation boundaries).
No further module audit or speculative admission repair is requested.
