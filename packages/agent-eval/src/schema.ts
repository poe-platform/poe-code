import { S, validate } from "toolcraft-schema";
import type { Static, ValidationIssue } from "toolcraft-schema";
import path from "node:path";

const metricEvaluatorSchema = S.OneOf({
  discriminator: "kind",
  branches: {
    deterministic: S.Object({
      config: S.Optional(S.Json())
    }),
    judge: S.Object({
      agent: S.Optional(S.String()),
      model: S.Optional(S.String()),
      instructions: S.Optional(S.String()),
      config: S.Optional(S.Json())
    })
  }
});

const metricSchema = S.Object({
  id: S.Enum(["task_completion", "plan_adherence", "tool_correctness", "step_efficiency"]),
  enabled: S.Optional(S.Boolean({ default: true })),
  required: S.Optional(S.Boolean({ default: false })),
  weight: S.Optional(S.Number({ default: 1, minimum: 0 })),
  threshold: S.Optional(S.Number({ default: 0.8, minimum: 0, maximum: 1 })),
  evaluator: metricEvaluatorSchema
});

/**
 * Schema for an eval.yaml file.
 *
 * Canonical oracle layout:
 *
 * oracle/
 * ├── solution/    # reference implementation; used by `eval check`
 * └── tests/       # vitest *.test.ts files; the default scorer
 *
 * Keep oracle.path at its default value of "oracle" unless an eval has a
 * strong reason to use a different folder.
 *
 * eval check copies oracle/solution/* into the clone root by default. Use
 * oracle.solution_dest to copy it under a clone-root-relative subdirectory.
 */
export const evalYamlSchema = S.Object({
  id: S.String(),
  title: S.String(),
  target: S.Object({
    repo: S.String(),
    ref: S.String(),
    plan_dest: S.Optional(S.String({ default: "docs/plans/eval-task.md" }))
  }),
  scorer: S.Optional(
    S.Object({
      command: S.String(),
      cwd: S.Optional(S.String({ default: "" })),
      result_path: S.String(),
      timeout_ms: S.Number()
    })
  ),
  oracle: S.Object({
    path: S.Optional(S.String({ default: "oracle" })),
    solution_dest: S.Optional(S.String({ default: "." }))
  }),
  budget: S.Object({
    max_iterations: S.Number(),
    max_tokens: S.Number(),
    wall_clock_ms: S.Number()
  }),
  judge: S.Object({
    agent: S.String(),
    model: S.String(),
    rubric: S.Array(S.String())
  }),
  weights: S.Object({
    tests: S.Number(),
    judge: S.Number()
  }),
  metrics: S.Optional(S.Array(metricSchema)),
  verify: S.Optional(
    S.Object({
      command: S.String(),
      timeout_ms: S.Number()
    })
  )
});
Object.freeze(evalYamlSchema.shape);
Object.freeze(evalYamlSchema);

export type EvalYaml = Static<typeof evalYamlSchema>;

export class EvalYamlValidationError extends Error {
  readonly issues: readonly ValidationIssue[];

  constructor(message: string, issues: readonly ValidationIssue[]) {
    super(message);
    this.name = "EvalYamlValidationError";
    this.issues = issues;
  }
}

export function validateEvalYaml(value: unknown, filePath = "eval.yaml"): EvalYaml {
  const result = validate(evalYamlSchema, value);

  if (result.ok) {
    const issues = [
      ...validateTarget(result.value.target),
      ...validateMetrics(result.value.metrics)
    ];
    if (issues.length > 0) {
      throw new EvalYamlValidationError(formatIssues(filePath, issues), issues);
    }
    return result.value;
  }

  throw new EvalYamlValidationError(formatIssues(filePath, result.issues), result.issues);
}

function validateTarget(target: EvalYaml["target"]): readonly ValidationIssue[] {
  const destination = target.plan_dest ?? "docs/plans/eval-task.md";
  if (path.isAbsolute(destination)) {
    return [invalidPlanDestination(destination)];
  }

  const resolved = path.resolve("/clone", destination);
  const relative = path.relative("/clone", resolved);
  return relative === ".." || relative.startsWith(`..${path.sep}`)
    ? [invalidPlanDestination(destination)]
    : [];
}

function invalidPlanDestination(destination: string): ValidationIssue {
  return {
    path: ["target", "plan_dest"],
    expected: "clone-contained relative path",
    received: destination,
    message: "target.plan_dest must stay within the clone directory."
  };
}

function validateMetrics(metrics: EvalYaml["metrics"]): readonly ValidationIssue[] {
  if (metrics === undefined) {
    return [];
  }

  const issues: ValidationIssue[] = [];
  const identifiers = new Set<string>();

  for (const [index, metric] of metrics.entries()) {
    if (identifiers.has(metric.id)) {
      issues.push({
        path: ["metrics", String(index), "id"],
        expected: "unique metric identifier",
        received: metric.id,
        message: "Metric identifiers must be unique."
      });
    }
    identifiers.add(metric.id);

    const expectedKind = metric.id === "plan_adherence" ? "judge" : "deterministic";
    if (metric.evaluator.kind !== expectedKind) {
      issues.push({
        path: ["metrics", String(index), "evaluator", "kind"],
        expected: expectedKind,
        received: metric.evaluator.kind,
        message: `Metric ${metric.id} must use a ${expectedKind} evaluator.`
      });
    }
  }

  return issues;
}

function formatIssues(filePath: string, issues: readonly ValidationIssue[]): string {
  return issues
    .map((issue) => `${filePath} (${formatPath(issue.path)}): ${issue.message}`)
    .join("\n");
}

function formatPath(path: readonly string[]): string {
  return path.join(".") || "value";
}
