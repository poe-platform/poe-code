# Terminal pilot MCP QA

Execute this plan as an agent; do not replace it with a QA script.

1. Build the selected `terminal-pilot-mcp` workspace closure with `npm run build:workspaces -- --workspace=terminal-pilot-mcp`.
2. Create a task-specific temporary directory and run `npm pack --workspace=terminal-pilot-mcp --pack-destination=<directory>`. Inspect the tarball for the executable CLI and required runtime dependencies.
3. Install the tarball into a separate temporary prefix with `npm install --prefix=<directory> <tarball>`. Do not modify global installations.
4. Invoke the installed `terminal-pilot-mcp --help`; verify exit code zero and inspect output for usable descriptions, options and coherent styling.
5. Capture help through the maintained screenshot command where supported and inspect the image.
6. Start the installed MCP server with stdin open. Send modern `server/discover` metadata for `2026-07-28`, then list tools. Verify framing, identity, schemas and tool annotations. Use only a non-destructive terminal operation for a tool-call check; record its inputs and outputs.
7. Close stdin and confirm cleanup without hanging subprocesses. Repeat discovery and a safe call using a fresh legacy connection.
8. Remove only the task-created temporary directories after recording evidence.

## Execution evidence

Selected 23-workspace build closure passed. Packing passed using a task-local npm cache after the default cache was sandbox-restricted. Tarball includes executable CLI, bundled runtime JS, declarations, license and package metadata. A fresh temporary-prefix install failed with registry.npmjs.org ENOTFOUND; fresh dependency installation remains unverified.

Extracted artifact with existing local dependencies successfully performed modern server/discover, tools/list (26 current/legacy alias tools), and a safe list_sessions call returning {sessions: []}. Structured output, complete result type, server identity, clean stdout framing, no stderr, and stdin EOF exit zero verified. --help produces no output and exits zero on EOF; this server currently exposes no CLI help. Do not count it as usable-help validation. Legacy artifact check and visual help behavior remain pending.

Tool annotations/title preservation audit: wrappers omit upstream command metadata; regression prepared for validation after the broader maintained build/test route completes.

Legacy extracted-artifact verification passed against local dependencies: 2025-11-25 initialization, 26 listed tools, safe list_sessions output, no stderr, and stdin EOF exit zero. Title/annotation preservation regression reproduced and passes for both aliases after correction. Rebuild artifact to verify final metadata.

Final CLI admission verification supersedes the earlier missing-help finding: the rebuilt pilot and PNG CLIs both implement --help and reject unsupported --http. Clean Node subprocess checks passed all four cases, with exit zero for help, exit one for unsupported arguments, and output exclusively on stderr. The generated help/error screenshots were inspected. Maintained focused CLI tests cover silent stdio startup and invocation guards.
