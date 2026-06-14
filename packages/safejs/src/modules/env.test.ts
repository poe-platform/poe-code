import { afterEach, describe, expect, it, vi } from "vitest";

import { makeEnvModule } from "./env.js";

describe("makeEnvModule", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns values only for allow-listed environment variables", () => {
    vi.stubEnv("ALLOWED_TOKEN", "secret");
    vi.stubEnv("BLOCKED_TOKEN", "hidden");

    const env = makeEnvModule(["ALLOWED_TOKEN"]);

    expect(env.get("ALLOWED_TOKEN")).toBe("secret");
    expect(env.get("BLOCKED_TOKEN")).toBeUndefined();
  });

  it("trims names before checking the allow-list", () => {
    vi.stubEnv("ALLOWED_TOKEN", "secret");

    const env = makeEnvModule(["ALLOWED_TOKEN"]);

    expect(env.get("  ALLOWED_TOKEN  ")).toBe("secret");
  });

  it("returns undefined for allowed variables that are unset", () => {
    const env = makeEnvModule(["MISSING_TOKEN"]);

    expect(env.get("MISSING_TOKEN")).toBeUndefined();
  });

  it("uses the allow-list snapshot from construction time", () => {
    vi.stubEnv("ALLOWED_TOKEN", "secret");
    vi.stubEnv("LATE_TOKEN", "later");

    const allowList = ["ALLOWED_TOKEN"];
    const env = makeEnvModule(allowList);

    allowList.push("LATE_TOKEN");

    expect(env.get("ALLOWED_TOKEN")).toBe("secret");
    expect(env.get("LATE_TOKEN")).toBeUndefined();
  });

  it("rejects blank variable names", () => {
    const env = makeEnvModule(["ALLOWED_TOKEN"]);

    expect(() => env.get("   ")).toThrow("Environment variable name must be a non-empty string.");
  });

  it("rejects non-string variable names", () => {
    const env = makeEnvModule(["ALLOWED_TOKEN"]);

    expect(() => env.get(123 as never)).toThrow(
      "Environment variable name must be a non-empty string."
    );
    expect(() => env.get(null as never)).toThrow(
      "Environment variable name must be a non-empty string."
    );
  });

  it("rejects blank allow-list entries", () => {
    expect(() => makeEnvModule(["ALLOWED_TOKEN", "   "])).toThrow(
      "Environment allow list[1] must be a non-empty string."
    );
  });

  it("rejects non-string allow-list entries", () => {
    expect(() => makeEnvModule(["ALLOWED_TOKEN", 1 as never])).toThrow(
      "Environment allow list[1] must be a non-empty string."
    );
  });

  it("rejects non-array allow-lists", () => {
    expect(() => makeEnvModule("ALLOWED_TOKEN" as never)).toThrow(
      "Environment allow list must be an array of non-empty strings."
    );
  });
});
