import { beforeEach, describe, expect, it } from "vitest";
import { configureTheme, resetTheme } from "../internal/theme-state.js";
import { promptTheme } from "./theme.js";

describe("promptTheme", () => {
  beforeEach(() => {
    resetTheme();
  });

  it("uses the active brand primary color", () => {
    expect(promptTheme.style.accentColor).toBe("#a200ff");

    configureTheme({ brand: "blue" });

    expect(promptTheme.style.accentColor).toBe("#2f6fed");
  });
});
