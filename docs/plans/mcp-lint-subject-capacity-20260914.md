# Restore repository lint capacity during MCP audit

The maintained repository lint route failed its finite 12,000-subject admission budget on the current checkout before ESLint could complete. The MCP production-readiness audit requires that route to run; bypassing the admission guard would weaken verification.

Raise only the default subject-count budget to 20,000. Preserve per-file bytes, total configuration/subject bytes, metadata operations, directories, entries, receipt limits, boundary admission, and refusal-before-open behavior. No source exclusions or cached execution are introduced.

TDD evidence: the new small in-memory constructor-budget regression rejected a 12,001 subject budget before the change. A second regression verifies that a configured smaller finite limit still refuses the next subject before opening it. Both tests and the maintained lint guard suite pass (281 tests); the focused tests take approximately 14 ms. The maintained repository `npm run lint` now completes successfully, including ESLint, type contracts, and workflow lint.

This is an atomic verification infrastructure fix. It does not establish MCP protocol compliance or resolve failures in the ongoing full unit run. No push or release is authorized or performed.
