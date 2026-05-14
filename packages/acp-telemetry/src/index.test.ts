import { describe, expect, it } from "vitest";

describe("@poe-code/acp-telemetry", () => {
  it("exports telemetry helpers", async () => {
    const telemetry = await import("./index.js");

    expect(telemetry.redact).toEqual(expect.any(Function));
  });
});
