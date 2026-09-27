# Tiny MCP client native import QA

1. From the repository root, launch a clean Node child process with the native `tsx` loader and import `packages/tiny-mcp-client/src/index.ts`. Keep the original five-second deadline and empty inherited loader arguments.
2. Verify the child exits successfully, writes no standard output, and reports no syntax error. Importing inside the Vitest worker or a worker thread does not replace the clean-process check.
3. Run the maintained normal build and existing MCP client unit tests to verify the built package and source API independently.
4. Keep temporary fixtures and evidence under `out` and remove them after verification.
