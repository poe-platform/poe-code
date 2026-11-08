import { isAbsolute, resolve } from "node:path";
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";

import { listEvals, loadEval } from "./registry.js";
import type { EvalFs, EvalSource } from "../types.js";

const evalYaml = [
  "id: smoke",
  "title: Smoke eval",
  "target:",
  "  repo: https://example.com/repo.git",
  "  ref: main",
  "scorer:",
  "  command: npm test",
  "  result_path: score.json",
  "  timeout_ms: 1000",
  "oracle: {}",
  "budget:",
  "  max_iterations: 10",
  "  max_tokens: 1000",
  "  wall_clock_ms: 60000",
  "judge:",
  "  agent: codex",
  "  model: gpt-5",
  "  rubric:",
  "    - completeness",
  "weights:",
  "  tests: 0.7",
  "  judge: 0.3",
  "metrics:",
  "  - id: step_efficiency",
  "    enabled: true",
  "    required: false",
  "    weight: 0.2",
  "    threshold: 0.8",
  "    evaluator:",
  "      kind: deterministic",
  "      config:",
  "        max_steps: 12"
].join("\n");

function memfs(
  files: Record<string, string | null>,
  cwd = "/"
): EvalFs & { symlink(target: string, path: string): Promise<void> } {
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

async function withObjectPrototypeProperties<T>(
  properties: Record<string, unknown>,
  callback: () => Promise<T> | T
): Promise<T> {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(properties)) {
    originals.set(key, Object.getOwnPropertyDescriptor(Object.prototype, key));
    Object.defineProperty(Object.prototype, key, {
      configurable: true,
      value,
      writable: true
    });
  }

  try {
    return await callback();
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor === undefined) {
        delete (Object.prototype as Record<string, unknown>)[key];
      } else {
        Object.defineProperty(Object.prototype, key, descriptor);
      }
    }
  }
}

describe("eval source registry", () => {
  const source: EvalSource = { rootDir: "/repo/evals" };

  it("shallow-scans directory names containing eval.yaml", async () => {
    const fs = memfs({
      "/repo/evals/zebra/eval.yaml": evalYaml.replace("id: smoke", "id: zebra"),
      "/repo/evals/alpha/eval.yaml": evalYaml.replace("id: smoke", "id: alpha"),
      "/repo/evals/README.md": "# Evals",
      "/repo/evals/notes": null
    });

    await expect(listEvals(source, fs)).resolves.toEqual(["alpha", "zebra"]);
  });

  it("does not discover nested eval directories", async () => {
    const fs = memfs({
      "/repo/evals/group/smoke/eval.yaml": evalYaml
    });

    await expect(listEvals(source, fs)).resolves.toEqual([]);
  });

  it("does not treat inherited stat error codes as missing eval files", async () => {
    const raw = memfs({
      "/repo/evals/smoke/eval.yaml": evalYaml
    });
    const fs: EvalFs = {
      ...raw,
      stat: async (filePath) => {
        if (filePath === "/repo/evals/smoke/eval.yaml") {
          throw new Error("eval stat denied");
        }

        return raw.stat(filePath);
      }
    };

    await withObjectPrototypeProperties({ code: "ENOENT" }, async () => {
      await expect(listEvals(source, fs)).rejects.toThrow("eval stat denied");
    });
  });

  it("loads eval.yaml and plan.md frontmatter", async () => {
    const fs = memfs({
      "/repo/evals/smoke/eval.yaml": evalYaml,
      "/repo/evals/smoke/plan.md": ["---", "kind: pipeline", "---", "Run the task."].join("\n")
    });

    await expect(loadEval(source, "smoke", fs)).resolves.toMatchObject({
      id: "smoke",
      title: "Smoke eval",
      target: {
        planDest: "docs/plans/eval-task.md"
      },
      scorer: {
        cwd: "",
        resultPath: "score.json",
        timeoutMs: 1000
      },
      oracle: {
        path: "oracle",
        solutionDest: "."
      },
      metrics: [
        {
          id: "step_efficiency",
          enabled: true,
          required: false,
          weight: 0.2,
          threshold: 0.8,
          evaluator: { kind: "deterministic", config: { max_steps: 12 } }
        }
      ],
      plan: {
        path: "/repo/evals/smoke/plan.md",
        kind: "pipeline",
        body: "Run the task."
      }
    });
  });

  it("rejects eval.yaml ids that do not match the selected directory", async () => {
    const fs = memfs({
      "/repo/evals/smoke/eval.yaml": evalYaml.replace("id: smoke", "id: other"),
      "/repo/evals/smoke/plan.md": ["---", "kind: plan", "---", "Run the task."].join("\n")
    });

    await expect(loadEval(source, "smoke", fs)).rejects.toThrow(
      'Eval id mismatch in /repo/evals/smoke/eval.yaml: expected "smoke", found "other".'
    );
  });

  it("rejects unsupported plan kind in plan.md", async () => {
    const fs = memfs({
      "/repo/evals/smoke/eval.yaml": evalYaml,
      "/repo/evals/smoke/plan.md": ["---", "kind: unknown", "---", "Run the task."].join("\n")
    });

    await expect(loadEval(source, "smoke", fs)).rejects.toThrow(
      'Unsupported plan kind "unknown" in /repo/evals/smoke/plan.md. Expected one of: plan, pipeline, superintendent, experiment.'
    );
  });

  it("rejects invalid plan frontmatter with the plan path", async () => {
    const fs = memfs({
      "/repo/evals/smoke/eval.yaml": evalYaml,
      "/repo/evals/smoke/plan.md": ["---", "kind: [", "---", "Run the task."].join("\n")
    });

    await expect(loadEval(source, "smoke", fs)).rejects.toThrow(
      "Failed to parse /repo/evals/smoke/plan.md frontmatter:"
    );
  });

  it("rejects eval ids outside the first-level source directory", async () => {
    const fs = memfs({
      "/repo/evals/smoke/eval.yaml": evalYaml,
      "/repo/evals/smoke/plan.md": ["---", "kind: plan", "---", "Run the task."].join("\n")
    });

    await expect(loadEval(source, "../smoke", fs)).rejects.toThrow(
      'Invalid eval id "../smoke". Eval ids must be first-level directory names.'
    );
  });

  it("rejects an eval definition symlinked outside the source directory", async () => {
    const fs = memfs({
      "/repo/evals/smoke/plan.md": ["---", "kind: plan", "---", "Run the task."].join("\n"),
      "/outside/eval.yaml": evalYaml
    });
    await fs.symlink("/outside/eval.yaml", "/repo/evals/smoke/eval.yaml");

    await expect(loadEval(source, "smoke", fs)).rejects.toThrow(
      "eval.yaml must stay within the canonical source directory."
    );
  });

  it("rejects a plan symlinked outside the source directory", async () => {
    const fs = memfs({
      "/repo/evals/smoke/eval.yaml": evalYaml,
      "/outside/plan.md": ["---", "kind: plan", "---", "External task."].join("\n")
    });
    await fs.symlink("/outside/plan.md", "/repo/evals/smoke/plan.md");

    await expect(loadEval(source, "smoke", fs)).rejects.toThrow(
      "plan.md must stay within the canonical source directory."
    );
  });
});
