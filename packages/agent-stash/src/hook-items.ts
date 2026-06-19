export function hookItemName(event: string, matcher: unknown, groupIndex: number, hookIndex: number): string {
  return `${event}-${matcherSlug(matcher)}-${indexSegment(groupIndex)}-${indexSegment(hookIndex)}`;
}

function matcherSlug(matcher: unknown): string {
  if (typeof matcher !== "string" || matcher.trim().length === 0) {
    return "all-tools";
  }
  const parts: string[] = [];
  let previousWasDash = true;
  for (const character of matcher.trim()) {
    if (isAsciiAlphaNumeric(character)) {
      parts.push(character);
      previousWasDash = false;
      continue;
    }
    if (!previousWasDash) {
      parts.push("-");
      previousWasDash = true;
    }
  }
  if (parts.at(-1) === "-") {
    parts.pop();
  }
  return parts.length === 0 ? "all-tools" : parts.join("");
}

function indexSegment(index: number): string {
  return String(index + 1).padStart(3, "0");
}

function isAsciiAlphaNumeric(character: string): boolean {
  const code = character.charCodeAt(0);
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}
