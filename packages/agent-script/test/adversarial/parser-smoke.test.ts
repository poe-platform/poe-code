import { describe, expect, it } from "vitest";

import { runParserSmokeFuzzer } from "./parser-smoke.js";

describe("bounded grammar parser smoke fuzzer", () => {
  it("parses or rejects every fixed-seed case deterministically", () => {
    expect(() => runParserSmokeFuzzer()).not.toThrow();
  }, 1_000);
});
