import { S, validate } from "toolcraft-schema";
import type { Static, ValidationIssue } from "toolcraft-schema";
import path from "node:path";

const nonEmptyString = S.String({ minLength: 1 });
const positiveInteger = S.Number({ jsonType: "integer", minimum: 1 });
const nonNegativeInteger = S.Number({ jsonType: "integer", minimum: 0 });
const scoringWeight = S.Number({ minimum: 0, maximum: 1 });

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
  id: nonEmptyString,
  title: nonEmptyString,
  target: S.Object({
    repo: nonEmptyString,
    ref: nonEmptyString,
    plan_dest: S.Optional(S.String({ default: "docs/plans/eval-task.md", minLength: 1 }))
  }),
  scorer: S.Optional(
    S.Object({
      command: nonEmptyString,
      cwd: S.Optional(S.String({ default: "" })),
      result_path: nonEmptyString,
      timeout_ms: nonNegativeInteger
    })
  ),
  oracle: S.Object({
    path: S.Optional(S.String({ default: "oracle", minLength: 1 })),
    solution_dest: S.Optional(S.String({ default: ".", minLength: 1 }))
  }),
  budget: S.Object({
    max_iterations: positiveInteger,
    max_tokens: positiveInteger,
    wall_clock_ms: positiveInteger
  }),
  judge: S.Object({
    agent: nonEmptyString,
    model: nonEmptyString,
    rubric: S.Array(nonEmptyString, { minItems: 1 })
  }),
  weights: S.Object({
    tests: scoringWeight,
    judge: scoringWeight
  }),
  metrics: S.Optional(S.Array(metricSchema)),
  verify: S.Optional(
    S.Object({
      command: nonEmptyString,
      timeout_ms: nonNegativeInteger
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
      ...validateNonBlankStrings(result.value),
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

function validateNonBlankStrings(value: EvalYaml): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const fields: Array<[readonly string[], string | undefined]> = [
    [["id"], value.id],
    [["title"], value.title],
    [["target", "repo"], value.target.repo],
    [["target", "ref"], value.target.ref],
    [["target", "plan_dest"], value.target.plan_dest],
    [["scorer", "command"], value.scorer?.command],
    [["scorer", "result_path"], value.scorer?.result_path],
    [["oracle", "path"], value.oracle.path],
    [["oracle", "solution_dest"], value.oracle.solution_dest],
    [["judge", "agent"], value.judge.agent],
    [["judge", "model"], value.judge.model],
    [["verify", "command"], value.verify?.command]
  ];

  for (const [fieldPath, fieldValue] of fields) {
    if (fieldValue !== undefined && fieldValue.trim().length === 0) {
      issues.push(blankStringIssue(fieldPath, fieldValue));
    }
  }

  for (const [index, rubricLine] of value.judge.rubric.entries()) {
    if (rubricLine.trim().length === 0) {
      issues.push(blankStringIssue(["judge", "rubric", String(index)], rubricLine));
    }
  }

  return issues;
}

function blankStringIssue(path: readonly string[], value: string): ValidationIssue {
  return {
    path,
    expected: "non-blank string",
    received: JSON.stringify(value),
    message: `${path.join(".")} must not be blank.`
  };
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
