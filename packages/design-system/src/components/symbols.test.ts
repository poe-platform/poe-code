import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  resetOutputFormatCache,
  withOutputFormat
} from "../internal/output-format.js";
import { symbols } from "./symbols.js";

describe("symbols", () => {
  const originalForceColor = process.env.FORCE_COLOR;

  beforeEach(() => {
    process.env.FORCE_COLOR = "1";
    resetOutputFormatCache();
  });

  afterEach(() => {
    process.env.FORCE_COLOR = originalForceColor;
    resetOutputFormatCache();
  });

  it("renders markdown-safe symbols", () => {
    withOutputFormat("markdown", () => {
      expect(symbols.info).toBe("(i)");
      expect(symbols.success).toBe("[ok]");
      expect(symbols.resolved).toBe(">");
      expect(symbols.errorResolved).toBe("[!]");
      expect(symbols.warning).toBe("[!]");
      expect(symbols.active).toBe("[x]");
      expect(symbols.inactive).toBe("[ ]");
      expect(symbols.bar).toBe("|");
    });
  });

  it("renders json-safe symbols", () => {
    withOutputFormat("json", () => {
      expect(symbols.info).toBe("info");
      expect(symbols.success).toBe("success");
      expect(symbols.resolved).toBe("resolved");
      expect(symbols.errorResolved).toBe("error");
      expect(symbols.warning).toBe("warning");
      expect(symbols.active).toBe("active");
      expect(symbols.inactive).toBe("inactive");
      expect(symbols.bar).toBe("");
    });
  });

  it("keeps terminal bar rendering", () => {
    expect(withOutputFormat("terminal", () => symbols.bar)).toBe("│");
  });
});
