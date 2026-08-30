# G2 bare-export correction — August 27, 2026

**PASS:1/1 authorized execution,7/7 completed real-guest assertions.**
One child only; no G1 replay, third case, generic25 or further execution.
Candidate `618d8967009117547ab476256bc6eb0a9463309a` remains accepted unchanged.
Freeze commit: `1cf6596a76c4dbeca77af8e3d71f93c4c12c5137`.

The sole guest correction replaces the two unsupported `export -p` lines with
existing bare `export`; every assertion and expected state string is unchanged.
Original guest SHA256:
`234394738ffee2ae4581ccf33d7bb7d2af54c722de24ec10aa7942037a594cab`.
Corrected guest SHA256:
`9cee7f5958902a4a37f180c623f9e1e12469d6555eb72f426dbb0584b9dd27df`.
FREEZE.json also binds both old/new bridge-script hashes; G2-CORRECTION.diff
preserves the exact syntax delta. Previous child-v2 and witness bytes are identical.

## Expected and observed state

All rows matched inside the real guest, returning G2_GUEST_ASSERTIONS_COMPLETE:

| Observation | Expected = observed |
| --- | --- |
| Fresh first bridge defaults | OPTIND=1, OPTERR=1; neither exported |
| Actual exported entries, both bridge calls | `declare -x PWD="/work"`; `declare -x TAG="bridge-owned-by-host"` |
| Parent first scan | status0, option a, OPTIND1, OPTERR1 |
| Subshell child scan/change | status0, option b, OPTIND2, OPTERR0 |
| Parent after child | option a, OPTIND1, OPTERR1 |
| Parent resume | status0, option b, OPTIND2, OPTERR1 |
| Reset sibling subshell | status0, option a, OPTIND1, OPTERR1 |
| Parent final | option b, OPTIND2, OPTERR1; one unchanged argument -ab |
| Second bridge exec fresh | OPTIND1, OPTERR1; neither exported |
| Second bridge explicit -a scan | status0, option a, OPTIND2, OPTERR1 |
| Outer parent | `OUTER\|0\|7\|0\|parent\|2\|parent\|sentinel` |

Both bridge script results and outer result have exitCode0 and empty stderr.
The seven original guest assertions cover export absence/defaults, child/parent/
sibling state and the second exec; the host independently checks outer preservation,
guest completion/count, bridge counts and trace identity. The table's positive
PWD/TAG listing is captured evidence, not an invented eighth guest assertion.
Existing API: guest `shell.exec(sourceString)` through public makeSafeJsShellModule,
real declareHostOperation and read-side-effect. The separate Shell is host-owned;
no guest capability, argv API or inherited child-ownership contract is invented.

## Actual builtin trace and containment

**5/5 actual getoptsBuiltin entries**, correlated `[0,0,0,0,1]` to two bridges:

- Bridge0 script SHA256: `d109c08a99b32d59fa5bb2f8fb7c3102ae1f0c9434594d75ea9a267d265dfcbf`.
- Bridge1 script SHA256: `c837ddad5810994e47b6ccc29dd36224de6ea80cb006e1317712a2bdd18b4237`.
- Original compiled runtime SHA256: `d37b761457b45ef523546cdad614981c7b5e3ac7665cc486721878195fb3a04a`.
- In-memory witness SHA256: `de5ef818085c83e5fbbd209e9ed08740211663116209b05b01e4d295c1e60631`.

The unchanged loader authenticates252 imports, exactly63 approved real-engine
files, the full installed candidate public root and getopts module. The test-only
witness observes actual builtin entry during each guest bridge call; disk product
bytes are unchanged. Child3415 closed naturally with status0, no signal/watchdog
termination, at22:33:18.862Z (started22:33:17.100Z). Both Shells disposed; guard
reports zero active timers, workers, subprocesses, sockets or refusals.

## Preservation and historical qualification

Private HEAD/tree/index/status/staged/six metadata records/264 eligible engine
records and eligible directory shape match before/after, including added-entry
checks. Original excluded build/cache/module trees are not claimed guarded.
The prior scratch was already removed; identical regular engine copies were
recreated using the unchanged approved guard, never a fallback or private write.
Sealed full candidate source archive988 files and installed public package830 files
are reused without rebuild/live overlay; source/package/compiler/driver inventories
remain append-aware and unchanged. Current245 live preservation paths are checked
before/after separately from the243 immutable candidate baseline hashes.

Both complete earlier seals remain exact: review2dcefd4f (52 files) and prior
followup6133b271 (45 files); all302 prior phase files/314 entries authenticate with
ONLY this new sibling excluded. Own freeze/evidence membership is sealed separately.
Original v1 setup failure and v2 G1PASS/G2nonpass remain historically1/2, not rewritten
or rescored. This1/1 fixture correction completes the same second mandatory probe.

Final guards, compact raw evidence, authenticated scratch cleanup and committed
verification accompany this report. No product/AGENTS/package/exports/private
checkout edits, branch or foreign-index changes. No component acceptance change,
global-green/parity/superiority/default-count or new runtime authorization claim.
