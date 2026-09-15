# Release dashboard test package boundary

Package lint reproduced a cross-package relative import in the remote-main agent-spawn ACP dashboard regression. The test imported toolcraft-design's private store implementation. Verify stream publication, stable preview IDs, bounded text, and error routing directly through the stream's callback contract instead. This removes the private dependency and preserves focused assertions without changing production code or exposing a new API.

The bounded-text assertion includes the Markdown formatter's heading/newline overhead, derived from the first 1,000-character payload. It still verifies the stream's 16 KiB preview bound before a dashboard store can truncate it. All six existing dashboard-stream tests pass in 84 ms. Package lint passes all 17 rules across 73 packages. Run the maintained agent-spawn unit task and changed-file ESLint before pushing.
