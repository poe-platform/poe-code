---
kind: pipeline
version: 1
tasks:
  - id: clean-json-spawn-output
    title: Fix spawn CLI to emit clean NDJSON in json mode
    prompt: >
      `OUTPUT_FORMAT=json` already exists and the ACP renderer emits proper NDJSON.

      The problem is `spawn.ts` leaks non-JSON output through `logger.intro()` and

      `logger.info()` calls. Fix this so `OUTPUT_FORMAT=json` produces clean, parseable NDJSON.


      Changes needed:


      1. In `src/cli/commands/spawn.ts`, guard logger calls behind a format check —
         when `OUTPUT_FORMAT=json`, skip:
         - `logger.intro()` calls (lines 161, 185)
         - `logger.info()` calls for stdout/stderr/completion/resume (lines 254-260, 271)

      2. Add `SpawnResultEvent` to `packages/agent-spawn/src/acp/types.ts`:
         ```ts
         export interface SpawnResultEvent {
           event: "spawn_result";
           exitCode: number;
           threadId?: string;
           usage?: { inputTokens: number; outputTokens: number; cachedTokens?: number; costUsd?: number };
           protocolVersion?: number;
           _meta?: Record<string, unknown>;
         }
         ```
         Emit this as the final NDJSON line when `OUTPUT_FORMAT=json`.

      3. Add missing CLI flags for SDK parity:
         - `--log-dir <path>` — directory override for ACP JSONL spawn logs
         - `--activity-timeout-ms <ms>` — kill after N ms of inactivity

      4. Rename SDK `mcpServers` to `mcpConfig` with backward compat (keep `mcpServers`
         as deprecated alias).

      The Python SDK will pass `--yes` when invoking the CLI, so no format-aware

      logic is needed in `confirmUnconfiguredService`.


      Files to touch: `src/cli/commands/spawn.ts`, `packages/agent-spawn/src/acp/types.ts`,

      `packages/agent-spawn/src/acp/renderer.ts`


      Reference plan: docs/plans/agent-spawn-python-cli-plan.md (Step 1)
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: python-types-codegen
    title: TypeScript-to-Python type codegen via ts-morph
    prompt: |
      Create a codegen script in the core package that uses `ts-morph` to parse the TS AST
      and emit Python dataclass types.

      The script should:
      1. Read `packages/agent-spawn/src/acp/types.ts` — walk exported interfaces, extract
         field names/types/optionality
      2. Read `packages/agent-spawn/src/configs/index.ts` — import `allSpawnConfigs`, emit
         `Agent` enum from their `agentId` fields (only spawnable agents)
      3. Read `packages/agent-spawn/src/types.ts` — extract `SpawnMode` union
      4. Map TS types to Python: `string` -> `str`, `number` -> `int`/`float`,
         `T | undefined` -> `Optional[T]`
      5. Convert camelCase fields to snake_case
      6. Write output to `packages/agent-spawn-py/src/poe_code_spawn/types.py`

      The generated Python should use only stdlib (`dataclasses`, `enum`, `typing`).
      Output should be checked in. Add a build step that runs codegen and a CI check
      that verifies the generated file is up to date.

      See the expected output shape in docs/plans/agent-spawn-python-cli-plan.md (Step 2).
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: python-sdk-spawn
    title: Implement Python spawn() SDK
    prompt: |
      Create the Python SDK package at `packages/agent-spawn-py/`.

      Package structure:
      ```
      packages/agent-spawn-py/
        pyproject.toml
        README.md
        src/poe_code_spawn/
          __init__.py
          types.py          # generated (from previous task)
          _spawn.py         # spawn() implementation
          _parse.py         # JSONL -> typed events
      ```

      API:
      - `spawn(agent, prompt, **kwargs)` returns a `SpawnHandle` with:
        - `.events` — iterator of `AcpEvent` (parsed from JSONL stdout)
        - `.result` — `SpawnResultEvent` (available after events consumed)
        - `.cancel()` — sends SIGINT to child process
      - `spawn.pretty(agent, prompt, **kwargs)` runs with `OUTPUT_FORMAT=terminal`,
        inherits stdout rendering, returns `SpawnResultEvent`

      The SDK always passes `--yes` to the CLI so interactive prompts are suppressed.
      The JSONL parser defensively skips lines that don't parse as JSON.

      CLI resolution order:
      1. `poe-code` on PATH
      2. `npx poe-code` fallback
      3. Fail with diagnostic `PoeCodeNotFoundError` including Python version, PATH,
         Node/npm versions

      The package must have zero dependencies (stdlib only).
      `pip install poe-code-spawn`.

      Include a README documenting usage, env variables, and config options.

      Reference plan: docs/plans/agent-spawn-python-cli-plan.md (Steps 3-4)
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: python-sdk-publish
    title: Add GitHub workflow for PyPI publishing
    prompt: |
      Create `.github/workflows/release-agent-spawn-py.yml` following the same pattern
      as existing package releases (e.g. `release-tiny-mcp.yml`).

      Workflow config:
      - Triggers on: push to `main` affecting `packages/agent-spawn-py/**`
      - Uses OIDC trusted publisher (no tokens in secrets)
      - Auto-bumps patch version in `pyproject.toml`
      - Builds with `python -m build`
      - Publishes via `pypa/gh-action-pypi-publish`

      Version strategy: Python package versions independently from the CLI. The JSONL
      output format is the stability contract. The `spawn_result` event includes a
      `protocolVersion` field — if the Python SDK sees a version it doesn't recognize,
      it warns but still attempts to parse.

      Reference plan: docs/plans/agent-spawn-python-cli-plan.md (Step 5)
    status:
      implement: done
      refactor: done
      test: done
      commit: done
---

# agent spawn python cli

Archived local pipeline plan converted from YAML during docs cleanup.
