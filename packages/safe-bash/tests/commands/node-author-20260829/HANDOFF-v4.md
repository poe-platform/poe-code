# Restricted Node module AUTHOR-v4: completed execution, HOLD

2026-08-29. Not module/provider/public acceptance. Source 19b806ee8125be6df3fd5f7f0d25eeaad3546721; module manifest SHA36558e45f86c0b7c6c55e914a052e4f0d445ac618047c22770ce975125858864; repair preseal SHAf055ff17371337d9434e86054646ec4b02d6ad0bbc23f1beea5f50c6fd88a961. Exact accepted DERIVED public79 baseline7fde32264d757ef856acf3ae92c8581b4a294341/278 inputs plus16 Node source/doc files. No root/default/package exports, shared core/limits/AST, engine vendoring, private/network/native fallback changes.

## Blocking findings

- PRODUCT: W05 returns1 rather than0 in all layouts, with 'node: Unexpected non-whitespace character after JSON at position 6 (line 1 column 7)' plus newline. Host data read preserves BOM, but worker-main.ts:78 uses default TextDecoder BOM stripping. The source-consistent explanation is that guest slice(1) then removes the opening JSON brace. worker-provider.ts:121 also strips upload BOM; that additional effect is SOURCE-only. Proposed repair: ignoreBOM:true on raw transport decoders, preserving intentional entry/JSON-module policy separately. No post-run source patch or untested-success claim.
- FIXTURE: F16/F17 use16777217, outside the valid reservation input; values.ts:88 strict integer admission raises TypeError before ledger exhaustion. Old NodeProfileError class assertions fail after their numeric/raw-identity assertions were reached. Proposed new valid16777216 reservation would reach already-consumed capacity. Proposal UNRUN; old failures unchanged.
- UNQUALIFIED: W23 returns2, with1engineAttempt/guestEntry,0engineLimit/terminal and1Worker exit/retire per layout. The required engineLimit assertion fails. Public run does consume the supplied Budget. Parent5s admission shutdown is consistent with events, but exact selected reason was not recorded; no invented timeout/engine diagnosis or claim of observed step-limit notification.

## Exact outcomes

- 57/61 identities per layout: source-built ESM, offline installed package, physically moved installation.171/183 main executions pass;12 fail. Focused32/34 each (96/102); Worker25/27 each (75/81). This is61 identities, not183 unique cases.
- Main81Workers/69engineAttempts/69guestEntries/45entryReturns/141requests/129postcopy/81exits/81retirements/81parent cleanups. Including5 mutant+5 restored Worker controls:91Workers/79attempts/79entries/51returns/165requests/152postcopy/91exits/91retirements/91parent cleanups. Three W01 trusted native-noise adapter executions are instrumentation; guest stdio expectations unchanged.
- F01/F33/F34 pass every layout with cooperative parent abort/cleanup and rescue0. W26 selected profile stop and W27 async undefined observer rejection pass with actual Worker exit/parent cleanup. W27 has0guest entries. No hard completion claim for uncooperative jobs or all guest Promise jobs.
- Strict selected-source build: exit0,0 diagnostics,956 emitted files/239 declarations, including15 Node JS/15 Node declarations. PUBLIC engine not recompiled. Per layout12 positive and12 negative type identities: exit0/exit2 with exact12 negative diagnostics.36+36 repeated execution identities total. Each consumer reaches4 Node declarations and179 declarations overall, not every generated declaration. New service hooks are strict-compiled; no additional standalone type cases are invented.
- Five of six whole mutant families pass. M05 adds failures in F01/F33/F34 (rescue1/no abort); restored target rows pass. Whole focused restoration remains false due F16/F17; do not rescore it as a sixth family pass.
- Six driver-defined actual-loaded controls pass:4 loader refusals and2 raw PASS/exit-or-missing-receipt counterexamples. The latter2 are not direct composed judge replays. Eight updated-cardinality judge controls pass. Seven old capture controls inherited, NOT rerun.
- Per layout28 main case processes yield3928 load rows/148 distinct paths, including15 Node JS and93 engine JS.95 authenticated/copied engine emissions does not mean95 loaded. All byte bindings and raw load rows retained.

## Package, limits and retirement

Whole958-entry/869709-byte package SHAe855465283cc2e78a068c4614a4861502ece55bbd416a47e699f1e4cd1965fb6. Its898-entry baseline projection matches the accepted full898 SHA643939eb315c4869de456bb24e371257e3d85b442f3ca401c57ae93c631c7edd manifest entry-for-entry. Actual offline install and physical move used these bytes; old consumer origin absent. Internal Node module imports are not public root export proof.

Main raw archive SHAb98aa8f1eaa8da9d84dcd9a267fdd236cad83ea9088f3613f7681d6d4a5cf122.233 final raw files/7337605 bytes are bound in POSTAUTH-v4.json:111 child stdout/stderr pairs, journal, package/raw archives and outer captures. Raw archive authenticated before owned work removal; final summaries record cleanup true. Both work/work-r1 absent. All26 sealed inputs and live owned16-file name/hash census match. This is not a whole moving-repository guard.

Actual phase:3 original failed-build activation processes+113 complete repaired activation processes, all closed naturally. Seven source-repair/preseal processes before publication;4 final publication starts yield127/128 owned OS starts, peak3 owned/4 including preexisting tool host. Main capture4256244 bytes, writes169692605 bytes, scratch high-water172060738 bytes; not RSS. Original actual-phase deadline unchanged. Publication consumes the reserved allowance; no further activation is admitted here.

Startup-v4 separately passes only S05-v2/S06, with2 OS processes closed. Exact retained SecurityWarning, only observed PID substituted; original c24 S05 failure/S06-unrun preserved. d6 strict build's6 TS7006 diagnostics/archive573c03943d6fca1e14e0b3107c5d59c38f4c5792b8ae0b85b36d933187f26fc1 retained;19b806ee only adds Object.freeze<NodeHostServices> contextual typing. Prior v1/v2/263 histories unchanged. One final artifact-construction tool input had a syntax error before evaluation (0children/0files); corrected publication is not an actual cohort retry. Long tool displays may truncate; owned raw captures are complete.

## Next action

Fresh bounded BOM repair and versioned valid-ledger/engine-limit qualification, then Poincare independent review. Do not register/export/default-enable Node or claim full Node/native compatibility. RESULTS-v4.json and POSTAUTH-v4.json retain detailed counts, origins, source-only implications and complete artifact bindings.
