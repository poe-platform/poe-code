export function sanitizeWorkspaceKey(qualifiedId: string): string {
  if (qualifiedId.length === 0) {
    throw new Error("qualifiedId must not be empty");
  }

  let sanitized = "";

  for (const character of qualifiedId) {
    sanitized += isWorkspaceKeyCharacter(character) ? character : "_";
  }

  return sanitized;
}

function isWorkspaceKeyCharacter(character: string): boolean {
  const code = character.charCodeAt(0);

  return (
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    (code >= 48 && code <= 57) ||
    character === "." ||
    character === "_" ||
    character === "-"
  );
}
