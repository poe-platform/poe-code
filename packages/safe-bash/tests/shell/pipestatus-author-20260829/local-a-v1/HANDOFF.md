# Generic local -a: SOURCE/PURE candidate, runtime review pending

Source/preseal commit **ec74e14df6bb7caf6b1be59fd44b027d7240101e**. The only product file changed is `src/shell/runtime.ts`. Exact base is commit `2e6d59787df9d1949d9e342fbd2769cb76240651`, whose runtime bytes are retained and hashed in `SEAL.json`; this names an inspected immutable input, not a claim that arbitrary HEAD is accepted. All other local/foreign runtime suffix and preceding non-local body compared byte-exact in the controls. No parser, BindingStore, ArrayOwner, PIPESTATUS publisher, public API, transport, arithmetic or ERE implementation edit.

## Narrow grammar

`local [-a ...] [--] NAME[=VALUE] ...` accepts leading repeated `-a`, optional `--`, and ordinary identifier/scalar-initializer operands already delivered by the existing command parser. `local -a` without a name refuses2. Other leading flags refuse2 before declaration effects; they are no longer treated as malformed names followed by unintended scalar creation. No `-A`, nameref, readonly flag, flag clusters, declare/typeset or compound-array-in-local syntax was added. Parenthesized array assignment remains a separate existing shell construct, not newly parsed declaration syntax.

`NAME=VALUE` initializes element0 (including empty value). A first indexed local starts empty when no initializer is supplied, saving its outer binding for restoration. Same-frame indexed redeclaration copies/preserves existing members; same-frame scalar-to-indexed conversion retains the scalar as element0 and upgrades the pre-existing saved local to typed restoration. Ordinary plain-local branches remain unchanged after option admission. Generic names and PIPESTATUS use the same new path; there is no PIPESTATUS-specific indexed-local case.

## Ownership and constraints

The implementation reuses `prepareVariable` / typed saved-variable restoration, `BindingStore.watch` and `prepareName`, shared `ArrayOwner` reservations/hold, `IndexedBinding.copy` / admitted text tokens, and `StateMonitor.publish`. Scalar storage is removed only in the atomic indexed publication. Readonly refusal is checked before staging and again before stale-watch refusal; caller signal is checked before final publication. Exported/control-variable conversion remains refused under the existing array policy. Same-frame conversion now enrolls typed restoration of its original outer binding, rather than leaving an indexed local behind on function return. No ledger reset, new cap or allocation refund was added.

This is SOURCE reasoning, not executed ownership/cleanup proof. Full runtime/fault checks must still confirm publication failure atomicity, exact caller/execution/cleanup precedence and restoration, including late staging failures. The new branch follows existing owner cleanup patterns; this phase did not inject private cleanup failures or assert universal preemption.

## Actual controls

**20/20** in `PURE-RESULT.json`: fourteen option-grammar vectors; three exact falsy caller-abort identities (false,0,null); three SOURCE order/provenance checks. The first17 execute the exact new private option-parser function body using recorded type-only signature/non-null erasure and a test-only export. They do not import/execute Runtime, Shell, BindingStore or ArrayOwner. The remaining three are explicitly SOURCE-only, not dynamic binding passes. Two helpers total (source preparation and PURE), one scoped Git source child; no compiler, product Shell, Worker, native oracle, npm or install.

The preseal preparation checked the future R17 script byte-for-byte against the previously authenticated frozen case; **R17 is unchanged**. All six `cases.json` scripts remain UNRUN. Original actual-v2 **75 PASS/3 R17 FAIL**, its raw captures/receipt and prior native P22/P23 qualifications remain unmodified. No full native or command parity is claimed.

## Proposed next bounded phase

After independent SOURCE review: reconstruct an explicitly selected candidate using the accepted307 PIPESTATUS composition plus this runtime-only delta, proving non-local source identity rather than including unrelated current files; one pinned strict build and declaration comparison. Then run unchanged R17 and the five new scalar/ordinary-indexed/nested/redeclaration cases in source-built, installed and physically moved layouts. Keep original artifact/manual-package provenance separate from any newly produced package.

Add fixed host controls for readonly before/after staging, exported/control names, same-frame scalar conversion/restoration, prefix assignments, raw caller abort/cleanup failures, shared-budget exhaustion and no failed-publication mutation. These are proposed obligations, not executed outcomes or permission for additional work. No existing case expectation is relaxed to obtain acceptance; root approval is required before compiler/runtime execution.

## State and accounting

The durable AGENTS rule is a separate documentation commit. Product source was staged/committed only via explicit owned paths; no other production writes. This phase's external captures retain known administrative roles. At final publication the maximum planned actual count is36 known starts including both commits, within the12-minute grant; returned roles and final clock are recorded in `/private/tmp/safe-bash-local-a-publication.stdout`. No managed runtime process remains. Previous administrative/capture qualifications are not backfilled or rescored.
