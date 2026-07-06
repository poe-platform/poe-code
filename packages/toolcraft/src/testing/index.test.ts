import { describe, expect, expectTypeOf, it } from "vitest";
import {
  createCommandTestHarness,
  createMemoryFs,
  fakeFetch,
  fakeService,
  type CommandTestHarness,
  type EffectEvent,
  type FetchRoute,
  type FsChange,
  type HarnessOptions,
  type MemoryFs,
  type ParityResult,
  type PipelineStage,
  type RunResult,
  type ServiceCall
} from "./index.js";

describe("toolcraft testing entrypoint", () => {
  it("exports the command testing utilities", () => {
    expect(createCommandTestHarness).toBeTypeOf("function");
    expect(createMemoryFs).toBeTypeOf("function");
    expect(fakeFetch).toBeTypeOf("function");
    expect(fakeService).toBeTypeOf("function");
  });

  it("exports the public testing types", () => {
    expectTypeOf<CommandTestHarness>().toBeObject();
    expectTypeOf<EffectEvent>().toBeObject();
    expectTypeOf<FetchRoute>().toBeObject();
    expectTypeOf<FsChange>().toBeObject();
    expectTypeOf<HarnessOptions<Record<string, never>>>().toBeObject();
    expectTypeOf<MemoryFs>().toBeObject();
    expectTypeOf<ParityResult>().toBeObject();
    expectTypeOf<PipelineStage>().toBeString();
    expectTypeOf<RunResult<unknown>>().toBeObject();
    expectTypeOf<ServiceCall>().toBeObject();
  });
});
