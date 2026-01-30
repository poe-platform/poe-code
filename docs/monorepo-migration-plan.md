# poe-code Monorepo Migration Plan

## Overview

Migrate poe-code from a single npm package to a **pnpm workspaces** monorepo structure. Internal packages remain private (unpublished) but enable clean module boundaries and partial imports.

## User Experience Impact

| Aspect | Before | After | Breaking? |
|--------|--------|-------|-----------|
| Install | `npm i poe-code` | `npm i poe-code` | No |
| CLI usage | `poe-code configure` | `poe-code configure` | No |
| SDK import | `import { spawn } from "poe-code"` | `import { spawn } from "poe-code"` | No |
| SDK-only install | Not possible | `npm i @poe-code/sdk` (future) | N/A |
| MCP-only install | Not possible | `npm i @poe-code/mcp` (future) | N/A |

**No breaking changes** - the main `poe-code` package re-exports everything for backward compatibility.

---

## Proposed Package Structure

```
packages/
├── test-utils/          # @poe-code/test-utils (internal, private)
├── types/               # @poe-code/types (internal, private)
├── utils/               # @poe-code/utils (internal, private)
├── core/                # @poe-code/core (internal, private)
├── providers/           # @poe-code/providers (internal, private)
├── sdk/                 # @poe-code/sdk (maybe publish later)
├── mcp/                 # @poe-code/mcp (maybe publish later)
└── cli/                 # poe-code (the ONLY published package)
```

### Dependency Graph

```
                    poe-code (CLI)
                         │
        ┌────────────────┼────────────────┐
        │                │                │
        ▼                ▼                ▼
   @poe-code/sdk   @poe-code/mcp   (CLI commands)
        │                │                │
        └────────────────┼────────────────┘
                         │
                         ▼
                  @poe-code/providers
                         │
                         ▼
                    @poe-code/core
                         │
                         ▼
                   @poe-code/utils
                         │
                         ▼
                   @poe-code/types

Testing (separate):
                  @poe-code/test-utils
                         │
                    (depends on types only)
```

---

## Worked Example: @poe-code/test-utils

This demonstrates the migration pattern for all packages.

### Current Structure
```
tests/
├── helpers/
│   ├── snapshot-client.ts    # LlmClient wrapper for recording/playback
│   ├── snapshot-store.ts     # CRUD operations for snapshots
│   ├── snapshot-config.ts    # Env var parsing
│   ├── http-client.ts        # Node HTTP client implementation
│   └── mcp-test-harness.ts   # MCP testing utilities
├── setup.ts                  # Global vitest setup
├── test-helpers.ts           # memfs helpers
└── template-fixtures.ts      # Template mocks
```

### Current Dependencies (Problem)
```typescript
// tests/helpers/snapshot-client.ts
import type { FileSystem } from "../../src/utils/file-system.js";     // ← depends on src
import type { LlmClient } from "../../src/services/llm-client.js";    // ← depends on src

// tests/helpers/http-client.ts
import type { HttpClient } from "../../src/cli/http.js";              // ← depends on src
```

### Target Structure
```
packages/test-utils/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts
    ├── snapshot-client.ts
    ├── snapshot-store.ts
    ├── snapshot-config.ts
    ├── http-client.ts
    ├── mcp-test-harness.ts
    ├── memfs-helpers.ts
    └── template-fixtures.ts
```

### Target package.json
```json
{
  "name": "@poe-code/test-utils",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./snapshot": {
      "types": "./dist/snapshot-client.d.ts",
      "import": "./dist/snapshot-client.js"
    }
  },
  "scripts": {
    "build": "tsc -b",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "@poe-code/types": "workspace:*",
    "memfs": "^4.17.1"
  },
  "peerDependencies": {
    "vitest": "^3.x"
  }
}
```

### Resolving Dependencies

The key insight: **types must be extracted first** to break circular dependencies.

**Step 1:** Extract interfaces to `@poe-code/types`:
```typescript
// packages/types/src/file-system.ts
export interface FileSystem {
  readFile(path: string, encoding: "utf8"): Promise<string>;
  writeFile(path: string, data: string): Promise<void>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  readdir(path: string): Promise<string[]>;
  unlink(path: string): Promise<void>;
  stat(path: string): Promise<{ isDirectory(): boolean }>;
  access(path: string): Promise<void>;
}

// packages/types/src/llm.ts
export interface LlmRequest {
  model: string;
  prompt: string;
  params?: Record<string, string>;
}

export interface LlmResponse {
  text?: string;
  url?: string;
  error?: string;
}

export interface LlmClient {
  text(request: LlmRequest): Promise<LlmResponse>;
  media(type: "image" | "video" | "audio", request: LlmRequest): Promise<LlmResponse>;
}

// packages/types/src/http.ts
export interface HttpResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export type HttpClient = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string }
) => Promise<HttpResponse>;
```

**Step 2:** Update imports in `@poe-code/test-utils`:
```typescript
// packages/test-utils/src/snapshot-client.ts
import type { FileSystem, LlmClient, LlmRequest, LlmResponse } from "@poe-code/types";
// No more ../../src imports!
```

---

## Migration Phases

### Phase 1: Infrastructure Setup

1. **Create pnpm-workspace.yaml**
```yaml
packages:
  - 'packages/*'
```

2. **Create root package.json**
```json
{
  "name": "poe-code-monorepo",
  "private": true,
  "packageManager": "pnpm@9.15.0",
  "scripts": {
    "build": "pnpm -r build",
    "test": "vitest run",
    "lint": "eslint . && tsc -p tsconfig.json --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.4.5",
    "vitest": "^3.2.4"
  }
}
```

3. **Create tsconfig.base.json**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "composite": true
  }
}
```

### Phase 2: Create @poe-code/types

**Files to extract (interfaces only, no implementation):**
- `FileSystem` interface from `src/utils/file-system.ts`
- `LlmClient`, `LlmRequest`, `LlmResponse` from `src/services/llm-client.ts`
- `HttpClient`, `HttpResponse` from `src/cli/http.ts`
- SDK types from `src/sdk/types.ts`
- Provider types from `src/providers/create-provider.ts`

**Critical files:**
- `src/utils/file-system.ts`
- `src/services/llm-client.ts`
- `src/cli/http.ts`
- `src/sdk/types.ts`

### Phase 3: Create @poe-code/test-utils

**Files to move:**
- `tests/helpers/snapshot-client.ts`
- `tests/helpers/snapshot-store.ts`
- `tests/helpers/snapshot-config.ts`
- `tests/helpers/http-client.ts`
- `tests/helpers/mcp-test-harness.ts`
- `tests/test-helpers.ts` → `memfs-helpers.ts`
- `tests/template-fixtures.ts`

**Dependencies:** `@poe-code/types`, `memfs`, `vitest` (peer)

### Phase 4: Create @poe-code/utils

**Files to move:**
- `src/utils/backup.ts`
- `src/utils/command-checks.ts`
- `src/utils/command-line.ts`
- `src/utils/dry-run.ts`
- `src/utils/execution-context.ts`
- `src/utils/json.ts`
- `src/utils/templates.ts`
- `src/utils/toml.ts`

**Dependencies:** `@poe-code/types`, `mustache`, `@iarna/toml`, `diff`

### Phase 5: Create @poe-code/core

**Files to move:**
- `src/services/credentials.ts`
- `src/services/llm-client.ts` (implementation)
- `src/services/client-instance.ts`
- `src/services/media-download.ts`
- `src/services/model-strategy.ts`
- `src/services/mutation-events.ts`
- `src/services/service-install.ts`
- `src/services/service-manifest.ts`
- `src/cli/environment.ts`
- `src/cli/context.ts`
- `src/cli/constants.ts`
- `src/cli/logger.ts`
- `src/cli/service-registry.ts`
- `src/cli/http.ts` (implementation)
- `src/cli/errors.ts`

**Dependencies:** `@poe-code/types`, `@poe-code/utils`, `chalk`, `semver`

### Phase 6: Create @poe-code/providers

**Files to move:**
- All of `src/providers/`
- `src/templates/` (embedded assets)

**Dependencies:** `@poe-code/types`, `@poe-code/utils`, `@poe-code/core`

### Phase 7: Create @poe-code/sdk

**Files to move:**
- `src/sdk/spawn.ts`
- `src/sdk/spawn-core.ts`
- `src/sdk/generate.ts`
- `src/sdk/credentials.ts`
- `src/sdk/container.ts`

**Dependencies:** `@poe-code/types`, `@poe-code/core`, `@poe-code/providers`

### Phase 8: Create @poe-code/mcp

**Files to move:**
- `src/cli/mcp-server.ts`
- MCP-related command logic

**Dependencies:** `@poe-code/core`, `@modelcontextprotocol/sdk`, `zod`

### Phase 9: Create poe-code (CLI)

**Files remaining:**
- `src/cli/commands/*`
- `src/cli/ui/*`
- `src/cli/bootstrap.ts`
- `src/cli/program.ts`
- `src/cli/binary-aliases.ts`
- `src/index.ts`

**Re-exports SDK for backward compatibility:**
```typescript
// packages/cli/src/index.ts
export { spawn, generate, generateImage, generateVideo, generateAudio, getPoeApiKey } from "@poe-code/sdk";
```

---

## Testing Strategy

Keep tests at root level with centralized setup:

```
tests/
├── setup.ts              # Uses @poe-code/test-utils
├── unit/                 # Unit tests by package
│   ├── utils/
│   ├── core/
│   └── providers/
├── integration/
└── __snapshots__/        # Shared snapshots (stays at root)
```

**Root vitest.config.ts:**
```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"]
  }
});
```

**Updated tests/setup.ts:**
```typescript
import { beforeAll, beforeEach, afterAll, vi } from "vitest";
import { createSnapshotClient, parseSnapshotConfig } from "@poe-code/test-utils";
import { templateFixtures, setTemplateLoader } from "@poe-code/test-utils";
import { setGlobalClient } from "@poe-code/core";
// ... rest of setup
```

---

## CI/CD Changes

### GitHub Workflows

Update to use pnpm:

```yaml
# .github/workflows/pr-checks.yml
steps:
  - uses: pnpm/action-setup@v4
    with:
      version: 9
  - uses: actions/setup-node@v4
    with:
      cache: 'pnpm'
  - run: pnpm install --frozen-lockfile
  - run: pnpm -r build
  - run: pnpm test
```

### Semantic Release

Move `.releaserc.json` to `packages/cli/` - only CLI package is published.

---

## Build Script Changes

### generate-bin-wrappers.mjs

Update to import from workspace packages:

```javascript
// packages/cli/scripts/generate-bin-wrappers.mjs
import { getDefaultProviders } from "@poe-code/providers";
import { deriveWrapBinaryAliases } from "../dist/binary-aliases.js";
// ... rest unchanged
```

### copy-templates.mjs

Move to `packages/providers/scripts/` since templates belong with providers.

---

## Migration Checklist

- [ ] Create `feat/monorepo-migration` branch
- [ ] Add `pnpm-workspace.yaml` and convert root `package.json`
- [ ] Create `tsconfig.base.json`
- [ ] **Phase 2:** Create `packages/types` - extract interfaces
- [ ] **Phase 3:** Create `packages/test-utils` - migrate test helpers
- [ ] Update `tests/setup.ts` to use `@poe-code/test-utils`
- [ ] Verify tests still pass
- [ ] **Phase 4:** Create `packages/utils`
- [ ] **Phase 5:** Create `packages/core`
- [ ] **Phase 6:** Create `packages/providers`
- [ ] **Phase 7:** Create `packages/sdk`
- [ ] **Phase 8:** Create `packages/mcp`
- [ ] **Phase 9:** Move CLI to `packages/cli`
- [ ] Update all cross-package imports
- [ ] Update build scripts
- [ ] Update GitHub workflows for pnpm
- [ ] Move `.releaserc.json` to CLI package
- [ ] Test full build: `pnpm -r build`
- [ ] Test CLI: `pnpm --filter poe-code dev -- --help`
- [ ] Test SDK exports work
- [ ] Verify `npm pack` produces correct output
- [ ] Create PR

---

## Verification Plan

1. **Build verification:**
   ```bash
   pnpm install
   pnpm -r build
   ```

2. **Test verification:**
   ```bash
   pnpm test
   ```

3. **CLI verification:**
   ```bash
   pnpm --filter poe-code dev -- --help
   pnpm --filter poe-code dev -- configure --dry-run
   ```

4. **SDK verification:**
   ```bash
   node -e "import('poe-code').then(m => console.log(Object.keys(m)))"
   ```

5. **Package verification:**
   ```bash
   cd packages/cli && npm pack --dry-run
   ```

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Breaking SDK imports | Re-export everything from main `poe-code` package |
| Build order issues | pnpm workspaces + TypeScript project references handle this |
| Template path resolution | Templates move with providers, loader configured at runtime |
| Bin wrapper generation | Must run after all packages built; script updated to import from workspace |
| Snapshot test paths | Keep `__snapshots__/` at root, shared across all tests |

---

## Development Overhead

### What Changes for Day-to-Day Development

| Aspect | Before (Single Package) | After (Monorepo) | Overhead |
|--------|------------------------|------------------|----------|
| **Install deps** | `npm install` | `pnpm install` | None (same) |
| **Run tests** | `npm test` | `pnpm test` | None |
| **Build** | `npm run build` | `pnpm -r build` | Slightly slower (multiple packages) |
| **Add dependency** | `npm install foo` | `pnpm --filter @poe-code/core add foo` | Need to specify package |
| **Dev mode** | `npm run dev -- args` | `pnpm --filter poe-code dev -- args` | Slightly more verbose |
| **Import paths** | `../services/foo.js` | `@poe-code/core` | Cleaner, but must rebuild on changes |

### New Friction Points

1. **Cross-package changes require rebuild**
   - Before: Change any file, run tests immediately
   - After: Change `@poe-code/core` → must rebuild before CLI tests see changes
   - Mitigation: `pnpm -r build --watch` or Turborepo caching

2. **Longer initial build**
   - Before: Single `tsc` invocation
   - After: 8 sequential `tsc` invocations (following dependency order)
   - Mitigation: TypeScript project references enable incremental builds

3. **More package.json files to maintain**
   - Before: 1 package.json
   - After: 9 package.json files (root + 8 packages)
   - Mitigation: Shared `tsconfig.base.json`, consistent structure

4. **Dependency version coordination**
   - Before: All deps in one place
   - After: Deps split across packages, risk of version drift
   - Mitigation: pnpm `catalog:` protocol or renovate bot grouping

### What Stays the Same

- Test workflow (`pnpm test` runs all tests)
- Lint workflow (`pnpm lint`)
- CI/CD (same commands, just with pnpm)
- Git workflow (single repo, single branch)
- Release process (still semantic-release, still one published package)

### Is It Worth It?

**Benefits gained:**
- Clear module boundaries (enforced by package isolation)
- Partial imports possible (SDK-only, MCP-only in future)
- Faster incremental builds (TypeScript project references)
- Easier to reason about dependencies
- Potential for parallel independent work on packages

**Cost:**
- ~10% more friction in cross-package development
- Learning curve for pnpm workspace commands
- Slightly more complex mental model

**Recommendation:** The overhead is minimal for a project this size. The main cost is the initial migration effort, not ongoing development friction.

---

## Future Considerations

1. **Publish @poe-code/sdk separately** - Remove `"private": true`, add to release workflow
2. **Add Turborepo** - For build caching if builds become slow
3. **Per-package changelogs** - If independent versioning needed later
