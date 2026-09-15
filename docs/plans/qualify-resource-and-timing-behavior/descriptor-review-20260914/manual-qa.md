# Descriptor accounting manual QA — 2026-09-14

Target: ECMA-262 edition 16 / ECMA-402 edition 12 (June 2025), with existing evidence pins for newer APIs unchanged. This increment repairs trusted descriptor traversal; it neither admits native Proxies through a new public route nor grants host authority.

1. Run the new symbol-mutation test before repair. Preserve the missing-descriptor TypeError and passing mutation/error controls.
2. Apply only the missing-descriptor guard. Run all five deterministic regressions and the maintained existing accounting/boundary/CLI selection. Preserve exact commands and unavailable filters separately.
3. Run normal `npm run build`, `npm run lint`, and scoped ESLint. Record terminal results separately; a focused lint pass cannot close a failed/incomplete repository lint run.
4. Execute built SDK original/completed replay with explicit data bindings, absent ambient process/require authority, and adjacent passing/failing work limits. Exercise CLI success and fatal-budget exit with a `.safejs` source fixture; preserve outputs. No CLI visual behavior changes, so screenshots are not required by this increment.
5. Repeat the complete original four timing files plus the complete agent-harness replay-equivalence integration file, three samples on each available declared Node runtime. Retain unchanged assertions and deadlines. Record load, versions, elapsed time and every failure/skip. Do not overlap task-owned diagnostic jobs during measurements.
6. Execute the exact maintained four-workspace scheduler command. The excluded virtual-bash cell remains unverified. Preserve failures and cleanup errors; do not reinterpret a focused pass as a broad-gate pass.
7. Compare candidate hashes and the staged-diff hash with the initial receipt. Record delivery/release observations separately from local qualification.

Status and commands are recorded in qualification.md and JSON receipts. Previous profile receipts remain historical; this descriptor guard is not claimed as a timing optimization.
