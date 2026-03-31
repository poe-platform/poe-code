# Docker-Spawn Greenfield Plan

## Goal

Implement Docker spawn support from scratch, with no dependency on previously removed Docker runtime code.

- New package: `packages/docker-spawn`
- Package name: `@poe-code/docker-spawn`
- Dependency: `@poe-code/agent-spawn`
- Contract: same spawn API surface, Docker-backed execution

## Architecture

1. Add a launcher injection seam to `@poe-code/agent-spawn`.
2. Keep provider config resolution and argument construction only in `@poe-code/agent-spawn`.
3. Keep default host behavior in `@poe-code/agent-spawn` unchanged.
4. Implement Docker runtime behavior only in `@poe-code/docker-spawn` by binding the injected launcher.
5. Define image build input with `packages/docker-spawn/Dockerfile` only.

## Injection Seam

Practical seam shape:

- `ProcessLauncher` contract receives `{ binaryName, binaryArgs, cwd, env, stdio }`
- `createSpawnApi(launcher)` (or equivalent) returns `{ spawn, spawnStreaming, spawnInteractive }`
- Existing `@poe-code/agent-spawn` exports use host launcher
- `@poe-code/docker-spawn` uses the same factory with Docker launcher

## Build Image

- Image definition file: `packages/docker-spawn/Dockerfile`
- Add build-image command/tooling that builds and tags the image from this Dockerfile
- No YAML image config file

## Stories (All Open, Greenfield)

1. `US-001` Establish greenfield baseline and seam contract - `open`
2. `US-002` Implement launcher injection seam in `@poe-code/agent-spawn` - `open`
3. `US-003` Scaffold `@poe-code/docker-spawn` package with API parity checks - `open`
4. `US-004` Implement Docker launcher primitives (engine, args, process launch) - `open`
5. `US-005` Implement Docker-Spawn spawn wrappers via injected launcher - `open`
6. `US-006` Add package Dockerfile and build-image command/tooling - `open`
7. `US-007` Validate tests, lint, e2e, and CLI screenshots - `open`

## Quality Gates

- `bun run test`
- `bun run lint`
- `bun run e2e:verbose`
- `bun run screenshot-poe-code -- spawn --help`
- `bun run screenshot-poe-code -- docker-spawn build-image --help`
