import { stringify } from "yaml";
import { FrontmatterParseError } from "./parse.js";

export function stringifyFrontmatter(frontmatter: Record<string, unknown>, body: string): string {
  try {
    assertFrontmatterRoot(frontmatter);
    assertAcyclic(frontmatter);
    return `---\n${stringify(frontmatter, { aliasDuplicateObjects: false }).trimEnd()}\n---\n${body}`;
  } catch (error) {
    if (error instanceof FrontmatterParseError) {
      throw error;
    }

    const message = error instanceof Error ? error.message : "Unknown YAML stringify error";
    throw new FrontmatterParseError(`Invalid YAML frontmatter: ${message}`);
  }
}

function assertFrontmatterRoot(value: unknown): asserts value is Record<string, unknown> {
  if (!isPlainRecord(value)) {
    throw new FrontmatterParseError("YAML frontmatter must parse to an object.");
  }
}

function assertAcyclic(value: unknown, seen: WeakSet<object> = new WeakSet()): void {
  if (typeof value !== "object" || value === null) {
    return;
  }

  if (seen.has(value)) {
    throw new FrontmatterParseError("Cannot stringify cyclic frontmatter.");
  }

  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      assertAcyclic(item, seen);
    }
  } else {
    for (const item of Object.values(value)) {
      assertAcyclic(item, seen);
    }
  }

  seen.delete(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
