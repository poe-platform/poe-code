# LET ratified author packet — August 28, 2026

Authority: root's explicit ratification following design commit
`71c1a866eac97a072aa35e55808d2e15a6143bea`. This additive packet resolves the
pending C1–C4 choices in the historical profile; it does not rewrite that
profile, its native observations, or its preparation failure.

## Exact unchanged design bindings

| Artifact | SHA256 |
| --- | --- |
| `PROFILE.md` | `26cb0596cd4bc11c9ee2cb2ce7dd9fe994235e8d6aa2a7c5c250c66ffada95de` |
| `FUTURE-FREEZE.md` | `eaf7836487ee5af1dc1f884ad99b9026716de5fd450747f81edc9e4502415d96` |
| `EVIDENCE-MANIFEST.json` | `f5ead382a45257a9f23861121455faa0d175664d3432a617ceafb75229a451f8` |

Selected design composition remains baseline
`5137a74ec855a32d8a8860eb66b62eb44d11e290` plus only the accepted CD runtime
blob from `4641075df5355a91c83bf5b2cc3a88dfaf1f5153`, not the entire concurrent
CD commit. Any later author candidate requires explicit composition binding.

## Ratified decisions

1. **C1: AST-first, per argument.** Fully parse one argument before evaluating
   it. A malformed argument performs no partial writes. Preserve successful
   earlier arguments; stop at the first failure. Do not preparse all argv.
2. **C2: project prefix restoration.** Preserve the runtime's existing saved
   prefix restoration, including failure/cancellation paths. Do not add a LET
   exception to emulate native prefix-write persistence.
3. **C3: narrow help refusal.** Reserve only first-token `--help` before the
   optional leading `--`: status **2**, empty stdout, command diagnostic
   `let: --help: unsupported option`, delivered through the existing Shell
   envelope. For script `let --help` with default identity/line, stderr is
   exactly `shell: line 1: let: --help: unsupported option\n`.
   This is an explicit project difference, not GNU help. Other decrement
   operands, including `--version`, remain arithmetic under the existing
   parser. Do not add a generic long-option rejection or a version option.
4. **C4: unchanged routing and qualifications.** Preserve structural syntax,
   control and limit routing and existing synchronous evaluator qualifications.
   No new hard CPU/stack/latency/preemption guarantee.

Readonly protections remain authoritative, including checked arithmetic writes
and existing OPTIND integration. Arrays, floats, namerefs and host evaluation
remain excluded. Reuse the existing engine and runtime mechanisms: no new
Budget, API, plugin registration or default-command count change. Proposed
production write scope remains **`src/shell/runtime.ts` only**; this is scope
information, not permission to edit it now.

## Ownership and next gate

**Runtime edits remain HELD.** Root must explicitly release the runtime window
in coordination with Poincare. The possibility of scheduling tiny LET before
the directory stack is not authorization.

**Plato owns the different 22-family pre-code freeze next.** This packet hands
off the ratified choices and existing design checklist; it neither duplicates
that freeze nor claims it completed. This design reviewer now stands by.

## Evidence preserved

The original native recipe and one run remain **28 observations**, not product
passes. All 28 child groups closed naturally; no native rerun is authorized or
performed for this packet. The original supervisor syntax-check failure and
obsolete unexecuted manifest remain intact. No product implementation,
execution, private writes or historical rescore occurs in this ratification.
