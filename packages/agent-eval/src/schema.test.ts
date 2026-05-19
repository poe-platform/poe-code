import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";

import { validateEvalYaml } from "./schema.js";

const validEvalYaml = [
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
  "  judge: 0.3"
].join("\n");

function parseEvalYaml(input: string): unknown {
  return parseYaml(input);
}

function deletePath(value: Record<string, unknown>, path: readonly string[]): void {
  let current: Record<string, unknown> = value;
  for (const segment of path.slice(0, -1)) {
    current = current[segment] as Record<string, unknown>;
  }
  delete current[path[path.length - 1] as string];
}

describe("eval yaml schema", () => {
  it("accepts a valid eval.yaml and applies defaults", () => {
    const result = validateEvalYaml(parseEvalYaml(validEvalYaml), "smoke/eval.yaml");

    expect(result).toEqual({
      id: "smoke",
      title: "Smoke eval",
      target: {
        repo: "https://example.com/repo.git",
        ref: "main",
        plan_dest: "docs/plans/eval-task.md"
      },
      scorer: {
        command: "npm test",
        cwd: "",
        result_path: "score.json",
        timeout_ms: 1000
      },
      oracle: {
        path: "oracle"
      },
      budget: {
        max_iterations: 10,
        max_tokens: 1000,
        wall_clock_ms: 60000
      },
      judge: {
        agent: "codex",
        model: "gpt-5",
        rubric: ["completeness"]
      },
      weights: {
        tests: 0.7,
        judge: 0.3
      }
    });
  });

  it.each([
    ["id"],
    ["title"],
    ["target"],
    ["target", "repo"],
    ["target", "ref"],
    ["scorer"],
    ["scorer", "command"],
    ["scorer", "result_path"],
    ["scorer", "timeout_ms"],
    ["oracle"],
    ["budget"],
    ["budget", "max_iterations"],
    ["budget", "max_tokens"],
    ["budget", "wall_clock_ms"],
    ["judge"],
    ["judge", "agent"],
    ["judge", "model"],
    ["judge", "rubric"],
    ["weights"],
    ["weights", "tests"],
    ["weights", "judge"]
  ])("rejects missing required field %s", (...fieldPath) => {
    const parsed = parseEvalYaml(validEvalYaml) as Record<string, unknown>;
    deletePath(parsed, fieldPath);

    expect(() => validateEvalYaml(parsed, "smoke/eval.yaml")).toThrow(
      `smoke/eval.yaml (${fieldPath.join(".")}):`
    );
  });

  it("accepts optional verify when present", () => {
    const result = validateEvalYaml(
      parseEvalYaml(
        [validEvalYaml, "verify:", "  command: npm run verify", "  timeout_ms: 500"].join("\n")
      ),
      "smoke/eval.yaml"
    );

    expect(result.verify).toEqual({
      command: "npm run verify",
      timeout_ms: 500
    });
  });
});
