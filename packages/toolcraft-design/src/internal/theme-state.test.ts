import { beforeEach, describe, expect, it } from "vitest";
import { configureTheme, getThemeConfig, resetTheme } from "./theme-state.js";

describe("theme-state", () => {
  beforeEach(() => {
    resetTheme();
  });

  it("defaults to purple and Poe", () => {
    expect(getThemeConfig()).toEqual({ brand: "purple", label: "Poe" });
  });

  it("merges configuration patches", () => {
    configureTheme({ brand: "blue" });
    configureTheme({ label: "Acme" });

    expect(getThemeConfig()).toEqual({ brand: "blue", label: "Acme" });
  });

  it("throws for unknown brands without changing configuration", () => {
    expect(() => configureTheme({ brand: "orange" })).toThrow("Unknown brand: orange");
    expect(() => configureTheme({ brand: "toString" })).toThrow("Unknown brand: toString");
    expect(getThemeConfig()).toEqual({ brand: "purple", label: "Poe" });
  });

  it("ignores undefined patch values", () => {
    configureTheme({ brand: "blue", label: "Acme" });
    configureTheme({ brand: undefined, label: undefined });

    expect(getThemeConfig()).toEqual({ brand: "blue", label: "Acme" });
  });

  it("restores defaults", () => {
    configureTheme({ brand: "green", label: "Acme" });
    resetTheme();

    expect(getThemeConfig()).toEqual({ brand: "purple", label: "Poe" });
  });
});
