export { buildContextArgs, detectContext } from "./docker/context.js";
export { detectEngine, isEngineAvailable } from "./docker/engine.js";
export { createDockerRunner } from "./docker/docker-runner.js";
export { createHostRunner } from "./host/host-runner.js";
export { createMockRunner, createMockRunnerByCommand } from "./testing/index.js";

export type {
  DockerMount,
  DockerPortMapping,
  DockerRunArgs,
  DockerRunnerOptions,
  Engine,
  HostRunnerOptions,
  MockRunBehavior,
  RunHandle,
  RunResult,
  Runner,
  RunSpec
} from "./types.js";
