# Docker-Spawn Rework Plan

## Goal

Scrap the current runtime-in-core approach and replace it with a dedicated wrapper package:

- **New package:** `packages/docker-spawn`
- **Package name:** `@poe-code/docker-spawn`
- **Dependency:** `@poe-code/agent-spawn`
- **Contract:** same spawn API surface, Docker-backed execution

`@poe-code/agent-spawn` should stay focused on provider-aware argument building and expose an internal/runtime injection seam so wrapper packages can swap process launch behavior without duplicating spawn logic.

## Learnings From Current Attempt

1. `buildSpawnArgs()` in `@poe-code/agent-spawn` already centralizes provider/model/mode argument construction and should remain the single source of truth.
2. Docker launch concerns are isolated well when treated as a process wrapper concern.
3. Streaming and interactive paths require strict stdio parity tests.
4. Pushing docker/runtime flags through `agent-spawn` + SDK + CLI creates unnecessary coupling.

## New Architecture

1. `@poe-code/agent-spawn` provides a launcher injection seam for all spawn modes (non-streaming, streaming, interactive).
2. Host `@poe-code/agent-spawn` exports are backed by the default host launcher.
3. `@poe-code/docker-spawn` binds the seam with a Docker launcher and mirrors spawn entrypoints (`spawn`, `spawnStreaming`, `spawnInteractive`).
4. Wrapper is responsible only for Docker launch behavior:
   - engine resolution
   - cwd mount
   - container workspace
   - env allowlist
5. Image definition lives in a package-local Dockerfile.

## Injection Seam

Practical seam shape (naming can vary):

- `ProcessLauncher` contract receives `{ binaryName, binaryArgs, cwd, env, stdio }`
- `createSpawnApi(launcher)` (or equivalent) returns `{ spawn, spawnStreaming, spawnInteractive }`
- Existing `@poe-code/agent-spawn` public entrypoints use the default host launcher
- `@poe-code/docker-spawn` uses the same core API with a Docker launcher implementation

## Config

Docker image definition lives directly in Docker-Spawn package as Dockerfile:

- `packages/docker-spawn/Dockerfile`

No YAML image config is needed.
`build-image` command/tooling should build and tag the image from this Dockerfile.

## Stories (Reset To Open)

1. `US-001` Capture discard learnings and reset plan baseline - `open`
2. `US-002` Add launcher injection seam in `@poe-code/agent-spawn` - `open`
3. `US-003` Scaffold Docker-Spawn package with API parity contract - `open`
4. `US-004` Add package-local Dockerfile and build-image flow - `open`
5. `US-005` Implement Docker-Spawn wrappers via injected launcher - `open`
6. `US-006` Remove discarded runtime-in-core implementation changes - `open`
7. `US-007` Validate with test, lint, e2e, and spawn help screenshot - `open`

## Quality Gates

- `npm run test`
- `npm run lint`
- `npm run e2e:verbose`
- `npm run screenshot-poe-code -- spawn --help`
