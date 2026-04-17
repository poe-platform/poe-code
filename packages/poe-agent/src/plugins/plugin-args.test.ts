import { describe, expect, it } from "vitest";
import {
  getOptionalBoolean,
  getOptionalNonNegativeInteger,
  getOptionalNumber,
} from "./plugin-args.js";

describe("plugin-args", () => {
  it("parses optional booleans", () => {
    expect(getOptionalBoolean({ enabled: true }, "enabled")).toBe(true);
    expect(getOptionalBoolean({}, "enabled")).toBeUndefined();
  });

  it("rejects non-boolean optional booleans", () => {
    expect(() => getOptionalBoolean({ enabled: "yes" }, "enabled")).toThrow(
      'Tool argument "enabled" must be a boolean',
    );
  });

  it("parses optional finite numbers", () => {
    expect(getOptionalNumber({ timeout: 4.5 }, "timeout")).toBe(4.5);
    expect(getOptionalNumber({}, "timeout")).toBeUndefined();
  });

  it("rejects non-finite optional numbers", () => {
    expect(() => getOptionalNumber({ timeout: Number.POSITIVE_INFINITY }, "timeout")).toThrow(
      'Tool argument "timeout" must be a finite number',
    );
  });

  it("parses optional non-negative integers", () => {
    expect(getOptionalNonNegativeInteger({ offset: 0 }, "offset")).toBe(0);
    expect(getOptionalNonNegativeInteger({ offset: 3 }, "offset")).toBe(3);
    expect(getOptionalNonNegativeInteger({}, "offset")).toBeUndefined();
  });

  it("rejects negative and non-integer optional integers", () => {
    expect(() => getOptionalNonNegativeInteger({ offset: -1 }, "offset")).toThrow(
      'Tool argument "offset" must be a non-negative integer',
    );
    expect(() => getOptionalNonNegativeInteger({ offset: 1.5 }, "offset")).toThrow(
      'Tool argument "offset" must be a non-negative integer',
    );
  });
});
