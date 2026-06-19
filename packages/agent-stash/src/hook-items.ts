export function hookItemName(event: string, matcher: unknown, groupIndex: number, hookIndex: number): string {
  return `${event}-${matcherSlug(matcher)}-${indexSegment(groupIndex)}-${indexSegment(hookIndex)}`;
}

export function hookEventFromFragmentContent(content: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) {
    return undefined;
  }
  if (isRecord(parsed.agentStash) && typeof parsed.agentStash.hookEvent === "string") {
    return parsed.agentStash.hookEvent;
  }
  if (!isRecord(parsed.hooks)) {
    return undefined;
  }
  const events = Object.keys(parsed.hooks);
  return events.length === 1 ? events[0] : undefined;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
