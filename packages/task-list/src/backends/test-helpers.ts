import { createFsFromVolume, Volume } from "memfs";
import { vi } from "vitest";
import type { GhClient } from "./gh-issues-client.js";
import type { TaskListFs } from "../types.js";

type TestFs = ReturnType<typeof createFsFromVolume>["promises"];

export function createFs(files: Record<string, string> = {}): {
  fs: TaskListFs;
  rawFs: TestFs;
  volume: Volume;
} {
  const volume = Volume.fromJSON(files, "/");
  const rawFs = createFsFromVolume(volume).promises;

  return {
    fs: rawFs as unknown as TaskListFs,
    rawFs,
    volume
  };
}

export function createDeferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve: () => void = () => {
    throw new Error("Deferred promise resolved before initialization.");
  };
  const promise = new Promise<void>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
}

export function flushMicrotasks(): Promise<void> {
  return Promise.resolve().then(() => Promise.resolve());
}

export async function waitForCondition(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (condition()) {
      return;
    }

    await flushMicrotasks();
  }

  throw new Error("Condition was not met in time.");
}

export class MockGhClient implements GhClient {
  readonly calls: Array<{ query: string; variables: Record<string, unknown> }> = [];

  async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    this.calls.push({ query, variables });
    const response = this.responses.shift();
    if (response === undefined) {
      throw new Error("Unexpected GraphQL request.");
    }

    if (response instanceof Error) {
      throw response;
    }

    return response as T;
  }

  constructor(private readonly responses: unknown[]) {}
}

export function createFetchMock(responses: Response[]): typeof fetch {
  return vi.fn(async () => {
    const response = responses.shift();
    if (response === undefined) {
      throw new Error("Unexpected fetch call.");
    }
    return response;
  }) as unknown as typeof fetch;
}

export function graphqlResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data }), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
