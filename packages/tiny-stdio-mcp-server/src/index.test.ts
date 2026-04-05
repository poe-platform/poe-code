import { describe, expect, expectTypeOf, it } from "vitest";
import * as api from "./index.js";
import type { HandleResult } from "./index.js";

describe("tiny-stdio-mcp-server public entry point", () => {
  it("exports HandleResult as part of the package type surface", () => {
    expectTypeOf<HandleResult>().toEqualTypeOf<{
      result?: unknown;
      error?: { code: number; message: string };
    }>();
  });

  it("keeps HandleResult out of the runtime namespace", () => {
    expect(api).not.toHaveProperty("HandleResult");
  });
});
