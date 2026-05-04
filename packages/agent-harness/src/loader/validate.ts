import { validate } from "toolcraft-schema";
import type { AnySchema as SchemaDescriptor, Static, ValidationIssue } from "toolcraft-schema";

export class FrontmatterValidationError extends Error {
  readonly issues: readonly ValidationIssue[];

  constructor(message: string, issues: readonly ValidationIssue[]) {
    super(message);
    this.name = "FrontmatterValidationError";
    this.issues = issues;
  }
}

export function validateFrontmatter<S extends SchemaDescriptor>(
  schema: S,
  frontmatter: Record<string, unknown>,
  mdPath: string
): Static<S> {
  const result = validate(schema, frontmatter);

  if (result.ok) {
    return result.value;
  }

  throw new FrontmatterValidationError(formatIssues(mdPath, result.issues), result.issues);
}

function formatIssues(mdPath: string, issues: readonly ValidationIssue[]): string {
  return issues.map((issue) => `${mdPath}: ${formatPath(issue.path)}: ${issue.message}`).join("\n");
}

function formatPath(path: readonly string[]): string {
  return path.join(".") || "frontmatter";
}
