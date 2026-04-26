---
$schema: 'https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json'
kind: pipeline
version: 1
tasks:
  - id: phase-1-spawn-mock-helper
    title: Phase 1 — createSpawnMock helper in @poe-code/agent-spawn/testing
    prompt: >
      Goal: ship a shared test helper for mocking `@poe-code/agent-spawn` at the
      module

      boundary, used by every downstream consumer (memory included). Pure
      addition.


      ## Files to create


      - `packages/agent-spawn/src/testing.ts`

      - `packages/agent-spawn/src/testing.test.ts`


      ## Files to change


      - `packages/agent-spawn/package.json` — add `"./testing"` subpath to
      `exports`:
        `{ "import": "./dist/testing.js", "types": "./dist/testing.d.ts" }`. Confirm
        `tsconfig.json` already emits `dist/testing.{js,d.ts}` (default tsc behaviour).

      ## Public surface


      ```ts

      // packages/agent-spawn/src/testing.ts

      import type { Mock } from "vitest";

      import type { SpawnResult, AutonomousResult } from "./types.js";


      export type SpawnMockOptions = {
        spawnResult?: Partial<SpawnResult>;
        autonomousResult?: Partial<AutonomousResult>;
      };


      export type SpawnMock = {
        factory: () => { spawn: unknown };  // shape acceptable to vi.mock
        spawn: Mock;
        autonomous: Mock;
      };


      export function createSpawnMock(opts?: SpawnMockOptions): SpawnMock;

      ```


      Behaviour:


      - Default `spawn` resolves to `{ exitCode: 0, durationMs: 0, stdout: "",
      stderr: "" }`.

      - Default `autonomous` resolves to a sensible empty `AutonomousResult`.

      - `factory()` returns an object accepted by
        `vi.mock("@poe-code/agent-spawn", () => spawnMock.factory())`.
      - `spawn.mockResolvedValueOnce(...)` and
      `autonomous.mockResolvedValueOnce(...)`
        both work for per-test customization.
      - The `spawn` and `autonomous` mocks are independent (no cross-talk).


      Use `import type { Mock } from "vitest"` only — do not pull vitest into
      the runtime

      bundle. The factory function instantiates `vi.fn()` lazily so vitest is
      only

      required at test time.


      ## Tests (`packages/agent-spawn/src/testing.test.ts`)


      | Test | Proves |

      | --- | --- |

      | `createSpawnMock()` returns `{ factory, spawn, autonomous }` | shape |

      | default `spawn` resolves to safe defaults | safe default |

      | `spawn.mockResolvedValueOnce(...)` overrides next call | per-test
      customization works |

      | `factory()` shape is acceptable to `vi.mock` (smoke test) | wiring works
      |

      | autonomous mock independent of spawn mock | no cross-talk |


      ## Acceptance


      - `npm test --workspace @poe-code/agent-spawn` is green.

      - No consumer migration yet — purely additive.

      - Memory tests still mock spawn the old way (untouched in this phase).


      ## Constraints


      - TDD per CLAUDE.md.

      - No real FS in tests; no real LLM.

      - No bash scripts for setup.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: phase-2-memory-handle
    title: Phase 2 — openMemory handle in @poe-code/memory (no breaks)
    prompt: >
      Goal: introduce the closure-factory `openMemory({ root, agent? })` in

      `@poe-code/memory`. Pure addition — every existing free-function export
      still

      works. Internals unchanged. CLI untouched in this phase.


      ## Files to create


      - `packages/memory/src/handle.ts`

      - `packages/memory/src/handle.test.ts`


      ## Files to change


      - `packages/memory/src/index.ts` — add:
        - `export { openMemory } from "./handle.js"`
        - `export type { MemoryHandle, OpenMemoryOptions, StatusInfo, AuditCallOptions } from "./handle.js"`
      - `packages/memory/src/index.test.ts` — assert `openMemory`,
      `MemoryHandle`,
        `OpenMemoryOptions` are exported.

      ## Public surface (handle.ts)


      ```ts

      import type {
        ExplainResult, IngestOptions, IngestResult,
        MemoryDiff, MemoryPage, MemoryRoot, PageFrontmatter,
        QueryOptions, QueryResult, SearchHit, TokenStats
      } from "./types.js";

      import type { AuditClaimsOptions, PageAudit } from "./audit.js";

      import type { ExplainOptions } from "./explain.js";


      export type OpenMemoryOptions = {
        root: MemoryRoot;       // required, absolute
        agent?: string;         // default agent id for query/ingest/audit/explain
      };


      export type StatusInfo = {
        pageCount: number;
        totalBytes: number;
        lastWriteAt: string | null;
        initialized: boolean;
      };


      export type AuditCallOptions = AuditClaimsOptions & { repoRoot: string };


      export interface MemoryHandle {
        readonly root: MemoryRoot;

        listPages(): Promise<MemoryPage[]>;
        readPage(relPath: string): Promise<MemoryPage>;
        searchMemory(query: string): Promise<SearchHit[]>;
        statusOf(): Promise<StatusInfo>;
        computeTokenStats(): Promise<TokenStats>;
        explainPage(opts: Omit<ExplainOptions, "spawnFn">): Promise<ExplainResult>;

        writePage(
          relPath: string,
          body: string,
          opts: { reason: string; frontmatter?: PageFrontmatter }
        ): Promise<MemoryDiff>;
        appendToPage(
          relPath: string,
          content: string,
          opts: { reason: string }
        ): Promise<MemoryDiff>;
        clearMemory(): Promise<void>;

        query(opts: Omit<QueryOptions, "spawnFn">): Promise<QueryResult>;
        ingest(opts: Omit<IngestOptions, "spawnFn">): Promise<IngestResult>;
        auditClaims(opts: AuditCallOptions): Promise<PageAudit[]>;
      }


      export function openMemory(opts: OpenMemoryOptions): MemoryHandle;

      ```


      Implementation: pure closures over the existing free functions in
      `pages.ts`,

      `write.ts`, `search.ts`, `status.ts`, `query.ts`, `ingest.ts`, `audit.ts`,

      `tokens.ts`, `explain.ts`. Every free function already takes `root` as its
      first

      arg — handle methods just pre-bind it.


      Per-call `agent` precedence (must be preserved): per-call `agent` >

      handle-default `agent` > free-function internal default.


      ## Validation


      - `path.isAbsolute(opts.root)` must be true. Throw synchronously on
      construction:
        `Error("openMemory: root must be absolute, got " + opts.root)`.
      - Do **not** stat the filesystem in `openMemory()`. Handle creation is
      pure.
        Missing-root errors come from the first read/write call (existing behaviour).

      ## Out-of-scope for the handle


      - `editPage` (interactive `$EDITOR`) — stays CLI-only.

      - `reconcile`, `snapshot` — internal storage primitives, not user-facing.

      - `initMemory`, `installMemory` — stay free functions; handle requires
      existing root.


      ## Tests (`handle.test.ts`)


      Use memfs (per CLAUDE.md, never touch real FS).


      | Test | Proves |

      | --- | --- |

      | `openMemory` returns object with all interface methods | API surface
      complete |

      | `openMemory({ root: "./relative" })` throws synchronously with the exact
      message | absolute-path validation |

      | `handle.root` matches input | inspection works |

      | handle method calls underlying free function with bound root (mock
      pages.ts etc., assert call args) | binding correct |

      | two handles, different roots, write-then-read isolation via memfs | no
      cross-contamination |

      | per-call `agent` overrides handle default | precedence layer 1 wins |

      | handle default `agent` used when per-call absent | precedence layer 2
      wins |

      | neither set → underlying free function's existing default kicks in |
      precedence layer 3 unchanged |


      ## Acceptance


      - `npm test --workspace @poe-code/memory` is green.

      - All existing free-function exports still work (no removals in this
      phase).

      - `spawnFn?` plumbing untouched in this phase — that's phase 3.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: phase-3-drop-spawnfn
    title: >-
      Phase 3 — drop spawnFn? injection, depend on @poe-code/agent-spawn directly
    prompt: >
      Goal: replace the `spawnFn?` injection seam in `@poe-code/memory` with a
      direct

      runtime dependency on `@poe-code/agent-spawn`. Tests mock at the module
      boundary

      via `createSpawnMock()` from phase 1. This is the only breaking phase.


      ## Files to change


      - `packages/memory/package.json` — add `"@poe-code/agent-spawn": "*"` to
        `dependencies`.
      - `packages/memory/src/types.ts`:
        - Remove `export type SpawnFn<TResult = unknown>`.
        - Remove `spawnFn?: SpawnFn` field from `IngestOptions`, `QueryOptions`, and any
          other type that has it.
        - Remove `LintOptions` and `LintResult` (verified orphan types — no internal
          caller, no CLI binding; the actual function is `auditClaims` returning
          `PageAudit[]`).
      - `packages/memory/src/explain.ts` — remove `spawnFn?: SpawnFn` from
        `ExplainOptions`. Drop the `SpawnFn` import.
      - `packages/memory/src/query.ts` — replace
        `const result = await opts.spawnFn?.(agent, prompt) ?? { exitCode: 0, durationMs: 0 }`
        with `const result = await spawn(agent, prompt)`. Add
        `import { spawn } from "@poe-code/agent-spawn"`. Drop the `SpawnFn` cast/import.
      - `packages/memory/src/ingest.ts` — same pattern.

      - `packages/memory/src/audit.ts` and `packages/memory/src/explain.ts` —
      same
        pattern if they were doing the same thing.
      - `packages/memory/src/index.ts` — remove `SpawnFn`, `LintOptions`,
      `LintResult`
        from the type re-export list.
      - `packages/memory/src/{query,ingest,explain,audit}.test.ts` —
      top-of-file:

        ```ts
        import { createSpawnMock } from "@poe-code/agent-spawn/testing";
        const spawnMock = createSpawnMock();
        vi.mock("@poe-code/agent-spawn", () => spawnMock.factory());
        ```

        Replace per-test `spawnFn: vi.fn().mockResolvedValue(...)` passed via opts with
        `spawnMock.spawn.mockResolvedValueOnce(...)` and assert against
        `spawnMock.spawn` instead of a local fn. Coverage stays equivalent.
      - `packages/memory/src/index.test.ts` — add regression guard: `SpawnFn`,
        `LintOptions`, `LintResult` are NOT exported.

      ## Behaviour change to flag


      Today, callers that omit `spawnFn` get a synthetic success result

      (`?? { exitCode: 0, durationMs: 0 }`). After this change, `spawn` is
      always

      invoked. Production callers always provided `spawnFn` (or the CLI which
      sets it

      up), so this only affects tests — tests now mock at the module level via

      `createSpawnMock()` from phase 1.


      ## Pre-flight grep


      After the changes, run `grep -rn "spawnFn" packages src` and expect zero
      hits

      outside the `createSpawnMock` helper itself. This confirms the seam is
      gone.


      ## Acceptance


      - `npm test --workspace @poe-code/memory` is green.

      - `npm test` (root) is green.

      - The CLI still produces identical external behaviour (it never relied on
      the
        synthetic-success branch — verify by running the existing CLI tests).
      - `grep -rn "spawnFn" packages src` returns zero hits outside
        `packages/agent-spawn/src/testing.ts`.

      ## Constraints


      - TDD per CLAUDE.md.

      - Mock at module boundary, not via per-call injection.

      - Phase 1 + 2 must be merged before this runs (this depends on
        `createSpawnMock` and `openMemory`).
    status:
      implement: done
      refactor: done
      test: done
      commit: open
  - id: phase-4-cli-mcp-migration
    title: Phase 4 — migrate CLI subcommands and MCP server to handle
    prompt: >
      Goal: switch `src/cli/commands/memory.ts` and `packages/memory/src/mcp.ts`
      to

      use the new `openMemory()` handle. End-user behaviour unchanged; internal
      wiring

      moves up one layer (CLI now calls `resolveConfiguredMemoryRoot()` itself
      instead

      of the library doing it implicitly — the library stops calling that
      helper).


      ## Files to change


      - `src/cli/commands/memory.ts` — at the start of every subcommand handler:

        ```ts
        const root = resolveConfiguredMemoryRoot();
        const mem = openMemory({ root });
        ```

        Then call handle methods (`mem.listPages()`, `mem.searchMemory(q)`,
        `mem.statusOf()`, `mem.clearMemory()`, etc.). The `init` subcommand keeps
        calling the free `initMemory({ root })` since the handle requires an existing
        root.

        Existing subcommand list (do not add or remove any): `init`, `ls`, `show`,
        `search`, `status`, `clear`, `memory-mcp`.

      - `packages/memory/src/mcp.ts` — change signature:

        ```ts
        // before
        export type McpServerOptions = { root: MemoryRoot; allowWrites: boolean };
        export function startMemoryMcpServer(opts: McpServerOptions): Promise<void>;

        // after
        export function startMemoryMcpServer(
          handle: MemoryHandle,
          opts: { allowWrites: boolean }
        ): Promise<void>;
        // McpServerOptions removed (verify nothing else imports it)
        ```

        Internal MCP tool registrations switch from `listPages(root)` to
        `handle.listPages()`, etc. `printMcpConfig` stays a free function (it just
        emits config JSON).

      - `src/cli/commands/memory.test.ts` — update mocks to match the new
      internal call
        pattern. Mock `resolveConfiguredMemoryRoot` to return a memfs-backed path.
        Where any subcommand becomes agent-backed in future, use `createSpawnMock()`.
      - `packages/memory/README.md` — lead with the `openMemory` example; demote
      the
        free-function examples to a "Low-level API" section. Document the
        `startMemoryMcpServer(handle, { allowWrites })` shape.

      ## Acceptance


      - `npm test` (root) green.

      - `npm run e2e:verbose` smoke check passes.

      - Manual QA:

        ```bash
        npm run dev -- memory ls
        npm run dev -- memory query "what does ingest do?"
        npm run dev -- memory ingest docs/plans/memory-multi-instance.md

        npm run screenshot-poe-code -- memory ls
        npm run screenshot-poe-code -- memory --help
        ```

        Output and visual rendering match the pre-change behaviour.

      ## Constraints


      - TDD per CLAUDE.md.

      - Defaults are only accepted with `--yes` (existing rule, don't regress).

      - Do not change subcommand surface or flags.

      - Phase 3 must be merged before this runs (this depends on the spawnFn?
      removal
        having landed so the CLI's call sites are clean).
    status:
      implement: open
      refactor: open
      test: open
      commit: open
---

# Context

Pipeline plan for executing `docs/plans/memory-multi-instance.md` — make
`@poe-code/memory` a real library with a closure-factory `openMemory()` entry
point, multi-memory support, direct `@poe-code/agent-spawn` dependency, and a
shared `createSpawnMock()` test helper.

The canonical 5-level plan lives at `docs/plans/memory-multi-instance.md`. The
tasks above mirror its phase ordering (5.4) so each task is independently
mergeable and ends with a green branch.

## Task ordering

The phases must run sequentially: phase 2 depends on phase 1's helper being
available for downstream test migrations later, and phase 3 cannot run until
both phase 1 and phase 2 are merged. Phase 4 needs phase 3 (clean spawn call
sites) before the CLI is moved over.

## Per-phase exit criteria

| Phase | Green test command | Pre-flight grep |
| --- | --- | --- |
| 1 | `npm test --workspace @poe-code/agent-spawn` | n/a |
| 2 | `npm test --workspace @poe-code/memory` | n/a |
| 3 | `npm test --workspace @poe-code/memory` then `npm test` (root) | `grep -rn "spawnFn" packages src` returns zero hits outside `packages/agent-spawn/src/testing.ts` |
| 4 | `npm test` (root) and `npm run e2e:verbose` | n/a |

## Things that must NOT change

- `resolveConfiguredMemoryRoot()`, `MEMORY_ROOT_ENV_VAR`, the `memory.root` config
  key, or the cascade order. The CLI is the only consumer; the library no longer
  calls it.
- On-disk layout: `INDEX.md`, `LOG.md`, `pages/`, `.lock`, `.cache/ingest/`. No
  migration.
- Storage-layer free-function exports — they keep working for any current caller.
- `initMemory`, `installMemory`, `editPage` — stay free functions for the reasons
  spelled out in the plan.

## Reference

For full design rationale, edge cases, type signatures, test tables, and rollout
detail, see `docs/plans/memory-multi-instance.md`. Each task above is
self-contained — it does not require reading the plan to execute — but the plan
is the source of truth for any ambiguity.

# Memory: closure-factory handle + multi-instance support

Make `@poe-code/memory` a real library — caller passes the path at instantiation, multiple memories per project, agent-backed methods call `spawn` from `@poe-code/agent-spawn` directly with a shared test helper.

## 1. What we're building

- Closure-factory entry point: `openMemory({ root, agent? })` returns a `MemoryHandle` with all storage + agent-backed methods bound.
- Multiple independent memories per project — each handle owns its own root, INDEX, LOG, lock. The library is dumb about "namespaces"; multi-memory is a caller concern.
- The path is defined by the **entry point**: `openMemory` requires an absolute `root` and does not fall back to `resolveConfiguredMemoryRoot()`. Ambient resolution stays available as a separate exported helper for the CLI to call at the boundary.
- Drop the `spawnFn` injection abstraction. Memory imports `spawn` from `@poe-code/agent-spawn` directly; tests mock at the module boundary using a new shared helper `createSpawnMock()` exported from `@poe-code/agent-spawn/testing`.
- Existing free-function exports (`listPages`, `writePage`, …) stay, so today's callers keep working.

### Non-goals

- Named registry / config schema for multi-memory ("list of memories per project"). Out of scope — hosts can build a registry on top of `openMemory`.
- Removing `resolveConfiguredMemoryRoot()`, `MEMORY_ROOT_ENV_VAR`, or the env var fallback. Those stay; only the *library internals* stop calling them.
- Migrating every existing test file in the monorepo to `createSpawnMock()`. The helper ships here; adoption elsewhere is a follow-up refactor.

## 2. User-facing shape

### 2.1. Import

```ts
import { openMemory } from "poe-code/memory";
import type { MemoryHandle, OpenMemoryOptions } from "poe-code/memory";
```

The package is re-exported from `poe-code` under the `poe-code/memory` subpath. Internal monorepo callers can also import from `@poe-code/memory` directly.

### 2.2. Open a single memory

```ts
import { openMemory, resolveConfiguredMemoryRoot } from "poe-code/memory";

const mem = openMemory({
  root: resolveConfiguredMemoryRoot(),     // ambient resolution, callsite owns it
  agent: "poe-agent:openai/gpt-5.4"        // optional default for query/ingest
});

console.log(mem.root);                     // exposed for logging/inspection
```

`root` is required and must be absolute. Non-absolute throws synchronously:

```ts
openMemory({ root: "./memory" });
// → Error: openMemory: root must be absolute, got ./memory
```

### 2.3. Multiple memories side by side

```ts
const arch = openMemory({ root: "/repo/.poe-code/memory/architecture" });
const runbooks = openMemory({ root: "/repo/.poe-code/memory/runbooks" });

await arch.writePage("pages/auth.md", body, { reason: "extracted from PR #102" });
await runbooks.listPages();   // independent — does not see arch's pages
```

Each handle owns its own `INDEX.md`, `LOG.md`, `pages/`, and `.lock`. Concurrent writes across handles to overlapping roots is a caller bug, not the library's responsibility.

### 2.4. Read methods

```ts
const pages = await mem.listPages();
const page = await mem.readPage("pages/architecture.md");
const hits = await mem.searchMemory("ingest pipeline");
const status = await mem.statusOf();
const tokens = await mem.computeTokenStats();
```

### 2.5. Write methods

```ts
const diff = await mem.writePage("pages/notes.md", body, {
  reason: "ingest from PR #42",
  frontmatter: { name: "Notes", description: "Loose notes" }
});
//   → MemoryDiff { created, updated, deleted }

await mem.appendToPage("pages/log.md", "- new entry\n", {
  reason: "manual append"
});

await mem.clearMemory();    // remove all pages, re-init structure
```

`reason` is required on `writePage` / `appendToPage` and gets logged into `LOG.md`. `clearMemory()` takes no options (it's a structural reset, not a content edit).

### 2.6. Agent-backed methods (spawn called directly, no `spawnFn`)

```ts
const result = await mem.query({
  question: "How does ingest dedup?",
  budget: 4000
});
//   → { answer, citations, tokensUsed, budget, exitCode }

const ingestResult = await mem.ingest({
  source: { kind: "file", absPath: "/repo/docs/PR-42.md" },
  reason: "PR #42 architectural notes"
});

const audits = await mem.auditClaims({
  repoRoot: "/repo",                    // where source paths in <!-- memory:extracted source=... --> resolve
  minInferredConfidence: 0.7
});
//   → PageAudit[] { page, issues[] }
```

`auditClaims` takes `repoRoot` per-call (required) — it's the project root that source-ref claims resolve against, not the memory root. Caller passes `process.cwd()` (CLI), or whichever repo root applies to the source files those claims point to.

The handle's `agent` default flows in. Per-call `agent` overrides:

```ts
await mem.query({
  question: "...",
  budget: 4000,
  agent: "poe-agent:anthropic/claude-sonnet-4-6"
});
```

Internally these call `spawn` from `@poe-code/agent-spawn` directly. There is no `spawnFn?` field on any options type — those have been removed.

### 2.7. Init (free function)

`initMemory` stays a free function — you can't open a handle on a memory that doesn't exist yet, so init lives outside the handle:

```ts
import { initMemory, openMemory } from "poe-code/memory";

await initMemory("/repo/.poe-code/memory");
const mem = openMemory({ root: "/repo/.poe-code/memory" });
```

`reconcile` and `snapshot` are internal storage primitives (used by `writePage`/`appendToPage` to compute diffs) and are **not** on the handle. `editPage` (interactive `$EDITOR`) stays CLI-only and is also not on the handle.

### 2.8. MCP server takes a handle

```ts
import { startMemoryMcpServer } from "poe-code/memory";

await startMemoryMcpServer(mem, { allowWrites: true });
```

The previous `{ root, allowWrites }` shape is replaced by `(handle, { allowWrites })`. The MCP tools internally call handle methods.

### 2.9. CLI: unchanged surface

The CLI's existing subcommand set:

```bash
poe-code memory init
poe-code memory ls
poe-code memory show <relPath>
poe-code memory search <query>
poe-code memory status
poe-code memory clear
poe-code memory-mcp [--print-mcp-config] [--allow-writes]
```

What changes inside each subcommand handler: instead of free-function calls (`listPages(root)`), the handler resolves the ambient root via `resolveConfiguredMemoryRoot()`, opens a handle, and calls handle methods. End-user behavior is identical; only the internal wiring moves.

### 2.10. Test helper for downstream consumers

Anyone consuming `@poe-code/agent-spawn` (memory included) gets a shared mock:

```ts
import { createSpawnMock } from "@poe-code/agent-spawn/testing";
import { vi } from "vitest";

const spawnMock = createSpawnMock();
vi.mock("@poe-code/agent-spawn", () => spawnMock.factory());

it("calls spawn with the configured agent", async () => {
  spawnMock.spawn.mockResolvedValueOnce({
    exitCode: 0, durationMs: 12, stdout: "ok", stderr: ""
  });

  await mem.query({ question: "x", budget: 4000 });

  expect(spawnMock.spawn).toHaveBeenCalledWith(
    "poe-agent:openai/gpt-5.4",
    expect.stringContaining("# Memory index")
  );
});
```

Replaces ~10 lines of per-file `vi.mock(...)` boilerplate currently duplicated across the monorepo.

## 3. Implementation details and technical decisions

### 3.1. Architecture

Two packages change.

**`packages/memory/`** — gains a thin handle layer on top of existing free functions, drops the `spawnFn?` injection seam, gains a runtime dependency on `@poe-code/agent-spawn`.

- New file: `packages/memory/src/handle.ts` — `openMemory()`, `MemoryHandle`, `OpenMemoryOptions`. Pure closures over the existing free functions in `pages.ts`, `write.ts`, `search.ts`, `status.ts`, `reconcile.ts`, `query.ts`, `ingest.ts`, `audit.ts`, `tokens.ts`. Every existing free function already takes `root` as its first arg, so the handle is mechanical wrapping — no new logic.
- Edited: `packages/memory/src/index.ts` — export `openMemory`, `MemoryHandle`, `OpenMemoryOptions`. Keep all free-function exports.
- Edited: `packages/memory/src/types.ts` — remove `SpawnFn` type entirely; remove `spawnFn?` from `IngestOptions`, `QueryOptions`, `LintOptions` (and any others that have it).
- Edited: `packages/memory/src/ingest.ts`, `query.ts`, `explain.ts`, `audit.ts` — replace `opts.spawnFn?.(agent, prompt)` with a direct `spawn(agent, prompt)` call from `@poe-code/agent-spawn`. Remove the no-op fallback (`?? Promise.resolve({ exitCode: 0, durationMs: 0 })`); spawn is always called.
- Edited: `packages/memory/src/mcp.ts` — `startMemoryMcpServer` accepts `(handle: MemoryHandle, opts: { allowWrites: boolean })`. Internal MCP tools call handle methods. `printMcpConfig` stays a free function (it just emits config JSON, doesn't touch storage).
- Edited: `packages/memory/package.json` — add `"@poe-code/agent-spawn": "*"` to `dependencies`.

**`packages/agent-spawn/`** — gains a `/testing` subpath export with a shared mock.

- New file: `packages/agent-spawn/src/testing.ts` — `createSpawnMock()` factory + types.
- Edited: `packages/agent-spawn/package.json` — add `"./testing"` to `exports` map.
- Edited: `packages/agent-spawn/tsconfig.json` if needed so `dist/testing.{js,d.ts}` ships.

**`src/cli/commands/memory.ts`** — at the start of every subcommand handler, resolve the root via `resolveConfiguredMemoryRoot()` and open a handle. All subsequent calls go through the handle. `init` stays a free `initMemory({ root })` call before the handle exists.

### 3.2. What stays unchanged

- `resolveConfiguredMemoryRoot()`, `MEMORY_ROOT_ENV_VAR`, the `memory.root` config key, the cascade order. The CLI is the only consumer; the library no longer calls it.
- `initMemory({ root })` — still a free function; called before the first handle.
- `installMemory` — free function (one-shot setup, conceptually below "open a memory").
- `editPage` — CLI-only, stays out of the handle (per level 2 decision).
- All on-disk layout: `INDEX.md`, `LOG.md`, `pages/`, `.lock`, `.cache/ingest/`. No migration.
- Storage-layer free-function exports (`listPages`, `writePage`, …). They keep working for any current caller.

### 3.3. Edge cases

- **Non-absolute root.** `openMemory({ root: "./memory" })` throws synchronously with a clear message. Validated via `path.isAbsolute(root)`. No async, no first-method-call surprise.
- **Root doesn't exist yet.** `openMemory()` does **not** stat the filesystem. Handle creation is pure. The first read/write method that hits a missing root produces the same error today's free functions already produce. Caller is expected to `initMemory()` first when needed; this is symmetrical with how `initMemory()` is the official "create the structure" entry point.
- **Two handles on the same root.** Allowed. The existing `.lock` already serializes writes at the filesystem level; concurrent reads are safe. We don't add in-process coordination — that would be duplicative.
- **Per-call `agent` resolution.** Order: per-call `agent` > handle default `agent` > implementation-internal default (the existing fallback in `query.ts`/`ingest.ts`). All three layers must be preserved; the handle adds one new layer between per-call and implementation-internal.
- **Removing the spawn no-op fallback is a behavior change.** Today, callers that omit `spawnFn` get a synthetic success result. After this change, `spawn` is always invoked. Production callers always provided `spawnFn` (or were the CLI which sets it up), so this is only relevant for tests — and tests now mock at the module level instead. No production caller is affected, but any test that relied on the implicit no-op must migrate to `createSpawnMock()`.
- **MCP server signature change is a breaking API change** for `startMemoryMcpServer`. Internal callers: `src/cli/commands/memory.ts`. Search shows no other internal callers. Public consumers via `poe-code/memory`: documented as a minor-version break in the package changelog; the migration is mechanical (`{ root, allowWrites }` → `(openMemory({ root }), { allowWrites })`).
- **Handle is `Readonly`.** `MemoryHandle` is declared as `interface` with all-readonly methods (TS makes function-valued properties non-mutable by default through interface declaration; we additionally type `root` as `readonly`). No method swapping post-construction.

### 3.4. Flags, env vars, config

No new flags or env vars introduced. No default-on/off changes.

| Existing | Stays | Consumer after change |
| --- | --- | --- |
| `POE_CODE_MEMORY_ROOT` env var | yes | only `resolveConfiguredMemoryRoot()` reads it |
| `memory.root` in `.poe-code/config.json` | yes | only `resolveConfiguredMemoryRoot()` reads it |
| `memory.root` in global config | yes | only `resolveConfiguredMemoryRoot()` reads it |
| Default `<cwd>/.poe-code/memory` | yes | only `resolveConfiguredMemoryRoot()` returns it |

The library itself reads no env vars and no config files. Path comes from the entry point.

### 3.5. Open questions

- Open question: do we need a `mem.close()` / `dispose()` for symmetry, even if today's lock is per-call? Lean **no** — adds ceremony with no current need; can add later if a caller acquires real long-lived resources. (YAGNI.)
- Open question: should `openMemory()` also accept an optional pre-resolved `LoggerLike` for `LOG.md` writes, or is the existing append-with-timestamp behavior good enough? Lean **no change** — current behavior is fine, no caller has asked for injected logging.
- Open question: when removing `spawnFn?` from `QueryOptions` etc., do we keep those types exported for downstream typing, or rename? Lean **keep the names**, just remove the field — minimizes churn for any external consumer of the type names.

### 3.6. Risk

- Test-only risk: every memory test that invokes `query`/`ingest`/`audit`/`explain` has to switch from injecting `spawnFn` to `vi.mock` + `createSpawnMock()`. Mechanical, but it touches several files in one commit. Plan handles this in phase 1 alongside the spawn-helper landing — no orphan test pass with the helper missing.
- No production-runtime risk identified. The CLI is the only entry point that resolved root ambiently; that resolution moves up one layer (CLI calls `resolveConfiguredMemoryRoot()` instead of the library doing it implicitly) — same call, same result.

## 4. Interfaces and test plan

### 4.1. New module-boundary types

```ts
// packages/memory/src/handle.ts

import type {
  ExplainResult, IngestOptions, IngestResult,
  MemoryDiff, MemoryPage, MemoryRoot, PageAudit, PageFrontmatter,
  QueryOptions, QueryResult, SearchHit, TokenStats
} from "./types.js";
import type { AuditClaimsOptions } from "./audit.js";
import type { ExplainOptions } from "./explain.js";

export type OpenMemoryOptions = {
  root: MemoryRoot;     // required, absolute
  agent?: string;       // default agent id for query/ingest/audit/explain
};

export type StatusInfo = {
  pageCount: number;
  totalBytes: number;
  lastWriteAt: string | null;
  initialized: boolean;
};

export type AuditCallOptions = AuditClaimsOptions & { repoRoot: string };

export interface MemoryHandle {
  readonly root: MemoryRoot;

  // read
  listPages(): Promise<MemoryPage[]>;
  readPage(relPath: string): Promise<MemoryPage>;
  searchMemory(query: string): Promise<SearchHit[]>;
  statusOf(): Promise<StatusInfo>;
  computeTokenStats(): Promise<TokenStats>;
  explainPage(opts: Omit<ExplainOptions, "spawnFn">): Promise<ExplainResult>;

  // write — return MemoryDiff for caller introspection
  writePage(relPath: string, body: string, opts: { reason: string; frontmatter?: PageFrontmatter }): Promise<MemoryDiff>;
  appendToPage(relPath: string, content: string, opts: { reason: string }): Promise<MemoryDiff>;
  clearMemory(): Promise<void>;

  // agent-backed
  query(opts: Omit<QueryOptions, "spawnFn">): Promise<QueryResult>;
  ingest(opts: Omit<IngestOptions, "spawnFn">): Promise<IngestResult>;
  auditClaims(opts: AuditCallOptions): Promise<PageAudit[]>;
}

export function openMemory(opts: OpenMemoryOptions): MemoryHandle;
```

Notes:

- `reconcile()` and `snapshot()` from the existing free-function exports are internal storage primitives; they stay exported (back-compat) but are deliberately **not** on the handle.
- `auditClaims` takes `repoRoot` per-call rather than as a handle field. Rationale: most call sites pass `process.cwd()`, but adding a required field to `OpenMemoryOptions` would force every caller (including `mem.listPages()`-only consumers) to supply it. Per-call keeps `openMemory` minimal.
- `explainPage` takes the full `ExplainOptions` shape (which already nests `relPath` inside) minus `spawnFn`.

```ts
// packages/agent-spawn/src/testing.ts

import type { Mock } from "vitest";
import type { SpawnResult, AutonomousResult } from "./types.js";

export type SpawnMockOptions = {
  spawnResult?: Partial<SpawnResult>;
  autonomousResult?: Partial<AutonomousResult>;
};

export type SpawnMock = {
  factory: () => { spawn: SpawnFnMock };
  spawn: Mock;
  autonomous: Mock;
};

export function createSpawnMock(opts?: SpawnMockOptions): SpawnMock;
```

### 4.2. Type deletions

In `packages/memory/src/types.ts`:

- Remove `export type SpawnFn<TResult = unknown>` line.
- Remove `spawnFn?: SpawnFn` field from `IngestOptions`, `QueryOptions`, and any other type that has it.
- Remove `LintOptions` and `LintResult` entirely — verified orphan types (no internal caller, no CLI binding). The actual function is `auditClaims` returning `PageAudit[]`.
- `IngestOptions.agent`, `QueryOptions.agent` stay — meaningful per-call overrides.

In `packages/memory/src/explain.ts`:

- Remove `spawnFn?: SpawnFn` from `ExplainOptions`.
- Remove the `import ... SpawnFn ...` from `./types.js`.

In `packages/memory/src/index.ts`:

- Remove `SpawnFn`, `LintOptions`, `LintResult` from the type re-export list.

### 4.3. Cross-package signature changes

```ts
// packages/memory/src/mcp.ts

// before
export type McpServerOptions = { root: MemoryRoot; allowWrites: boolean };
export function startMemoryMcpServer(opts: McpServerOptions): Promise<void>;

// after
export function startMemoryMcpServer(
  handle: MemoryHandle,
  opts: { allowWrites: boolean }
): Promise<void>;
// McpServerOptions removed; not used elsewhere internally
```

```ts
// packages/memory/src/{query,ingest,audit,explain}.ts

// before
const spawnFn = opts.spawnFn as SpawnFn<...> | undefined;
const result = await spawnFn?.(agent, prompt) ?? { exitCode: 0, durationMs: 0 };

// after
import { spawn } from "@poe-code/agent-spawn";
const result = await spawn(agent, prompt);
```

### 4.4. Tests — unit

**`packages/memory/src/handle.test.ts`** (new). Proves the closure layer is correct.

| Test | Proves |
| --- | --- |
| `openMemory` returns object with all interface methods | API surface complete |
| `openMemory({ root: "./relative" })` throws synchronously | absolute-path validation |
| `handle.root` matches input | inspection works |
| handle method calls underlying free function with bound root | binding correct (mock `pages.ts` etc., assert call args) |
| two handles, different roots, write-then-read isolation via memfs | no cross-contamination |
| per-call `agent` overrides handle default | precedence layer 1 wins |
| handle default `agent` used when per-call absent | precedence layer 2 wins |
| neither set → underlying free function's existing default kicks in | precedence layer 3 unchanged |

**`packages/memory/src/{query,ingest,explain,audit}.test.ts`** (migrate). Each gets a top-of-file mock:

```ts
import { createSpawnMock } from "@poe-code/agent-spawn/testing";
const spawnMock = createSpawnMock();
vi.mock("@poe-code/agent-spawn", () => spawnMock.factory());
```

Existing test bodies migrate from `spawnFn: vi.fn().mockResolvedValue(...)` passed via opts to `spawnMock.spawn.mockResolvedValueOnce(...)` plus `expect(spawnMock.spawn).toHaveBeenCalledWith(agent, prompt)`. Coverage stays equivalent.

**`packages/agent-spawn/src/testing.test.ts`** (new). Proves the helper itself works.

| Test | Proves |
| --- | --- |
| `createSpawnMock()` returns `{ factory, spawn, autonomous }` | shape |
| default `spawn` resolves to `{ exitCode: 0, durationMs: 0, stdout: "", stderr: "" }` | safe default |
| `spawn.mockResolvedValueOnce(...)` overrides next call | per-test customization works |
| `factory()` shape is acceptable to `vi.mock` (typecheck-level proof + a smoke test) | wiring works |
| autonomous mock independent of spawn mock | no cross-talk |

**`packages/memory/src/index.test.ts`** (update). Add:

| Test | Proves |
| --- | --- |
| `openMemory`, `MemoryHandle`, `OpenMemoryOptions` are exported | new public surface present |
| `SpawnFn` is NOT exported (regression guard) | old surface removed |

### 4.5. Tests — CLI / integration

**`src/cli/commands/memory.test.ts`** (update). Each subcommand test:

- Mocks `resolveConfiguredMemoryRoot` to return a memfs-backed path.
- Mocks `@poe-code/agent-spawn` via `createSpawnMock()` for any subcommand that invokes agents (`query`, `ingest`, `lint`).
- Asserts the subcommand opens a handle and the right handle method is called.

No new e2e coverage required — existing e2e suite (`npm run e2e:verbose`) exercises the real CLI against a real `.poe-code/memory`. After phase 4, run it once to confirm zero regressions.

### 4.6. Manual QA (after phase 4)

```bash
# real LLM, real FS, real spawn — proves end-to-end works
npm run dev -- memory ls
npm run dev -- memory query "what does ingest do?"
npm run dev -- memory ingest docs/plans/memory-multi-instance.md

# visual check
npm run screenshot-poe-code -- memory ls
npm run screenshot-poe-code -- memory --help
```

### 4.7. Rollout / migration phases

Each phase is independently mergeable.

1. **Phase 1 — spawn-mock helper.** Add `packages/agent-spawn/src/testing.ts` + subpath export + tests. Pure addition. No consumer migration. Green.
2. **Phase 2 — handle, no breaks.** Add `packages/memory/src/handle.ts` + tests. Export from `index.ts`. Free functions and `spawnFn?` still work. CLI not migrated yet. Green.
3. **Phase 3 — drop `spawnFn?`.** Add `@poe-code/agent-spawn` to memory deps. Replace `opts.spawnFn?.(...)` with direct `spawn(...)`. Remove `SpawnFn` type and all `spawnFn?` fields. Migrate memory's own four agent-backed test files to `createSpawnMock()`. Breaking for external consumers (none known internally). Green.
4. **Phase 4 — CLI + MCP migration.** `src/cli/commands/memory.ts` opens a handle per subcommand. `startMemoryMcpServer(handle, { allowWrites })`. Update CLI tests + README. Green.

Pre-existing test files outside `packages/memory/` that use the inline `vi.mock("@poe-code/agent-spawn", ...)` boilerplate are **not** migrated as part of this plan — that's an opt-in cleanup, tracked separately.

### 4.8. Autonomy checklist

An agent should be able to take this plan from level 5 and ship phases 1–4 without further input. Required to be true:

- [x] Every new file path is named in level 3 / 5.
- [x] Every new type signature is in 4.1.
- [x] Every type deletion is in 4.2.
- [x] Every changed cross-package signature is in 4.3.
- [x] Every test name has a "what it proves" column.
- [x] Phase ordering is sequential and each phase is green-on-merge.
- [x] Mocking strategy is module-level via `createSpawnMock()` from a real package subpath, not ad-hoc per file.
- [x] No real FS in `*.test.ts` (memfs); no real LLM (mocked spawn).
- [x] Visual regression covered by `npm run screenshot-poe-code -- memory ls` after phase 4.
- [x] Breaking-change call-out: `startMemoryMcpServer` signature, `spawnFn?` removal, `SpawnFn` type removal — flagged in 3.3 and 4.7.
- [ ] Open: pre-flight check that no internal package outside the named callers imports `spawnFn` from memory's option types (run `grep -rn "spawnFn" packages src` after each phase to confirm scope).

Concrete failure modes to verify in tests, not just docs:

- `openMemory({ root: "./relative" })` → throws `"openMemory: root must be absolute, got ./relative"`.
- Two handles, write to A, `B.listPages()` returns no pages from A.
- After phase 3, no test depends on the old no-op fallback (`spawnFn` undefined → synthetic success). Each agent-backed test must explicitly mock spawn.

## 5. Code plan

### 5.1. Files to create

| File | Purpose |
| --- | --- |
| `packages/memory/src/handle.ts` | Closure-factory entry point. Exports `openMemory`, `MemoryHandle`, `OpenMemoryOptions`, `StatusInfo`, `AuditCallOptions`. Pure wiring — every method is a closure over a free function with `root` pre-bound. |
| `packages/memory/src/handle.test.ts` | Memfs-backed unit tests for the wrapping behavior. |
| `packages/agent-spawn/src/testing.ts` | `createSpawnMock()` factory + `SpawnMockOptions`/`SpawnMock` types. Imports `vitest` types only via `import type`. |
| `packages/agent-spawn/src/testing.test.ts` | Tests for the helper itself (default values, override-once, factory shape). |

### 5.2. Files to change

| File | Change |
| --- | --- |
| `packages/memory/src/index.ts` | Add `export { openMemory } from "./handle.js"`. Add `export type { MemoryHandle, OpenMemoryOptions, StatusInfo, AuditCallOptions } from "./handle.js"`. Remove `SpawnFn`, `LintOptions`, `LintResult` from the type re-export list. |
| `packages/memory/src/types.ts` | Remove `export type SpawnFn`. Remove `spawnFn?: SpawnFn` from `IngestOptions`, `QueryOptions`. Remove `LintOptions`, `LintResult` (orphan types). |
| `packages/memory/src/explain.ts` | Remove `spawnFn?: SpawnFn` from `ExplainOptions`. Drop the `SpawnFn` import. Inside `explainPage`, the call is already proxied through `queryMemory`, which itself stops accepting `spawnFn` — so the `spawnFn` plumbing here just disappears. |
| `packages/memory/src/query.ts` | `import { spawn } from "@poe-code/agent-spawn"`. Replace `const spawnFn = options.spawnFn; const result = await spawnFn?.(agent, prompt) ?? { exitCode: 0, durationMs: 0 }` with `const result = await spawn(agent, prompt)`. Drop the `SpawnFn` cast and import. |
| `packages/memory/src/ingest.ts` | Same pattern as `query.ts`. |
| `packages/memory/src/mcp.ts` | Change `startMemoryMcpServer` signature: `(handle: MemoryHandle, opts: { allowWrites: boolean }): Promise<void>`. Remove `McpServerOptions` type if unused elsewhere. Internal MCP tool registrations switch from `listPages(root)` etc. to `handle.listPages()`. |
| `packages/memory/src/{query,ingest,explain}.test.ts` | Top-of-file: `const spawnMock = createSpawnMock(); vi.mock("@poe-code/agent-spawn", () => spawnMock.factory());`. Replace per-test `spawnFn: vi.fn()...` with `spawnMock.spawn.mockResolvedValueOnce(...)`. Assertions move from the local `spawnFn` to `spawnMock.spawn`. |
| `packages/memory/src/index.test.ts` | Assert `openMemory`, `MemoryHandle`, `OpenMemoryOptions` are exported. Assert `SpawnFn`, `LintOptions`, `LintResult` are **not** exported. |
| `packages/memory/package.json` | Add `"@poe-code/agent-spawn": "*"` to `dependencies`. |
| `packages/agent-spawn/package.json` | Add `"./testing"` subpath to `exports`: `{ "import": "./dist/testing.js", "types": "./dist/testing.d.ts" }`. Confirm `tsconfig.json` outputs `dist/testing.{js,d.ts}` (default `tsc` setup already does). |
| `src/cli/commands/memory.ts` | Each `.action(async () => { ... })` body opens `const mem = openMemory({ root: resolveConfiguredMemoryRoot() })` once at the top, then calls handle methods. The `init` subcommand keeps calling the free `initMemory(root)` since the handle requires an existing root. |
| `src/cli/commands/memory.test.ts` | Update test mocks to match the new internal call pattern. Use `createSpawnMock()` for any subcommand that ends up agent-backed in future (none today, but the helper is ready). |
| `packages/memory/README.md` | Update the "Programmatic usage" section to show `openMemory` first; demote free-function examples to a "Low-level API" section. |

### 5.3. Function signatures (new + modified)

```ts
// packages/memory/src/handle.ts — new

export type OpenMemoryOptions = {
  root: MemoryRoot;
  agent?: string;
};

export type StatusInfo = {
  pageCount: number;
  totalBytes: number;
  lastWriteAt: string | null;
  initialized: boolean;
};

export type AuditCallOptions = AuditClaimsOptions & { repoRoot: string };

export interface MemoryHandle {
  readonly root: MemoryRoot;
  listPages(): Promise<MemoryPage[]>;
  readPage(relPath: string): Promise<MemoryPage>;
  searchMemory(query: string): Promise<SearchHit[]>;
  statusOf(): Promise<StatusInfo>;
  computeTokenStats(): Promise<TokenStats>;
  explainPage(opts: Omit<ExplainOptions, "spawnFn">): Promise<ExplainResult>;
  writePage(relPath: string, body: string, opts: { reason: string; frontmatter?: PageFrontmatter }): Promise<MemoryDiff>;
  appendToPage(relPath: string, content: string, opts: { reason: string }): Promise<MemoryDiff>;
  clearMemory(): Promise<void>;
  query(opts: Omit<QueryOptions, "spawnFn">): Promise<QueryResult>;
  ingest(opts: Omit<IngestOptions, "spawnFn">): Promise<IngestResult>;
  auditClaims(opts: AuditCallOptions): Promise<PageAudit[]>;
}

export function openMemory(opts: OpenMemoryOptions): MemoryHandle;
```

```ts
// packages/agent-spawn/src/testing.ts — new

import type { Mock } from "vitest";
import type { SpawnResult, AutonomousResult } from "./types.js";

export type SpawnMockOptions = {
  spawnResult?: Partial<SpawnResult>;
  autonomousResult?: Partial<AutonomousResult>;
};

export type SpawnMock = {
  factory: () => { spawn: ReturnType<typeof Object.assign> };
  spawn: Mock;
  autonomous: Mock;
};

export function createSpawnMock(opts?: SpawnMockOptions): SpawnMock;
```

```ts
// packages/memory/src/mcp.ts — modified

export function startMemoryMcpServer(
  handle: MemoryHandle,
  opts: { allowWrites: boolean }
): Promise<void>;
```

```ts
// packages/memory/src/{query,ingest,explain}.ts — modified call site

import { spawn } from "@poe-code/agent-spawn";

// …
const result = await spawn(agentId, prompt);
// no fallback, no spawnFn cast, no synthetic-success branch
```

### 5.4. Build order (each phase keeps the branch green)

**Phase 1 — spawn-mock helper.**

1. Create `packages/agent-spawn/src/testing.ts` and `testing.test.ts`.
2. Add `"./testing"` subpath to `packages/agent-spawn/package.json`.
3. `npm test --workspace @poe-code/agent-spawn` → green. No consumer migration yet.

**Phase 2 — memory handle (no breaks).**

1. Create `packages/memory/src/handle.ts` and `handle.test.ts`.
2. Add `openMemory` + types to `packages/memory/src/index.ts`.
3. Update `index.test.ts` to assert the new exports exist.
4. `npm test --workspace @poe-code/memory` → green. Free functions and `spawnFn?` still work; CLI untouched.

**Phase 3 — drop `spawnFn?` (single breaking commit).**

1. Add `"@poe-code/agent-spawn": "*"` to `packages/memory/package.json`.
2. Edit `query.ts`, `ingest.ts`, `explain.ts` to import `spawn` directly. Remove the `spawnFn?` plumbing.
3. Remove `SpawnFn` type, `spawnFn?` fields, `LintOptions`, `LintResult` from `types.ts`. Remove the same from `index.ts` exports.
4. Migrate `query.test.ts`, `ingest.test.ts`, `explain.test.ts` to module-level mock via `createSpawnMock()`.
5. Update `index.test.ts` to add the regression check ("`SpawnFn` is not exported").
6. `npm test --workspace @poe-code/memory` → green. The CLI still uses free functions and produces the same external behavior because `spawnFn` was never set in the CLI's call path.
7. `grep -rn "spawnFn" packages src` → expect zero hits outside the testing helper. (Pre-flight from level 4.8 autonomy checklist.)

**Phase 4 — CLI + MCP migration.**

1. Edit `src/cli/commands/memory.ts`: each subcommand handler opens a handle once, then calls handle methods.
2. Edit `packages/memory/src/mcp.ts`: `startMemoryMcpServer(handle, { allowWrites })`. (No internal CLI caller to update — `memory-mcp` subcommand isn't currently registered in `src/`.)
3. Update `src/cli/commands/memory.test.ts` mocks.
4. Update `packages/memory/README.md`: handle example first, free-function example demoted.
5. `npm test` (root) → green.
6. `npm run e2e:verbose` → smoke check.
7. Manual QA per 4.6.

### 5.5. Out-of-band cleanup (not part of this plan)

A separate refactor PR can adopt `createSpawnMock()` across the ten+ existing test files in the monorepo that currently inline the `vi.mock("@poe-code/agent-spawn", () => ({ spawn: Object.assign(vi.fn(), { autonomous: ... }) }))` boilerplate. Listed in level 4.7 as out of scope; mentioned here so it doesn't get lost.
