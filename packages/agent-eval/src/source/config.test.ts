import { isAbsolute, resolve } from "node:path";
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";

import { defaultSourceConfig, loadSourceConfig } from "./config.js";
import type { EvalFs, EvalSource } from "../types.js";

function memfs(files: Record<string, string | null>, cwd = "/"): EvalFs & { symlink(target: string, path: string): Promise<void> } {
  const volume = Volume.fromJSON(files, "/");
  const fs = createFsFromVolume(volume).promises;

  return {
    readdir(path, options) {
      return fs.readdir(isAbsolute(path) ? path : resolve(cwd, path), options);
    },
    readFile(path, encoding) {
      return fs.readFile(isAbsolute(path) ? path : resolve(cwd, path), encoding);
    },
    realpath(path) {
      return fs.realpath(isAbsolute(path) ? path : resolve(cwd, path)) as Promise<string>;
    },
    symlink(target, path) {
      return fs.symlink(target, isAbsolute(path) ? path : resolve(cwd, path));
    },
    stat(path) {
      return fs.stat(isAbsolute(path) ? path : resolve(cwd, path));
    }
  } as EvalFs;
}

describe("loadSourceConfig", () => {
  const source: EvalSource = { rootDir: "/repo/evals" };

  it("prevents mutation of exported default source settings", () => {
    expect(() => {
      defaultSourceConfig.out = "redirected-runs";
    }).toThrow();
    expect(defaultSourceConfig.out).toBe("runs");
  });

  it("returns defaults when .poe-code-eval.json is missing", async () => {
    const fs = memfs({
      "/repo/evals": null
    });

    await expect(loadSourceConfig(source, fs)).resolves.toEqual({
      judge: {
        agent: "claude-code",
        model: "opus-4.7"
      },
      out: "runs",
      weights: {
        tests: 0.7,
        judge: 0.3
      },
      clone_cache_dir: null
    });
  });

  it("deep-merges a partial config with defaults", async () => {
    const fs = memfs({
      "/repo/evals/.poe-code-eval.json": JSON.stringify({
        judge: {
          model: "sonnet-4.5"
        },
        weights: {
          judge: 0.4
        }
      })
    });

    await expect(loadSourceConfig(source, fs)).resolves.toEqual({
      judge: {
        agent: "claude-code",
        model: "sonnet-4.5"
      },
      out: "runs",
      weights: {
        tests: 0.7,
        judge: 0.4
      },
      clone_cache_dir: null
    });
  });

  it("preserves special source config fields as own data properties", async () => {
    const fs = memfs({
      "/repo/evals/.poe-code-eval.json": '{"__proto__":{"injected":"yes"}}'
    });

    const config = await loadSourceConfig(source, fs) as unknown as Record<string, unknown>;

    expect(Object.hasOwn(config, "__proto__")).toBe(true);
    expect(config["__proto__"]).toEqual({ injected: "yes" });
    expect((config as { injected?: string }).injected).toBeUndefined();
  });

  it("throws a clear error for bad JSON", async () => {
    const fs = memfs({
      "/repo/evals/.poe-code-eval.json": "{"
    });

    await expect(loadSourceConfig(source, fs)).rejects.toThrow(
      "Failed to parse /repo/evals/.poe-code-eval.json:"
    );
  });

  it("rejects config files symlinked outside the source directory", async () => {
    const fs = memfs({
      "/repo/evals": null,
      "/outside/config.json": JSON.stringify({ out: "external" })
    });
    await fs.symlink(
      "/outside/config.json",
      "/repo/evals/.poe-code-eval.json"
    );

    await expect(loadSourceConfig(source, fs)).rejects.toThrow(
      "source.config must stay within the canonical source directory."
    );
  });

  it("returns fresh default objects for each missing config load", async () => {
    const fs = memfs({
      "/repo/evals": null
    });
    const first = await loadSourceConfig(source, fs);
    first.judge.agent = "mutated";
    first.weights.tests = 0;

    await expect(loadSourceConfig(source, fs)).resolves.toEqual({
      judge: {
        agent: "claude-code",
        model: "opus-4.7"
      },
      out: "runs",
      weights: {
        tests: 0.7,
        judge: 0.3
      },
      clone_cache_dir: null
    });
  });
});
