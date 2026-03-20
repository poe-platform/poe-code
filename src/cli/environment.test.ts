import { describe, it, expect } from "vitest";
import { createCliEnvironment, resolveSpawnLogDir } from "./environment.js";

describe("CliEnvironment", () => {
  const cwd = "/workspace";
  const homeDir = "/home/user";

  it("computes a shared config path inside the poe-code folder", () => {
    const environment = createCliEnvironment({ cwd, homeDir });

    expect(environment.configPath).toBe(
      "/home/user/.poe-code/config.json"
    );
  });

  it("resolves paths relative to the user's home directory", () => {
    const environment = createCliEnvironment({ cwd, homeDir });

    expect(environment.resolveHomePath(".config", "codex", "config.toml")).toBe(
      "/home/user/.config/codex/config.toml"
    );
  });

  it("exposes environment variables with overrides", () => {
    const environment = createCliEnvironment({
      cwd,
      homeDir,
      variables: { SHELL: "/bin/zsh" }
    });

    expect(environment.getVariable("SHELL")).toBe("/bin/zsh");
    expect(environment.getVariable("UNKNOWN_VAR")).toBeUndefined();
  });

  it("derives Poe base URLs from POE_BASE_URL with v1", () => {
    const environment = createCliEnvironment({
      cwd,
      homeDir,
      variables: { POE_BASE_URL: "https://proxy.example.com/v1" }
    });

    expect(environment.poeApiBaseUrl).toBe("https://proxy.example.com/v1");
    expect(environment.poeBaseUrl).toBe("https://proxy.example.com");
  });

  it("adds v1 when POE_BASE_URL is set to a host", () => {
    const environment = createCliEnvironment({
      cwd,
      homeDir,
      variables: { POE_BASE_URL: "https://proxy.example.com" }
    });

    expect(environment.poeApiBaseUrl).toBe("https://proxy.example.com/v1");
    expect(environment.poeBaseUrl).toBe("https://proxy.example.com");
  });

  it("computes the default spawn logs directory inside the poe-code folder", () => {
    expect(resolveSpawnLogDir(homeDir)).toBe("/home/user/.poe-code/spawn-logs/");
  });

  it("normalizes a trailing slash in home directory for spawn logs directory", () => {
    expect(resolveSpawnLogDir("/home/user/")).toBe("/home/user/.poe-code/spawn-logs/");
  });

  it("supports root home directory for spawn logs directory", () => {
    expect(resolveSpawnLogDir("/")).toBe("/.poe-code/spawn-logs/");
  });
});
