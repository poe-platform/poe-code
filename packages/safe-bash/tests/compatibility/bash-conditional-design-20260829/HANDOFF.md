# Root handoff — design only

2026-08-29. Ready for policy ratification and a different design review.
No implementation, native baseline, product test or acceptance is implied.

* Source: derived `26215b99cb379a9f825f803454f758fab5a3c8e9`, 38 individually
  authenticated inspected blobs. Public80 + accepted Unit1 + **provisional**
  Unit2 928be558; not moving HEAD. Binding is `BINDING.json`.
* Separate conditional grammar/evaluator is necessary: existing parser refuses
  `[[`; ordinary test argv eagerly loses expansion/quote context. Existing
  unsplit word expansion, quote-aware pattern lane, compound redirects and
  execution-boundary control are reusable hooks, not runtime proof.
* Proposed paths only: parser.ts, runtime.ts, display.ts, new private
  conditional.ts. **parseShell's AST union is publicly observable**; explicitly
  approve the additive node. No registry/default/package/limit API additions.
* Ratify D01–D08 in README: AST, basic-glob restrictions, C collation, numeric
  literal subset versus deferral, explicit regex deferral, unavailable metadata
  predicates, private4096nodes/depth64 and status/diagnostic policy.
* Priority recommendation: grammar + lazy scalar/basic-pattern/VFS/presence
  evaluation first. Full arithmetic and POSIX ERE/capture publication require
  separate policy/engine work. No main-thread regex/native/registered-grep shortcut.
* `CASES.json`: 40 literal differential identities +10 host protocols, **all
  UNRUN**, all native/product expected results null. C05 explicitly includes
  single-word unary ambiguity; C14/C24/C31–35 expose held coverage, not skips.
  No oracle implementation-derived goldens. The prior surface40 was not edited.
* Data checks only: cases/code-list agreement, 61 captured records,38 source
  hashes, capsule SHA and helper binary streamed hash. `CHECK.json` is not a
  product-test count. GNU official manual Edition5.3/date verified online;
  local helper Node22.22.2 is not a native Bash or product runtime qualification.
* Capture: SOURCE-DATA.json.gz contains bounded source/data, not instructions.
  1,228,071 raw bytes /447,824 compressed; temporary original retained at
  `/tmp/bash-conditional-design-CTKGk6`. Zero native/product/compiler/build/
  installer/private-engine/Worker executions; no owned background sessions.
  Original publication snapshot precedes the documented C05 arity refinement;
  CHECK.json validates the final cases. No historical result was rescored.

## Exact decision summary

1. Add the conditional AST node; acknowledge public parseShell union impact.
2. Basic glob only initially; unsupported active extglob/classes explicitly
   refuse, quoted counterparts remain data. Preserve lazy branch evaluation.
3. C/POSIX valid-Unicode/UTF8 ordering only, or defer `<`/`>`; no host collation.
4. Literal/base/empty numeric operands with current signed64 parser, or defer;
   do not claim full arithmetic/nounset compatibility.
5. Hold `=~` semantics/captures: current engines are not a Bash POSIX ERE seam.
6. VFS-supported predicates only; no invented descriptor/owner/device identity.
7. Existing shared budgets; proposed internal4096nodes/depth64, before-growth
   admission and cooperative pattern work, not new public overrides or RSS claims.
8. Propose true0/false1/profile-refusal2; GNU diagnostics/lexical ambiguities and
   Unit2 unresolved rows need independent native binding before parity claims.

No new implementation GO is assumed. Future execution/fence proposal is in
README; it is not activation of held native/fullgate/engine work.
