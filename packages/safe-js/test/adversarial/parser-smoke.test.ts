import { performance } from "node:perf_hooks";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runParserSmokeFuzzer } from "./parser-smoke.js";

afterEach(() => vi.restoreAllMocks());

describe("bounded grammar parser smoke fuzzer", () => {
  it("parses or rejects every fixed-seed case deterministically", () => {
    expect(() => runParserSmokeFuzzer()).not.toThrow();
  });
  it("bounds CPU work independently of scheduling delays", () => {
    vi.spyOn(performance, "now").mockReturnValueOnce(0).mockReturnValue(10_000);
    vi.spyOn(process, "threadCpuUsage").mockReturnValue({ user: 100_000, system: 0 });
    expect(() => runParserSmokeFuzzer()).not.toThrow();
  });
  it("rejects excessive parser CPU work", () => {
    vi.spyOn(process, "threadCpuUsage").mockReturnValue({ user: 500_001, system: 0 });
    expect(() => runParserSmokeFuzzer()).toThrow("CPU cap");
  });
});
