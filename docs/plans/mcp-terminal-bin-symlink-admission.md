# Terminal MCP executable symlinks

Real npm-style executable symlink QA reproduced both built terminal MCP bins exiting zero with no help or protocol startup. Their main-module guards compared argv alias URLs to resolved module URLs.

Two failing memory-backed regression cases reproduce alias invocation; ordinary path invocation is retained as a control. Compare canonical executable and module paths, including Node preserve-symlinks-main behavior. Imported modules with unrelated/missing executable paths remain inert.

Tests use memfs for all file/symlink fixtures, mock the transport, and restore argv/exit state. No unit files are written to disk. Evidence: /tmp/mcp-terminal-bin-alias-red.log and /tmp/mcp-terminal-bin-alias-green.log. Rebuild both maintained terminal closures, test real alias help and modern/legacy protocol startup, capture screenshots, and pack final artifacts before delivery.

Final execution: all ten terminal CLI checks pass; pilot maintained closure passes 23 builds and PNG closure passes four builds. Real alias help/error checks pass all four cases. Modern 2026-07-28 and legacy 2025-03-26 discovery/listing pass for both aliases, and pilot list_sessions safely returns an empty session list. Both alias help screenshots were inspected. Both isolated final tarballs packed through their lifecycle hooks with unchanged existing README files included.

PNG render_terminal_png additionally passed through both aliases/protocol profiles: valid PNG image content of 36,440 bytes, malformed negative padding rejected with -32602, silent stderr, and child closure awaited. Both returned images were inspected. Evidence: /tmp/mcp-final-terminal-alias-protocol-qa.log and /tmp/mcp-final-terminal-png-render-qa.log. Screenshots are ignored adhoc artifacts, not unit snapshots or committed files.
