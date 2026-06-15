import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";

import { evalYamlSchema, validateEvalYaml } from "./schema.js";

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
  "  judge: 0.3",
  "metrics:",
  "  - id: task_completion",
  "    enabled: true",
  "    required: true",
  "    weight: 1",
  "    threshold: 1",
  "    evaluator:",
  "      kind: deterministic",
  "      config: {}",
  "  - id: plan_adherence",
  "    enabled: false",
  "    required: false",
  "    weight: 0.5",
  "    threshold: 0.8",
  "    evaluator:",
  "      kind: judge",
  "      agent: codex",
  "      model: gpt-5",
  "      instructions: Follow the supplied plan."
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
  it("prevents mutation of the exported validation schema", () => {
    expect(() => {
      delete (evalYamlSchema as unknown as { shape: Record<string, unknown> }).shape.judge;
    }).toThrow();

    const parsed = parseEvalYaml(validEvalYaml) as Record<string, unknown>;
    delete parsed.judge;
    expect(() => validateEvalYaml(parsed, "schema/eval.yaml")).toThrow("schema/eval.yaml (judge):");
  });

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
        path: "oracle",
        solution_dest: "."
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
      },
      metrics: [
        {
          id: "task_completion",
          enabled: true,
          required: true,
          weight: 1,
          threshold: 1,
          evaluator: { kind: "deterministic", config: {} }
        },
        {
          id: "plan_adherence",
          enabled: false,
          required: false,
          weight: 0.5,
          threshold: 0.8,
          evaluator: {
            kind: "judge",
            agent: "codex",
            model: "gpt-5",
            instructions: "Follow the supplied plan."
          }
        }
      ]
    });
  });

  it("accepts legacy eval.yaml without named metrics", () => {
    const parsed = parseEvalYaml(validEvalYaml) as Record<string, unknown>;
    delete parsed.metrics;

    expect(validateEvalYaml(parsed, "legacy/eval.yaml").metrics).toBeUndefined();
  });

  it("applies named metric defaults", () => {
    const parsed = parseEvalYaml(validEvalYaml) as Record<string, unknown>;
    parsed.metrics = [
      {
        id: "tool_correctness",
        evaluator: { kind: "deterministic" }
      }
    ];

    expect(validateEvalYaml(parsed, "defaults/eval.yaml").metrics).toEqual([
      {
        id: "tool_correctness",
        enabled: true,
        required: false,
        weight: 1,
        threshold: 0.8,
        evaluator: { kind: "deterministic" }
      }
    ]);
  });

  it("rejects duplicate named metric identifiers", () => {
    const parsed = parseEvalYaml(validEvalYaml) as Record<string, unknown>;
    parsed.metrics = [
      { id: "task_completion", evaluator: { kind: "deterministic" } },
      { id: "task_completion", evaluator: { kind: "deterministic" } }
    ];

    expect(() => validateEvalYaml(parsed, "duplicates/eval.yaml")).toThrow(
      "duplicates/eval.yaml (metrics.1.id): Metric identifiers must be unique."
    );
  });

  it.each([
    ["task_completion", "judge", "deterministic"],
    ["tool_correctness", "judge", "deterministic"],
    ["step_efficiency", "judge", "deterministic"],
    ["plan_adherence", "deterministic", "judge"]
  ])("requires %s to use its supported %s evaluator", (id, kind, expectedKind) => {
    const parsed = parseEvalYaml(validEvalYaml) as Record<string, unknown>;
    parsed.metrics = [{ id, evaluator: { kind } }];

    expect(() => validateEvalYaml(parsed, "evaluators/eval.yaml")).toThrow(
      `evaluators/eval.yaml (metrics.0.evaluator.kind): Metric ${id} must use a ${expectedKind} evaluator.`
    );
  });

  it("accepts eval.yaml without scorer", () => {
    const parsed = parseEvalYaml(validEvalYaml) as Record<string, unknown>;
    delete parsed.scorer;

    const result = validateEvalYaml(parsed, "smoke/eval.yaml");

    expect(result.scorer).toBeUndefined();
  });

  it("rejects plan destinations that escape the clone root", () => {
    const parsed = parseEvalYaml(validEvalYaml) as Record<string, unknown>;
    (parsed.target as Record<string, unknown>).plan_dest = "../outside.md";

    expect(() => validateEvalYaml(parsed, "escape/eval.yaml")).toThrow(
      "escape/eval.yaml (target.plan_dest): target.plan_dest must stay within the clone directory."
    );
  });

  it.each([
    [["id"], "   "],
    [["title"], "   "],
    [["target", "repo"], "   "],
    [["target", "ref"], "   "],
    [["target", "plan_dest"], "   "],
    [["scorer", "command"], "   "],
    [["scorer", "result_path"], "   "],
    [["oracle", "path"], "   "],
    [["oracle", "solution_dest"], "   "],
    [["judge", "agent"], "   "],
    [["judge", "model"], "   "],
    [["judge", "rubric", "0"], "   "],
    [["verify", "command"], "   "]
  ])("rejects blank required string at %s", (fieldPath, value) => {
    const parsed = parseEvalYaml(
      [validEvalYaml, "verify:", "  command: npm run verify", "  timeout_ms: 1000"].join("\n")
    ) as Record<string, unknown>;
    setPath(parsed, fieldPath, value);

    expect(() => validateEvalYaml(parsed, "blank/eval.yaml")).toThrow(
      `blank/eval.yaml (${fieldPath.join(".")}):`
    );
  });

  it("rejects impossible execution budgets", () => {
    const parsed = parseEvalYaml(validEvalYaml) as Record<string, unknown>;
    parsed.budget = {
      max_iterations: 0,
      max_tokens: -1,
      wall_clock_ms: -5
    };

    expect(() => validateEvalYaml(parsed, "budget/eval.yaml")).toThrow(
      "budget/eval.yaml (budget.max_iterations):"
    );
  });

  it("rejects scoring weights outside the supported range", () => {
    const parsed = parseEvalYaml(validEvalYaml) as Record<string, unknown>;
    parsed.weights = {
      tests: -1,
      judge: 2
    };

    expect(() => validateEvalYaml(parsed, "weights/eval.yaml")).toThrow(
      "weights/eval.yaml (weights.tests):"
    );
  });

  it("rejects negative verify timeouts", () => {
    const parsed = parseEvalYaml(validEvalYaml) as Record<string, unknown>;
    parsed.verify = {
      command: "npm run verify",
      timeout_ms: -1
    };

    expect(() => validateEvalYaml(parsed, "verify/eval.yaml")).toThrow(
      "verify/eval.yaml (verify.timeout_ms):"
    );
  });

  it("accepts eval.yaml with scorer", () => {
    const result = validateEvalYaml(parseEvalYaml(validEvalYaml), "smoke/eval.yaml");

    expect(result.scorer).toEqual({
      command: "npm test",
      cwd: "",
      result_path: "score.json",
      timeout_ms: 1000
    });
  });

  it.each([
    ["scorer", "command"],
    ["scorer", "result_path"],
    ["scorer", "timeout_ms"]
  ])("rejects partial scorer missing required field %s", (...fieldPath) => {
    const parsed = parseEvalYaml(validEvalYaml) as Record<string, unknown>;
    deletePath(parsed, fieldPath);

    expect(() => validateEvalYaml(parsed, "smoke/eval.yaml")).toThrow(
      `smoke/eval.yaml (${fieldPath.join(".")}):`
    );
  });

  it.each([
    ["id"],
    ["title"],
    ["target"],
    ["target", "repo"],
    ["target", "ref"],
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

function setPath(value: Record<string, unknown>, path: readonly string[], next: unknown): void {
  let current: Record<string, unknown> = value;
  for (const segment of path.slice(0, -1)) {
    current = current[segment] as Record<string, unknown>;
  }
  current[path[path.length - 1] as string] = next;
}
