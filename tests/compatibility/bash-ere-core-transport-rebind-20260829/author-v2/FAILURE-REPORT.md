# ROOT-author producer v2: genuine compiler failure

The explicit `ROOT_SOURCE_ACCEPTED_AUTHOR_BUILD` contract branch is implemented;
the single PURE contract invocation passed all four controls. This is an author
contract result, not an independent producer review. Exact source acceptance
remains `f17d8dec11190ef40ecac6c175b208a2e29c7fbf` for the two files from
`4abbdeec8e34de88ed2cf7bd32be9c06b413c631`; actual private T1 is still pending.

Fresh preseal SHA256:
`c0ac00138f379f36a7fabb447ccda25a16788006942ee01f893b67088d3ca5c4`.
Build grant SHA256:
`3b2a3425fd3746d92227e23ddeee6f2abd8af08ae6128a620bc01d2312939997`.
Both were frozen before the compiler. The original c73b STOP and old seal are
unchanged; this version does not amend either historical artifact.

## Observed failure

The one strict compiler invocation ran August 29, 2026, 15:55:44.410–15:55:49.284
UTC and exited 2. `output/strict-build.stdout` contains exactly 165 bytes:

    error TS2688: Cannot find type definition file for 'node'.
      The file is in the program because:
        Entry point of type library 'node' specified in compilerOptions

Raw stdout SHA256 is
`22d754e33e5e414d820e237c9e477c81ec8db495c45ab51f7665351a89a3c783`;
stderr is empty. `output/strict-build.json` retains the exact command, PID,
timestamps, exit, close, both EOF observations, and retirement. The command
passes `--typeRoots` pointing to a fresh empty directory, while the unchanged
selected `tsconfig.json` explicitly requires `types: ["node"]`. Thus this is a
producer recipe/type-environment failure, not evidence of a transport source
regression. No declaration package was installed or borrowed after failure.

All 305 selected source inputs were authenticated before compilation: 303
unchanged plus exactly the two accepted overlays, composition
`ff0c86a560da56b58437928c499ca7f5b9d25d70`. Node, Git, 241 TypeScript files, the
fixed npm closure (2027 regular files, 12 links, 517 directories), and distinct
empty user/global npm configs were authenticated. Source bytes are rechecked in
the failure census. The compiler may emit despite an error: the complete
retained emit inventory and delta in `FAILED-EMIT-DIFF.json` are explicitly
failed-build DATA, not qualified shipping outputs.

## STOP and scope

- Compiler attempts: 1; retries: 0; npm pack attempts: 0; archive decodes: 0.
- No new producer archive, shipping qualification, private-asset qualification,
  materialized layouts, or executable CORE guard binding exists from this run.
- Product, Worker, product Shell, native oracle, install, and network runs: 0.
- The new guard/binding code is only presealed preparation, not runtime evidence.
  Future 242-role / peak-4 / 309-Worker-one-live proposal and conditional logical
  bound 332129069 remain prospective, not recomputed for a nonexistent package.
- No transfer of K08, PIPE, B35, public Node HEAD, or old CORE results occurs.
  B35 finite DATA acceptance and reviewer peak-4/3 HOLD remain unchanged.

`FAILURE-RECEIPT.json` and `RETAINED-INVENTORY.json` provide exact counts, sizes,
hashes, role accounting, and publication reserves. Census is finite regular-file
logical work, not OS disk allocation, RSS, or Git-internal physical storage.
Compiler and Git child retirement is observed; administrative role closure is
qualified by direct tool completion, not a fabricated per-PID child ledger.
One failed inspection used an unmatched zsh glob; it launched no child and is
preserved in the administrative accounting. No failed observations are erased.

Final producer verdict: **HOLD — actual strict build failed (TS2688)**.
Contract controls: **4/4 PASS, author PURE only**. No independent review claim.
