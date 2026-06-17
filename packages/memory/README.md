# @poe-code/memory

Repo-scoped persistent memory for poe-code projects. Memory lives at `<repo>/.poe-code/memory/` and stays agent-neutral: plain markdown pages, a generated index, an append-only log, an ingest cache, CLI commands, and an optional stdio MCP server.

## On-disk layout

```text
<memory root>/
├── INDEX.md
├── LOG.md
├── .cache/
│   └── ingest/
└── pages/
    ├── architecture.md
    └── packages/
        └── superintendent.md
```

Default memory root: `<repo>/.poe-code/memory/`. Override it with:

- `POE_CODE_MEMORY_ROOT` environment variable (absolute, or relative to the current working directory)
- `memory.root` in `.poe-code/config.json` (project config wins over global; env wins over both)

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
- `poe-code memory lint`: audit stale claims
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

- `memory.root`: absolute or cwd-relative path for the memory directory (overridden by `POE_CODE_MEMORY_ROOT`)
- `memory.ingestAgent`: override the spawned agent for `ingest`, `lint`, `query`, and `explain`
- `memory.ingestTimeoutMs`: timeout for ingest/lint agent runs
- `memory.maxPageBytes`: soft warning threshold for oversized pages
- `memory.confidence.rejectUntagged`: make untagged long page bodies a lint error
- `memory.confidence.minInferredConfidence`: lower bound for `inferred` confidence tags
- `memory.cache.enabled`: enable or disable ingest-cache reads and writes
- `memory.cache.maxAgeMs`: ignore or prune stale cache entries
- `memory.mcp.allowWrites`: default `--allow-writes` for `poe-code memory-mcp`
- `memory.query.defaultBudgetTokens`: default budget for `query` and `explain`

## Validation and safety

- Memory roots must not resolve through user-controlled symlinks; the normal macOS `/var` to `/private/var` system alias is allowed.
- Cache entries are ignored with a warning when their embedded key or numeric metadata does not match the requested cache entry.
- Agent citations, source references, confidence values, token counts, and query/explain metadata are validated before use.
- `memory lint --fix` is intentionally not exposed until repair behavior exists.
- Dry-run `query` and `explain` commands validate inputs without spawning an agent.

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

## SDK

Memory is re-exposed from the published `poe-code` package under the subpath `poe-code/memory`, so downstream projects do not depend on the private `@poe-code/memory` workspace.

```ts
import {
  resolveMemoryRoot,
  resolveConfiguredMemoryRoot,
  MEMORY_ROOT_ENV_VAR,
  openMemory,
  initMemory,
  listPages,
  readPage,
  searchMemory,
  writePage,
  appendToPage,
  queryMemory,
  explainPage,
  ingest,
  auditClaims,
  reconcile,
  statusOf,
  startMemoryMcpServer,
  installMemory
} from "poe-code/memory";
import type {
  MemoryHandle,
  MemoryRoot,
  MemoryPage,
  SearchHit,
  QueryResult,
  IngestOptions,
  IngestResult,
  ResolveConfiguredMemoryRootOptions
} from "poe-code/memory";
```

### Handle-first API

`openMemory` is the main integration surface. Resolve the root once, open a handle, and reuse it across page, status, query, ingest, and MCP operations.

```ts
import { promises as nodeFs } from "node:fs";

const root = await resolveConfiguredMemoryRoot({
  cwd: process.cwd(),
  env: process.env,
  fs: nodeFs,
  configPath: `${process.env.HOME}/.poe-code/config.json`,
  projectConfigPath: `${process.cwd()}/.poe-code/config.json`
});

const memory: MemoryHandle = openMemory({ root });
const pages = await memory.listPages();
const stats = await memory.statusOf();
const answer = await memory.query({
  question: "how does reconcile detect stale pages?",
  budget: 4000
});

const { server, stop } = await startMemoryMcpServer(memory, { allowWrites: false });
// ...
await stop();
```

### Low-level API

Use the free functions when you need one-off access to a specific root or are building your own abstraction around the package.

#### Resolving the memory root

`resolveMemoryRoot(cwd)` returns the default layout `<cwd>/.poe-code/memory`. Use `resolveConfiguredMemoryRoot` to honour the `POE_CODE_MEMORY_ROOT` env var and `memory.root` config knob:

```ts
import { promises as nodeFs } from "node:fs";

const root = await resolveConfiguredMemoryRoot({
  cwd: process.cwd(),
  env: process.env,
  fs: nodeFs,
  configPath: `${process.env.HOME}/.poe-code/config.json`,
  projectConfigPath: `${process.cwd()}/.poe-code/config.json`
});
```

#### Reading

```ts
const root: MemoryRoot = resolveMemoryRoot(process.cwd());
await initMemory(root);

const pages = await listPages(root);
const page = await readPage(root, "pages/architecture.md");
const hits: SearchHit[] = await searchMemory(root, "superintendent phases");
const stats = await statusOf(root);
```

#### Writing

```ts
await writePage(root, "pages/packages/memory.md", body, { reason: "initial draft" });
await appendToPage(root, "pages/LOG.md", "- noted flake\n");
```

#### Agent-backed operations

`ingest`, `queryMemory`, and `explainPage` resolve an agent from config and spawn it directly.

```ts
const answer: QueryResult = await queryMemory(root, {
  question: "how does reconcile detect stale pages?",
  budget: 4000
});

const explanation = await explainPage(root, {
  relPath: "pages/architecture.md",
  budget: 2000
});
```

#### Embedding the MCP server

```ts
const memory = openMemory({ root });
const { server, stop } = await startMemoryMcpServer(memory, { allowWrites: false });
// ...
await stop();
```

#### Notes

- All write helpers are opt-in: the caller supplies `reason` text that flows into `LOG.md`.
- `ingest` returns a cache hit when the source hash matches a previous run; pass `force: true` to bypass.
- `startMemoryMcpServer` returns the same stdio server that `poe-code memory-mcp` boots, so the tool surface is identical.

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
