import { isAbsolute, resolve } from "node:path";
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";

import { loadSourceConfig } from "./config.js";
import type { EvalFs, EvalSource } from "../types.js";

function memfs(files: Record<string, string | null>, cwd = "/"): EvalFs {
  const volume = Volume.fromJSON(files, "/");
  const fs = createFsFromVolume(volume).promises;

  return {
    readdir(path, options) {
      return fs.readdir(isAbsolute(path) ? path : resolve(cwd, path), options);
    },
    readFile(path, encoding) {
      return fs.readFile(isAbsolute(path) ? path : resolve(cwd, path), encoding);
    },
    stat(path) {
      return fs.stat(isAbsolute(path) ? path : resolve(cwd, path));
    }
  } as EvalFs;
}

describe("loadSourceConfig", () => {
  const source: EvalSource = { rootDir: "/repo/evals" };

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

  it("throws a clear error for bad JSON", async () => {
    const fs = memfs({
      "/repo/evals/.poe-code-eval.json": "{"
    });

    await expect(loadSourceConfig(source, fs)).rejects.toThrow(
      "Failed to parse /repo/evals/.poe-code-eval.json:"
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
