import { S, validate } from "toolcraft-schema";
import type { Static, ValidationIssue } from "toolcraft-schema";

export const evalYamlSchema = S.Object({
  id: S.String(),
  title: S.String(),
  target: S.Object({
    repo: S.String(),
    ref: S.String(),
    plan_dest: S.Optional(S.String({ default: "docs/plans/eval-task.md" }))
  }),
  scorer: S.Object({
    command: S.String(),
    cwd: S.Optional(S.String({ default: "" })),
    result_path: S.String(),
    timeout_ms: S.Number()
  }),
  oracle: S.Object({
    path: S.Optional(S.String({ default: "oracle" }))
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
  verify: S.Optional(
    S.Object({
      command: S.String(),
      timeout_ms: S.Number()
    })
  )
});

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
    return result.value;
  }

  throw new EvalYamlValidationError(formatIssues(filePath, result.issues), result.issues);
}

function formatIssues(filePath: string, issues: readonly ValidationIssue[]): string {
  return issues
    .map((issue) => `${filePath} (${formatPath(issue.path)}): ${issue.message}`)
    .join("\n");
}

function formatPath(path: readonly string[]): string {
  return path.join(".") || "value";
}
