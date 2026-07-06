# @poe-code/process-runner

Low-level process execution abstraction. Single interface for launching processes on the host or inside Docker containers.

## Overview

- No external dependencies
- Consumed by `@poe-code/agent-spawn`
- Consumed by `process-launcher`

## Host Factory

- `createHostRunner(options)` returns a `Runner` that launches commands with `node:child_process.spawn`.
- `options.detached` starts the child as a detached process and uses process-group kill on Unix.
- `hostExecutionEnvFactory` implements the shared execution environment contract for local host execution.
- Host environments do not upload, download, detach, or reattach because the caller workspace is already local and there is no addressable remote environment.

## Docker Factories

- `createDockerRunner(options)` returns a one-shot `Runner` that executes each command in a Docker or Podman container.
- `dockerExecutionEnvFactory` creates an addressable long-lived container environment for Poe Code runtime jobs.
- Docker environments support workspace upload/download, command execution, interactive shell, detach, attach, and cleanup.

`DockerRunnerOptions`:

- `image`: container image to run.
- `engine`: `docker` or `podman`; detected when omitted.
- `context`: Docker context name; detected when omitted.
- `mounts`: container mounts.
- `ports`: port mappings.
- `network`: Docker network.
- `extraArgs`: additional runtime arguments.
- `containerName`: optional container name prefix.

## Environment Variables

This package exposes no environment variables.

## Configuration

This package currently exposes no package-level configuration options.
