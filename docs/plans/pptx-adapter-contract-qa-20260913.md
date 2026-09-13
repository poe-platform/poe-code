# PPTX adapter contract QA, 2026-09-13

Delegated owner: adapter QA worker. Owned files are this procedure and
`docs/pptx/adapter-contract-qa-20260913.md` only. Root owns commits; contract
worker owns the domain regression. Preserve all other working-tree files.

## Procedure

1. Read root/scoped instructions, PPTX and shared Office specs, and pinned API/test
   audit and inventory metadata. Treat inventories as obligations, not passes.
2. Run maintained original PPTX command tests through the public `pptx` SDK and
   registered safe-bash Shell adapter. Use memory only. Record exact commands,
   counts and build qualification; a direct selected run is not a workspace gate.
3. Exercise shared grammar, rejected aliases/flags, eight-field envelopes,
   ordinary statuses, and comparison statuses through public entry points.
   Account separately for Shell caller-abort rejection and command cancellation.
4. Compare DOCX's declared common contract. If no package/executable schema exists,
   retain runtime and machine-schema comparison as pending; never infer parity.
5. After the contract worker's diff limit fix is built, exercise its errors through
   actual Shell and inspect a terminal screenshot from the maintained renderer.
   Keep disposable screenshots/logs outside tracked evidence. No renderer runtime,
   publisher assets, host-backed document input or network capabilities are used.
