import path from "node:path";

export function resolveWorkflowPath(name: string | undefined, cwd: string): string {
  if (name !== undefined && !isValidWorkflowName(name)) {
    throw new Error(
      `Invalid workflow name "${name}". Expected a non-empty id without path separators.`
    );
  }

  const filename =
    name === undefined || name === "default" ? "WORKFLOW.md" : `${name.toUpperCase()}.WORKFLOW.md`;
  return path.resolve(cwd, filename);
}

function isValidWorkflowName(name: string): boolean {
  return name.length > 0 && !name.includes("/") && !name.includes("\\");
}
