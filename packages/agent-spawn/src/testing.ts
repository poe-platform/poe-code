import type { Mock } from "vitest";
import type { AutonomousResult, SpawnResult } from "./types.js";

export type SpawnMockOptions = {
  spawnResult?: Partial<SpawnResult>;
  autonomousResult?: Partial<AutonomousResult>;
};

export type SpawnMock = {
  factory: () => { spawn: unknown };
  spawn: Mock;
  autonomous: Mock;
};

type MockFactory = {
  fn(implementation?: (...args: any[]) => unknown): Mock;
};

type LazySpawnMocks = {
  spawn: Mock;
  autonomous: Mock;
};

const defaultSpawnResult = (
  overrides?: Partial<SpawnResult>
): SpawnResult & { durationMs: number } => ({
  exitCode: 0,
  durationMs: 0,
  stdout: "",
  stderr: "",
  ...overrides
});

const defaultAutonomousResult = (
  overrides?: Partial<AutonomousResult>
): AutonomousResult => ({
  summary: "",
  log: "",
  output: "",
  stdout: "",
  text: "",
  toolCalls: [],
  sessionResult: {
    toolCalls: []
  },
  ...overrides
});

function getMockFactory(): MockFactory {
  const vitest = (globalThis as { vi?: MockFactory }).vi;

  if (vitest === undefined) {
    throw new Error("createSpawnMock() requires Vitest globals. Run this helper inside a Vitest test.");
  }

  return vitest;
}

export function createSpawnMock(options: SpawnMockOptions = {}): SpawnMock {
  let mocks: LazySpawnMocks | undefined;

  const ensureMocks = (): LazySpawnMocks => {
    if (mocks) {
      return mocks;
    }

    const { fn } = getMockFactory();
    const autonomous = fn(async () => defaultAutonomousResult(options.autonomousResult));
    const spawn = Object.assign(
      fn(async () => defaultSpawnResult(options.spawnResult)),
      { autonomous }
    ) as Mock;

    mocks = {
      spawn,
      autonomous
    };
    return mocks;
  };

  return {
    factory() {
      return {
        spawn: ensureMocks().spawn
      };
    },
    get spawn() {
      return ensureMocks().spawn;
    },
    get autonomous() {
      return ensureMocks().autonomous;
    }
  };
}
