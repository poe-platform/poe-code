# Node v5 bounded repair pre-execution findings

Baseline remains accepted public79 7fde32264d757ef856acf3ae92c8581b4a294341, 278 authenticated inputs and full898 643939eb315c4869de456bb24e371257e3d85b442f3ca401c57ae93c631c7edd.

19b806ee vs d6e0dc7d changes only Object.freeze<NodeHostServices> contextual typing in index.ts. v4 source/build and 171/183 results remain immutable at 68b273d3; twelve failures are four identities across three layouts.

W05: host data read preserves BOM, but worker-main response TextDecoder and worker-provider upload TextDecoder used default BOM removal. Both raw text transport decoders now set ignoreBOM:true. Intentional source/JSON-module BOM rules and shared decoders unchanged. W05 original program reruns; new W28 transport and W29 stdin-source boundaries distinguish bytes from source normalization.

F16/F17 original 16777217-byte reserve exceeds legal 16777216 integer maximum: TypeError, not NodeProfileError. Versioned F16-v2/F17-v2 request exactly16777216, while existing source-context-diagnostics reservation is2883584 (262144*6+65536*4+1048576). Legal request exceeds remaining capacity without cap changes. Numeric profile vs escaping start rejection origin assertions remain unchanged.

W23 old infinite loop produced status2 without engineLimit observation in all layouts. Exact reason remains unknown; parent admission timing is NOT proven. Public budget visitNode/enterCall hooks are present, limits survive reset. W23-v2 instead uses recursive function call-depth exhaustion at unchanged128 cap to qualify actual engineLimit callback without racing100000 loop steps against5s admission. New program is not old W23 rescore; status2 alone insufficient, exact engineLimit1 mandatory. SOURCE references: budget.js 5379c5240faa9310253a22820229996f5c3e47865e509f99bece5fdc5dcf942a; interpreter.js 0ecad2fa480d92672d5a2bf5d719a43fc1e8e6d2adf71efdefe1b85ab2b5d177; run.js b84386db6ece3057f6399bb4dced4f6b9cdb94c24300e64910d15f8fad07e5c8. These bytes are unchanged PUBLIC95 test dependency, not engine patch.

M05 original full contrast remains false; F01/F33/F34 mutant rescue1 vs restored0 was measured. New selected cohort retains those cases plus legal F16/F17 versions and adjacent raw/typed/caller/publication controls. No lifecycle source change is required by that historical partial contrast.

New ROOT grant:45min including prep/publication,96 all OS processes peak4,192MiB capture768MiB work,96Worker/guest ceilings, case30s/build120s. Inherited startup/capture controls are not rerun. No private/network/compiler-engine/native/full-suite/root export proof.

Preparation function SHA256 2720aedbc87819bdfecce0d3f7ef0c86fa35a84f1570ce491579536b39da84d6; its closed literal body provisions only fresh owned validation-v2/author-v5 parents after opening outer prep capture.
