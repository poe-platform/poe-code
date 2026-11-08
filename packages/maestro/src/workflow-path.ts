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
  if (name.length === 0 || name.trim() !== name || name === "." || name === "..") {
    return false;
  }

  for (const character of name) {
    if (!isWorkflowNameCharacter(character)) {
      return false;
    }
  }

  return true;
}

function isWorkflowNameCharacter(character: string): boolean {
  const code = character.charCodeAt(0);
  const isUppercase = code >= 65 && code <= 90;
  const isLowercase = code >= 97 && code <= 122;
  const isDigit = code >= 48 && code <= 57;
  return isUppercase || isLowercase || isDigit || character === "_" || character === "-";
}
