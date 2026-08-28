# B01 — authenticated control failure replaced by invoke cancellation

Severity: high semantic correctness defect; blocks acceptance of this helper
extension. No Runtime execution or deployed impact is claimed.

- Candidate `373437cf84424939e1792470805cdd9e60bd3898`, parent/author freeze
  `88d91975e4a718fb3c1b55322e44492cf4059391`.
- Source `src/shell/cancellation.ts`, SHA-256
  `f628801379acd1c86c247a778e973f4cb89f8bbe2c3089f8192c31f3c5b273a5`.
- Frozen independent executable `extension-v1.mjs` E07, commit
  `cbed682564e1e3b1c2ac8062157ece7b8b997f30`, fails its line 263 assertion.
- Isolated emitted INTERNAL JS SHA-256
  `83a312b43649bd68929a57d113cb1c7cd09dfb2397461b465677dae9c5679d98`;
  declarations `7edba703edd9d09da8fc6b1b754722695d9af2fba9fac0669408bbe1e79eb79d`.
  Regular-copied Node v22.22.2, TypeScript 5.9.3; strict NodeNext ES2023.

Profile: inherited author README lines 55-61 explicitly preserves budget/pipeline
control failures as unrelated execution failures for invoke replacement. The
extension POLICY tightens provenance authentication, not that failure precedence.
Root's accepted unrelated-execution-before-invoke rule remains authoritative.

Reproduction: root -> outer invoke -> nested original control frame -> inner
invoke. Subscribe through the declared helper seam. Deliver control B, then
control A; abort outer invoke. Selection of a return may rank the outer invoke,
but selection of the actual B control rejection with its authentic observed origin
must retain B's exact reason and original control provenance. Instead the runtime
selector selects the outer invoke's reason. The same accepted Stage1 selector
preserves the control rejection. Root caller retains highest precedence.

Cause: candidate lines 784-797 only preserve throws when `classified` is absent;
any authenticated control reaches unconditional `selectedInvoke` replacement.
The unchanged Stage1 selector at lines 744-746 restricts replacement to
`invoke-option` classification. This is a source-level finding, not a proposed patch.

Raw frozen failure: `evidence-v2/extension-isolated.stdout`; authenticated module
load: `evidence-v2/extension-isolated-loads.jsonl`. Post-freeze `bug-repro-v1.mjs`
adds diagnostic contrasts for both original control roles, observed/report routes,
unproven throws, old selector and root precedence; it does not replace or rescore
E07 or add another unique independent family. Its exact outputs are retained
separately. ROOT was notified promptly after the first authenticated frozen failure.

No source patch is made. ROOT routes this finding to the author. Stage2 remains held.
