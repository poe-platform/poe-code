# @poe-code/memory

Repo-scoped persistent memory for poe-code projects. Memory lives at `<repo>/.poe-code/memory/` and stays agent-neutral: plain markdown pages, a generated index, an append-only log, an ingest cache, CLI commands, and an optional stdio MCP server.

## On-disk layout

```text
.poe-code/memory/
├── INDEX.md
├── LOG.md
├── .cache/
│   └── ingest/
└── pages/
    ├── architecture.md
    └── packages/
        └── superintendent.md
```

- `INDEX.md`: regenerated from `pages/**/*.md`
- `LOG.md`: append-only change log written by reconcile
- `pages/`: markdown memory pages with YAML frontmatter
- `.cache/ingest/`: content-hash ingest cache

## CLI

- `poe-code memory init`: create `.poe-code/memory/` with `INDEX.md`, `LOG.md`, and `pages/`
- `poe-code memory ls`: list pages and descriptions
- `poe-code memory show <path>`: print one page
- `poe-code memory edit <path>`: open a page in `$EDITOR`
- `poe-code memory write <path> --reason <text>`: replace a page from stdin
- `poe-code memory append <path>`: append stdin to a page
- `poe-code memory search <query>`: search memory text
- `poe-code memory ingest <source>`: spawn the configured agent to fold a file or URL into memory
- `poe-code memory lint [--fix]`: audit stale claims and optionally let an agent repair memory
- `poe-code memory status [--no-tokens]`: counts, bytes, last write, token-reduction ratio
- `poe-code memory cache status`: inspect ingest-cache entries
- `poe-code memory cache clear [--older-than <duration>] [--yes]`: clear cache entries
- `poe-code memory query "<question>"`: answer using memory-only context with citations
- `poe-code memory explain <rel-path>`: summarize one page plus inbound/outbound links
- `poe-code memory install`: install the `poe-code-memory` skill and register the MCP server
- `poe-code memory clear --yes`: wipe memory and `.cache/`
- `poe-code memory-mcp [--allow-writes] [--print-mcp-config]`: start or print config for the stdio MCP server

## Config knobs

Configure under `.poe-code/config.json`:

- `memory.ingestAgent`: override the spawned agent for `ingest`, `lint`, `query`, and `explain`
- `memory.ingestTimeoutMs`: timeout for ingest/lint agent runs
- `memory.maxPageBytes`: soft warning threshold for oversized pages
- `memory.confidence.rejectUntagged`: make untagged long page bodies a lint error
- `memory.confidence.minInferredConfidence`: lower bound for `inferred` confidence tags
- `memory.cache.enabled`: enable or disable ingest-cache reads and writes
- `memory.cache.maxAgeMs`: ignore or prune stale cache entries
- `memory.mcp.allowWrites`: default `--allow-writes` for `poe-code memory-mcp`
- `memory.query.defaultBudgetTokens`: default budget for `query` and `explain`

## Confidence tags

Non-trivial claims use HTML comment tags directly above the paragraph they qualify:

```md
<!-- memory:extracted source=packages/superintendent/src/phases.ts#L42-L58 -->
The loop has four phases: build, inspect, review, checkpoint.

<!-- memory:inferred confidence=0.7 -->
Checkpoint frequency scales with phase duration.

<!-- memory:ambiguous reason="conflicting incident notes" -->
The inspect phase may retry up to 3 times on ENOENT.
```

Supported verbs:

- `extracted`: requires `source=<path>[#Lstart[-Lend]]`
- `inferred`: requires `confidence=<0..1>`
- `ambiguous`: requires `reason`

Reconcile denormalizes inline `source=` references into frontmatter `sources:`.

## MCP server

`poe-code memory-mcp` exposes repo memory over stdio as `poe-code-memory`.

Tools:

- `list_pages`
- `read_page`
- `search_memory`
- `status`
- `append_to_page` when writes are enabled

Config snippet:

```json
{
  "mcpServers": {
    "poe-code-memory": {
      "type": "stdio",
      "command": "poe-code",
      "args": ["memory-mcp"]
    }
  }
}
```

## Install walkthrough

1. Run `poe-code memory install --agent <name>` to install the `poe-code-memory` skill and register the MCP server for that agent.
2. Add `--allow-writes` if the MCP client should advertise `append_to_page`.
3. Use `--skill-only` or `--mcp-only` for partial installs.
4. Use `--dry-run` to print the planned changes without touching disk.
5. After install, run `poe-code memory init` in the repo before the first write.

## Notes

- Memory is opt-in and project-scoped.
- Wrapped agent sessions are not auto-injected in v1.
- Search stays plain-text; no embeddings or vector index.
