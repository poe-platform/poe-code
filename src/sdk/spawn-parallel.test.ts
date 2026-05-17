import { describe, expect, it } from "vitest";

import { spawn } from "./spawn.js";
import type { AcpEvent } from "@poe-code/agent-spawn";
import type { SpawnResult } from "./types.js";

const emptyEvents = async function* (): AsyncIterable<AcpEvent> {};

describe("SDK spawn.parallel()", () => {
  it("is exposed on the re-exported spawn helper and accepts spawn thunks", async () => {
    const results = await spawn.parallel(
      [
        () => ({
          events: emptyEvents(),
          result: Promise.resolve<SpawnResult>({ stdout: "first", stderr: "", exitCode: 0 })
        }),
        () => ({
          events: emptyEvents(),
          result: Promise.resolve<SpawnResult>({ stdout: "second", stderr: "", exitCode: 0 })
        })
      ],
      { maxConcurrent: 2 }
    );

    expect(results.map((result) => result.stdout)).toEqual(["first", "second"]);
  });
});
