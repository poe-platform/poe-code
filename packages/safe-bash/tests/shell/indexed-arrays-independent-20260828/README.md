# Independent indexed-array design review — August 28, 2026

**Design review only. Feasible direction; not an approved implementation profile.**
The 16 native questions are correctly bound as an unexecuted preseal suitable
for root to name in a later, separate native-only GO. No observation, test pass,
product admission, runtime window, implementation authorization, or new native
semantics result is supplied by this review.

## Exact input boundary

- Original design: `2cb939883a91b495bed7dadb8973cd1939b16e6a`.
- Addendum/native preseal: `abe53e03b654cd576dfa5f8f7a6cf435edc2b4d0`.
- Manifest SHA256:
  `f731d304306b02d11df41b386d4528405ad307ca33098d25f1bc2a0193c0764f`.
- Runtime inspected: accepted CD+LET
  `c26892c3a1a419311c9cf46a6c2976e696e00624`, SHA256
  `eb4588578001136b8ac011c1c458079b0c8a9f07e653938836d342dff052e193`.
- Other selected source: `5137a74ec855a32d8a8860eb66b62eb44d11e290`.
  Accepted CD `4641075df5355a91c83bf5b2cc3a88dfaf1f5153` is carried by that
  accepted LET runtime. The existing 265-input/846-package receipt is provenance,
  **not** a fresh reconstruction, build, full-package review or gate here.

`STATIC-BINDINGS.json` authenticates nine bound design documents, sixteen source
files, all sixteen row hashes, and the available pinned binary/manual using
read/hash operations only. Original design bytes remain unchanged. Metadata
checks are not behavior passes. No current HEAD/STACK source is certified.

## Architecture verdict

The proposal correctly needs a typed internal binding, sparse numeric storage,
real assignment/subscript AST and a shared ownership ledger. A registry command,
JSON value convention or `Record<string,string>` cast cannot implement it.
The scalar command environment must remain a string-only own-key dictionary.

Relevant accepted source, with line numbers at the revisions above:

| Boundary | Inspected mechanism / implication |
| --- | --- |
| `src/shell/parser.ts:6`, `:274`, `:439` | Word/parameter AST and tokenization lack an indexed target. Parse the restricted grammar explicitly; do not rewrite argv or fall back to arithmetic. |
| `src/shell/runtime.ts:160`, `:167`, `:278` | SavedVariable/State and synchronous cloneState are scalar. Arrays need complete kind/attributes/identity ownership, including saved frames and cloned states. |
| `src/shell/runtime.ts:794`, `:817`, `:824` | Writes/unset and arithmetic proxy are synchronous; the proxy currently intercepts writes, not indexed reads. Async ledger work needs explicit plumbing rather than hidden promise setters. |
| `src/shell/runtime.ts:1301`, `:1375`, `:1407` | Prefix assignment, scalar export projection and middleware overlays have distinct effect/restoration paths. All typed-binding mutations must go through checked accessors. |
| `src/shell/runtime.ts:1439`, `:2339` | Function finally restores locals; local declaration saves once and enforces outer readonly. Preserve these policies while replacing scalar snapshots. |
| `src/shell/runtime.ts:1609`, `:2100` | Fresh interpreter state differs from cloned literal invoke. Both remain within the current invocation's shared Budget, even when variable state is fresh. |
| `src/shell/runtime.ts:1935` | scriptFile parses all units before execution. New array grammar must preserve that preflight; no incremental-effects workaround. |
| `src/shell/runtime.ts:2485`, `:2508`, `:2525`, `:2658` | Substitution capture/decode, alternate joins and word buffers already allocate before a later variable setter. Array-only setter charging cannot prove preallocation accounting. |
| `src/shell/shell.ts:162`, `src/shell/cleanup.ts:33` | Each public exec creates a fresh Budget. Explicit owned cleanup can be registered before acquisition and drained; it does not establish ownership of arbitrary retained host values/promises. |

Likely later production touchpoints are parser/runtime, fresh state initialization
in shell.ts, and a private binding/ledger helper. Function display needs review
if new AST shapes reach serialization. This is a planning observation, not a
write grant. No public limits, root exports, default-command count or arithmetic
language expansion is necessary merely to represent arrays. The accepted LET
evaluator can remain synchronous/name-only if indexed access is explicitly
refused at its binding adapter.

## Root direction already settled

**Independent public `Shell.exec` is a fresh accounting boundary.** Within one
invocation, functions, source/eval, subshells, pipelines, substitutions, literal
invoke and interpreter/shebang descendants share the same private ledger,
including descendants with fresh variables. A host calling another public exec
does not silently inherit it. The addendum's cross-exec question is therefore
resolved by root, not a remaining blocker. No global ledger, RSS bound, arbitrary
host-retention bound or hard-preemption promise is requested.

## Decisions and risks before a product freeze

Eight concrete findings are detailed in `FINDINGS.md`:

1. Ratify staged target publication versus the original partial-write proposal;
   specify index-overflow timing and exact error/control classes, especially
   empty or explicitly indexed append at the maximum index.
2. Bound absent-name generations/tombstones and reserve complete restoration
   identities; prevent same-value and unset/recreate ABA without a growing
   uncharged historical-name table.
3. Define consistent snapshots when full-map clone/local-save work now yields;
   existing synchronous clone semantics cannot be assumed automatically.
4. Define expression/staging/output ownership handoffs and all live/transient
   allocations before claiming private preallocation bounds.
5. Reconcile cleanup credits with the summed work schedule and indivisible
   operations; cancellation must not interrupt required restoration.
6. Ratify private-cap status/precedence/recovery and low-cap/overflow behavior.
   The numeric example is coherent but does not validate these mechanisms.
7. Preserve scalar environment, attribute, middleware and listing selections;
   pin side-effect timing for scalar commands that touch indexed bindings.
8. Close the exact restricted grammar/operator boundary, including scalar versus
   aggregate state distinctions and bare indexed-name arithmetic refusal.

These are design decisions/implementation risks, not eight reproduced product
bugs. They do not justify executing or rewriting the native questions, and do
not require a new native row to keep the existing sixteen questions sealed.

## Native question readiness

See `NATIVE-PRESEAL-REVIEW.md`. All sixteen `nativeexpected` values are null;
the 1783 script bytes and two declared substitution contexts are authenticated.
The pinned binary and manual match their published hashes without invocation.
The environment, owned-temp identity, byte/time ceilings and group-reaping
policy are explicit. **Data/protocol ready for later root GO; executable
supervisor admission still separate.** No runner, fixture temp tree, version
probe, syntax check, native result, product result or resource experiment was
created. N08 is a scalar attribute companion, N14 is not parent reentrancy, and
N15 is a file-effect observation, not rollback or host-race proof.

## Review reproduction and ownership

`node tests/shell/indexed-arrays-independent-20260828/audit-metadata.mjs` performs
only Git/file reads, hashes, JSON checks and small numeric calculations; its
stdout is the sealed static report. It does not import product modules or invoke
the pinned native binary. It is not a canonical test or native runner.
Only this new independent subtree is owned/changed. STACK/DOTGLOB, original
author data, foreign staging, private repositories and product files are untouched.
