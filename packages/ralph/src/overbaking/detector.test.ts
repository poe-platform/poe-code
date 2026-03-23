import { describe, expect, it } from "vitest";
import { OverbakingDetector } from "./detector.js";

describe("OverbakingDetector", () => {
  it("warns when the failure threshold is reached and resets after success", () => {
    const detector = new OverbakingDetector(3);

    expect(detector.record(false)).toEqual({
      consecutiveFailures: 1,
      overbaked: false,
      shouldWarn: false
    });
    expect(detector.record(false)).toEqual({
      consecutiveFailures: 2,
      overbaked: false,
      shouldWarn: false
    });
    expect(detector.record(false)).toEqual({
      consecutiveFailures: 3,
      overbaked: true,
      shouldWarn: true
    });
    expect(detector.record(false)).toEqual({
      consecutiveFailures: 4,
      overbaked: true,
      shouldWarn: false
    });
    expect(detector.record(true)).toEqual({
      consecutiveFailures: 0,
      overbaked: false,
      shouldWarn: false
    });
  });
});
