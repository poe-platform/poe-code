import { describe, it, expect } from "vitest";
import { getConfigFormat, detectFormat, jsonFormat, tomlFormat } from "./index.js";

describe("getConfigFormat", () => {
  describe("by file path", () => {
    it("detects JSON from .json extension", () => {
      const format = getConfigFormat("~/.config/settings.json");
      expect(format).toBe(jsonFormat);
    });

    it("detects TOML from .toml extension", () => {
      const format = getConfigFormat("~/.cargo/config.toml");
      expect(format).toBe(tomlFormat);
    });

    it("is case-insensitive for extensions", () => {
      expect(getConfigFormat("file.JSON")).toBe(jsonFormat);
      expect(getConfigFormat("file.TOML")).toBe(tomlFormat);
    });

    it("throws for unsupported extension", () => {
      expect(() => getConfigFormat("~/.bashrc")).toThrow("Unsupported config format");
    });

    it("throws for files without extension", () => {
      expect(() => getConfigFormat("~/configfile")).toThrow("Unsupported config format");
    });
  });

  describe("by format name", () => {
    it("returns JSON format for 'json'", () => {
      const format = getConfigFormat("json");
      expect(format).toBe(jsonFormat);
    });

    it("returns TOML format for 'toml'", () => {
      const format = getConfigFormat("toml");
      expect(format).toBe(tomlFormat);
    });
  });
});

describe("detectFormat", () => {
  it("detects JSON from .json extension", () => {
    expect(detectFormat("file.json")).toBe("json");
  });

  it("detects TOML from .toml extension", () => {
    expect(detectFormat("file.toml")).toBe("toml");
  });

  it("returns undefined for unknown extensions", () => {
    expect(detectFormat("file.yaml")).toBeUndefined();
    expect(detectFormat("file")).toBeUndefined();
  });
});
