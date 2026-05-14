import { describe, expect, it } from "vitest";

describe("@poe-code/acp-telemetry", () => {
  it("exposes an empty module placeholder", async () => {
    const telemetry = await import("./index.js");

    expect(Object.keys(telemetry)).toEqual([]);
  });
});
