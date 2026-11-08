# Memory QA

- [ ] `poe-code memory init` in a repo without `.poe-code/` creates `.poe-code/memory/{INDEX.md,LOG.md,pages/}`.
- [ ] `poe-code memory write packages/foo.md --reason hello` appends a line to `LOG.md` and adds an entry to `INDEX.md`.
- [ ] `poe-code memory ingest <a local markdown file> --dry-run` prints a prompt containing both the source and the current `INDEX.md`, does not spawn.
- [ ] `poe-code memory ingest <a local markdown file>` spawns the configured agent; after exit, `INDEX.md` and `LOG.md` reflect changed pages, and the completion line shows a token-reduction ratio.
- [ ] Re-run the same ingest and confirm a `cache hit` line appears with no spawn. Edit the source by one byte, re-run, and confirm a cache miss triggers a new spawn and cache write.
- [ ] `poe-code memory lint` without `--fix` prints issues, including a confidence-tag issue on a stale `source=` ref, and leaves memory untouched.
- [ ] `poe-code memory status` prints `memory pages`, `cited sources`, and `reduction`.
- [ ] `poe-code memory cache status` lists entries and byte totals; `cache clear --older-than 0d --yes` empties it.
- [ ] `poe-code memory install --agent claude-code` creates the skill file and adds a `poe-code-memory` entry to the Claude Code MCP config; re-running is idempotent; `--dry-run` touches nothing.
- [ ] `poe-code memory-mcp --print-mcp-config` prints valid JSON. Register it in `.mcp.json`, launch a session, and confirm `list_pages` returns the same pages as `memory ls`.
- [ ] With `--allow-writes`, the MCP session can call `append_to_page`; without it, the tool is absent from `tools/list`.
- [ ] `poe-code memory query "<something answerable from memory>"` returns an answer with at least one citation; an unanswerable question returns that memory does not answer it.
- [ ] `poe-code memory explain pages/packages/foo.md` produces a short summary and lists inbound/outbound pages.
- [ ] `poe-code memory clear --yes` wipes memory and `.cache/` to the empty state.
- [ ] Running two concurrent `memory write` commands serializes cleanly with no corruption.
