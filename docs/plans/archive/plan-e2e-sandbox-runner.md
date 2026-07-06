---
kind: archived-pipeline-plan
version: 1
source: plan-e2e-sandbox-runner.yaml
task_count: 11
---

# E2e Sandbox Runner

Archived pipeline plan. The original YAML is retained below for provenance.

````yaml
vars:
  plan_doc: "{{file 'docs/plans/e2e-sandbox-runner.md'}}"

tasks:
  # ── Phase 1: Package rename + home on Container ──────────────────────

  - id: rename-package-dir
    title: Rename package directory and update package.json name
    status:
      implement: done
      refactor: done
      test: done
      commit: done
    prompt: |
      Rename `packages/e2e-docker-test-runner/` to `packages/e2e-test-runner/`.

      Update the `name` field in `packages/e2e-test-runner/package.json` from
      `@poe-code/e2e-docker-test-runner` to `@poe-code/e2e-test-runner`.

      Update the root `package.json`:
      - npm script paths that reference `packages/e2e-docker-test-runner/` (e2e:cleanup, e2e:logs, e2e:cache:clear)
      - Any workspace references

      Run `npm install` to regenerate the lockfile with the new package name.

      Reference: {{plan_doc}} — Phase 1

  - id: update-import-references
    title: Update all import references to the renamed package
    status:
      implement: done
      refactor: done
      test: done
      commit: done
    prompt: |
      Find and replace all references to `@poe-code/e2e-docker-test-runner` with
      `@poe-code/e2e-test-runner` across the codebase. Key files to update:

      - `e2e/vitest.config.ts` — alias paths (both the alias keys and the resolved paths)
      - `e2e/tsconfig.json` — path aliases
      - `e2e/setup.ts` — import statement
      - All `e2e/*.test.ts` files (claude-code, codex, kimi, opencode, mcp-tool) — imports
      - `packages/e2e-test-runner/src/image.ts` — BUILD_TARBALLS tarball name if it self-references
      - `e2e.Dockerfile` — any COPY/install/rm references to the old package name
      - `docs/development/e2e.md` — package name in documentation/examples

      Also update the resolved path in `e2e/vitest.config.ts` from
      `../packages/e2e-docker-test-runner/src` to `../packages/e2e-test-runner/src`.

      Run `npx tsc --noEmit` from the e2e directory and `npm run build` to verify
      nothing is broken.

      Reference: {{plan_doc}} — Phase 1

  - id: add-home-to-container
    title: Add `home` property to Container interface
    status:
      implement: done
      refactor: done
      test: done
      commit: done
    prompt: |
      Add a `home: string` property to the `Container` interface in
      `packages/e2e-test-runner/src/types.ts`.

      Update `persistent-container.ts` to return `home: '/home/poe'` in the
      container object it creates.

      Update `container.ts` (fresh container runner) similarly if it implements
      the interface.

      Then replace all hardcoded `/home/poe` references in e2e test files with
      `container.home`. Files with hardcoded paths:
      - `e2e/kimi.test.ts`
      - `e2e/codex.test.ts`
      - `e2e/opencode.test.ts`
      - `e2e/claude-code.test.ts`

      For example, change:
      ```typescript
      await expect(container).toHaveFile('/home/poe/.kimi/config.toml');
      ```
      to:
      ```typescript
      await expect(container).toHaveFile(`${container.home}/.kimi/config.toml`);
      ```

      Update the `toHaveFile` and `toHaveFileContaining` matchers in `matchers.ts`
      if they reference `/home/poe` directly.

      Write TDD-style: update the `use-container.test.ts` to assert `home` exists
      on the container proxy, then implement.

      Run the unit tests for the package: `npx vitest run --config packages/e2e-test-runner/vitest.config.ts`

      Reference: {{plan_doc}} — Phase 1

  # ── Phase 2: Backend abstraction ─────────────────────────────────────

  - id: backend-abstraction
    title: Create backend resolution and factory abstraction
    status:
      implement: done
      refactor: done
      test: done
      commit: done
    prompt: |
      Create `packages/e2e-test-runner/src/backend.ts` with:

      ```typescript
      type Backend = 'env' | 'sandbox' | 'podman' | 'docker';

      function resolveBackend(): Backend {
        const explicit = process.env.E2E_BACKEND;
        if (explicit) return explicit as Backend;
        if (process.env.CI) return 'env';
        return 'sandbox';
      }

      async function createBackendContainer(
        backend: Backend,
        options: ContainerOptions
      ): Promise<Container>;
      ```

      The `createBackendContainer` function should dispatch to the existing
      `createPersistentContainer` for `podman` and `docker` backends. For `env`
      and `sandbox` backends, throw a "not implemented yet" error for now — those
      are added in later tasks.

      Update `use-container.ts` to call `createBackendContainer(resolveBackend(), options)`
      instead of calling `createPersistentContainer()` directly.

      Write tests first in a new `backend.test.ts`:
      - `resolveBackend()` returns 'env' when CI=true
      - `resolveBackend()` returns 'sandbox' when no env vars
      - `resolveBackend()` respects E2E_BACKEND override
      - `createBackendContainer('docker', ...)` delegates to persistent container

      Run unit tests to verify.

      Reference: {{plan_doc}} — Phase 2

  # ── Phase 3: env backend ─────────────────────────────────────────────

  - id: env-container
    title: Implement `env` backend (HOME/XDG isolation)
    status:
      implement: done
      refactor: done
      test: done
      commit: done
    prompt: |
      Create `packages/e2e-test-runner/src/env-container.ts` implementing the
      `Container` interface using lightweight HOME isolation.

      Key behaviors:
      - `create()`: calls `fs.mkdtemp()` to create a fresh temp dir as sandbox HOME.
        Sets `home` property to this path.
      - `exec(command)`: uses `child_process.spawn` with env overrides:
        ```
        HOME: sandboxHome
        XDG_CONFIG_HOME: `${sandboxHome}/.config`
        NPM_CONFIG_PREFIX: `${sandboxHome}/.npm-global`
        PATH: `${sandboxHome}/.local/bin:${sandboxHome}/.npm-global/bin:<workspace>/node_modules/.bin:${process.env.PATH}`
        POE_API_KEY: <from credentials>
        ```
      - `execOrThrow(command)`: calls exec, throws if non-zero exit code
      - `login()`: no-op (no container to log into)
      - `fileExists(path)`: `fs.access()` — path is absolute within sandbox HOME
      - `readFile(path)`: `fs.readFile()` — direct filesystem access
      - `writeFile(path, content)`: `fs.writeFile()` — direct filesystem access
      - `destroy()`: `rm -rf` the temp directory
      - `proxyLog()`: return proxy server log if running, null otherwise
      - `requests()`: delegate to proxy server's captured requests
      - `writeSnapshots()`: write snapshot files to the workspace directory

      The proxy server should run as a host process (reuse existing proxy-server.ts).

      Preflight checks before first exec:
      1. HOME dir is empty (sanity)
      2. No agent config dirs exist yet
      3. POE_API_KEY is available
      4. node, npm, uv are on PATH

      Write TDD: create `env-container.test.ts` with tests for:
      - Fresh HOME is created and empty
      - exec() spawns with correct env vars
      - fileExists/readFile/writeFile work on the sandbox HOME
      - destroy() removes the temp dir
      - Use memfs for filesystem tests per project rules

      Wire into `backend.ts` so `createBackendContainer('env', ...)` returns an
      env container.

      Reference: {{plan_doc}} — Phase 3, Layer 1

  # ── Phase 4: sandbox backend ─────────────────────────────────────────

  - id: sandbox-command-builder
    title: Implement platform-specific sandbox command builder
    status:
      implement: done
      refactor: done
      test: done
      commit: done
    prompt: |
      Create `packages/e2e-test-runner/src/sandbox.ts` with a platform-specific
      command builder:

      ```typescript
      interface SandboxConfig {
        home: string;
        writablePaths: string[];
        env: Record<string, string>;
      }

      function buildSandboxCommand(
        config: SandboxConfig,
        command: string
      ): { bin: string; args: string[] };
      ```

      **macOS** — uses `sandbox-exec`:
      ```
      sandbox-exec -p '(version 1)
      (deny default)
      (allow process*)
      (allow sysctl*)
      (allow mach*)
      (allow signal)
      (allow file-read*)
      (allow network*)
      (allow file-write* (subpath "<home>"))
      (allow file-write* (subpath "/dev"))
      (allow file-write* (subpath "/private/var/folders"))
      ' env HOME=<home> sh -c "<command>"
      ```

      **Linux** — uses `bubblewrap` (bwrap):
      ```
      bwrap --ro-bind / / --bind <home> <home> --dev /dev --proc /proc
        --tmpfs /tmp --setenv HOME <home> --die-with-parent
        -- sh -c "<command>"
      ```

      Write TDD: create `sandbox.test.ts` with tests for:
      - macOS: generates correct sandbox-exec profile with writable paths
      - Linux: generates correct bwrap args
      - Both: env vars are passed through
      - Writable paths are included in the policy/args

      Reference: {{plan_doc}} — Phase 4, Layer 2

  - id: sandbox-container
    title: Implement `sandbox` backend container
    status:
      implement: done
      refactor: done
      test: done
      commit: done
    prompt: |
      Create `packages/e2e-test-runner/src/sandbox-container.ts`.

      This is identical to `env-container.ts` except `exec()` wraps the command
      through `buildSandboxCommand()` from `sandbox.ts` before spawning.

      The sandbox config should set:
      - `home`: the mkdtemp sandbox HOME
      - `writablePaths`: [sandboxHome, os.tmpdir()] — the sandbox HOME and the
        system temp dir (needed for node/npm temp files)

      All other Container methods (fileExists, readFile, writeFile, destroy, etc.)
      are identical to env-container — consider extracting shared logic into a
      base module or shared helper rather than duplicating.

      Wire into `backend.ts` so `createBackendContainer('sandbox', ...)` returns
      a sandbox container.

      Write TDD: create `sandbox-container.test.ts` with tests for:
      - exec() wraps command through buildSandboxCommand
      - All file operations work the same as env-container
      - Use memfs for filesystem tests

      Reference: {{plan_doc}} — Phase 4

  # ── Phase 5: Remove Docker backend ───────────────────────────────────

  - id: remove-docker-backend
    title: Remove Docker backend and related infrastructure
    status:
      implement: done
      refactor: done
      test: done
      commit: done
    prompt: |
      Remove the Docker backend entirely. Delete these files:
      - `packages/e2e-test-runner/src/context.ts` (Colima context management)
      - `packages/e2e-test-runner/src/context.test.ts` (if exists)
      - `packages/e2e-test-runner/src/image.ts` (image building/caching)
      - `packages/e2e-test-runner/src/image.test.ts` (if exists)
      - `packages/e2e-test-runner/src/docker-infra.test.ts` (if exists)
      - `packages/e2e-test-runner/e2e.Dockerfile` (or at project root)
      - `e2e.Dockerfile` (if at project root)

      In `packages/e2e-test-runner/src/preflight.ts`:
      - Remove Colima auto-start logic
      - Remove Docker Desktop auto-start logic
      - Remove image pre-build logic
      - Keep only checks relevant to env/sandbox/podman backends

      In `packages/e2e-test-runner/src/engine.ts`:
      - Keep only podman detection (remove docker detection)
      - Or remove the file entirely if only used by docker backend

      Remove the 'docker' option from the Backend type in `backend.ts`.

      Update `packages/e2e-test-runner/src/index.ts` exports — remove anything
      referencing deleted modules.

      Remove `container.ts` (fresh container runner) if it was docker-specific.

      Update `persistent-container.ts` to only support podman, or rename it to
      `podman-container.ts` for clarity.

      Delete related test files for removed modules.

      Run `npm run build` and `npx vitest run` to verify nothing references
      deleted code.

      Reference: {{plan_doc}} — Phase 5

  # ── Phase 6: CI workflow update ──────────────────────────────────────

  - id: ci-workflow-update
    title: Update CI workflow for env backend
    status:
      implement: done
      refactor: done
      test: done
      commit: done
    prompt: |
      Update the GitHub Actions workflow for e2e tests. The workflow should:

      1. No longer need Docker/Colima setup
      2. Run on `ubuntu-latest`
      3. Install prerequisites: Node 22, uv (`curl -LsSf https://astral.sh/uv/install.sh | sh`)
      4. Run `npm ci` then `npm run e2e:verbose`
      5. Set env vars:
         - `POE_API_KEY: ${{ secrets.POE_API_KEY }}`
         - `E2E_BACKEND: env`

      Find the existing e2e workflow file (likely in `.github/workflows/`) and
      update it. Remove any Docker-specific steps (Docker login, Colima install,
      image cache, etc.).

      Do not write unit tests for workflow files — use `npm run lint:workflows`
      to validate.

      Reference: {{plan_doc}} — Phase 6

  # ── Phase 7: Preflight per backend ───────────────────────────────────

  - id: preflight-per-backend
    title: Update preflight checks to be backend-aware
    status:
      implement: done
      refactor: done
      test: done
      commit: done
    prompt: |
      Update `packages/e2e-test-runner/src/preflight.ts` so checks are
      conditional on the resolved backend:

      | Check                          | env | sandbox | podman |
      |-------------------------------|-----|---------|--------|
      | API key available             |  Y  |    Y    |   Y    |
      | Agent not configured          |  Y  |    Y    |   -    |
      | node/npm/uv on PATH           |  Y  |    Y    |   -    |
      | sandbox-exec / bwrap available |  -  |    Y    |   -    |
      | Podman installed + running     |  -  |    -    |   Y    |

      Import `resolveBackend()` from `backend.ts` and use it to determine which
      checks to run.

      For the sandbox check:
      - macOS: verify `sandbox-exec` exists (it should — ships with macOS)
      - Linux: verify `bwrap` is on PATH

      Update `preflight.test.ts` with tests for each backend's check set.

      Reference: {{plan_doc}} — Phase 7

  # ── Phase 8: Cleanup and docs ────────────────────────────────────────

  - id: cleanup-and-docs
    title: Update package README and e2e development docs
    status:
      implement: done
      refactor: done
      test: done
      commit: done
    prompt: |
      Update `packages/e2e-test-runner/README.md`:
      - Document all three backends (env, sandbox, podman)
      - Document the `E2E_BACKEND` env var and defaults (CI=env, local=sandbox)
      - Document the `Container` interface including the new `home` property
      - List per-backend prerequisites

      Update `docs/development/e2e.md`:
      - Replace docker-centric instructions with new backend system
      - Document how to run e2e tests locally (defaults to sandbox backend)
      - Document how to override backend via E2E_BACKEND
      - Remove Colima/Docker Desktop setup instructions

      Remove any stale scripts in `packages/e2e-test-runner/scripts/` that
      reference Docker (cleanup.ts, logs.ts) — or update them to work with
      the new backends.

      Run `npm run build` for a final verification.

      Reference: {{plan_doc}} — Phase 8
````
