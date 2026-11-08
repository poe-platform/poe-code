# Additive yq decision checkpoint — PRECODE / UNIMPLEMENTED

Date: 2026-08-28. Status: informative reconciliation only; **no yq code-go**.

The original `freeze/` tree at `f074c142411ba839cbd9da45a499cc798965149d`
remains byte-for-byte and membership unchanged. `crosswalk.json` overlays current
status without modifying any sealed assertion, source binding or checker.
It covers all **194 original records** by an unchanged default plus seven
record-specific overlays: 187 unchanged, three resolved, three still golden-held,
and one narrowly scope-held. Thus **four distinct original records have holds**.
The normative 80 and query-budget 62 records overlap these inventories; they are
not summed into unique product cases. **New cases: 0. Product/native runs: 0/0.**

## Closed existing blockers

| ID / original record | Current resolution and binding |
| --- | --- |
| B-LENGTH-ACCEPTANCE / QUE-12 | Closed by root's accepted `74361026502d76b8c2b696f9c60e410ac9b78d95`, relayed at `3387a103798bb441764218d38696639d501d19d2`. Existing output expectation unchanged. |
| B-AST-DEPTH-LEXEME / WRK-10 | Query D04/D05: identity plus 63 postfix `?` nodes has AST depth 64; 64 has depth 65 and fails `LIMIT_MAX_AST_DEPTH` before input. Bound parser lines 174–176, 193–218 establish this statically. |
| B-NUMERIC-ZERO / NUM-14 | `0e1000000000` fails input pre-conversion exponent admission: status 5, `SCHEMA_DECIMAL_RANGE`, empty stdout. Initial §3.3 steps 2–4 expressly reject out-of-range exponents without a zero exception; query N10 confirms. Later engine clamping is not input admission. N2 remains open. |

Length evidence is **root-relayed**, not our pack replay: Plato
`16c4502da78ac209e8979d7bd576f2be5492f104` reports 60 holdouts and 93 regressions;
README-only full846 addendum `6d5cf6c640d87a5e427049d329eabf5c39136259` binds
recipe `4e4fbb56ae92720735bb30c63b27708a22d248e1` and package SHA-256
`ff230f2e9079cc843198533e412f836abb62e4ade63f4fa210b7269f7deb4eff`.
No length prerequisite remains. The candidate remains EXACT5137 plus accepted
length plus authorized new yq/private-adapter work, not current HEAD or a new base.

## Remaining decision checkpoint

| ID | Existing witness / exact remaining issue |
| --- | --- |
| N1 | Normative G03, `{"red\n  blue": 1}` with an actual newline: confirm FLOW-IN production scope or expressly choose an extra restriction. Scope ambiguity; **not an unconditional contradiction**. Original WRK-25 is block-key-only and stays valid. |
| N2 | NUM-15 / normative N07, `10e-1147483647`: specify trailing-zero normalization before range admission. `/expect` stays without status/output golden. |
| N3 | UTF-12 / normative Q11: choose per-escape scalar validation versus adjoining surrogate-pair assembly. `/expect` acceptance/status/value remains held; unpaired rejection is settled. |
| N4 | Normative T13, `!!float 7`: direct explicit-tag regex versus first implicit-family interpretation. PAR-32/33 are unaffected kind/Boolean controls. No original float-overlap case is invented. |
| QB-F1 | Query B01: 1,023 null members, 1,024 visited nodes, 5,116 compact bytes. Specified synchronous boundary helpers conflict with applying the owned checkpoint rule inside them. **WRK-22 `/expect/assertions/0` is held only for that unqualified helper application**; cooperative scanner behavior remains. Root must classify or reconcile the boundary; no redesign is proposed here. |
| QB-F2 | Query B02: remaining 1,024 steps, copied units 1,024, later tick +1. Whole-copy work admission/mechanism remains unsettled. WRK-16's node-only admission is not contradicted or promoted to work-reservation proof. |
| B-ENCODER-ESCAPE-SPELLING | ENC-07 `/expect`: only exact escape bytes remain held. Status 0, NUL semantics and legal quoted escape are settled. Missing exact presentation bytes is **not a contract contradiction**. |

N5 is a separate **reachability observation**, not another policy choice or proved
impossibility: no normal `ALIAS_CYCLE` witness is demonstrated. All 54 entries
remain; only `ALIAS_DUPLICATE_ANCHOR` is explicitly reserved/unreachable.

The seven open IDs above do not imply seven unique product cases. Original
golden-held records are NUM-15, UTF-12, ENC-07; the additional partial scope hold
is WRK-22. The sibling packets retain four normative and two query-resource
blocked records. Resource feasibility remains a global replay prerequisite.

## Evidence and checks

`sources.json` authenticates selected immutable reviews, their case catalogues,
the adopted numeric rule, parser binding and length relay. Primary locators are
those already verified by normative N1/N3/N4: YAML 1.2.2 §7.4.2 productions
140–149/154–155, §8.2.2 productions 192–193, §7.3.1 production 110;
§5.2/§5.7 productions 60–61; §10.2.1.4/§10.3.2 respectively, at
`https://yaml.org/spec/1.2.2/`. No new external research or copied cases are added.

Run the unchanged original three preparation checkers and `reconciliation-v1/check.mjs`.
All checks are static, not parser/product/type/native execution. The original
query checker's `pending Plato` and original freeze's six-blocker output describe
their historical seals, **not current failures**. The new checker verifies the
194-record crosswalk, exact selected Git bytes, unchanged original packet files,
and complete original-freeze membership before/after its checks; no writes.

Observed on 2026-08-28: **all four static checkers passed unchanged/as supplied**.
Original freeze: 194 records; normative: 80, with no selected current-source
differences; query-budget: 62, with its preserved historical pending label;
crosswalk: 194 covered, three closures, four unique held original records,
15 selected bindings and all 12 original freeze files unchanged. These are
preparation results only. Scoped whitespace checks also passed.

The earlier root resume CLI error was coordination preparation failure only;
its log was not inspected or changed. An initial local read command also used a
zsh-special variable name and failed command lookup; it was immediately rerun
correctly without edits or product execution. Neither is a product finding.

Root decisions, source edits, dependencies, lifecycle/API redesign, implementation,
pack replay and broader cases are outside this reconciliation. Preserve this
decision checkpoint and the original history when recording later resolutions.
