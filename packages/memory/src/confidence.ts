import { parseSourceRef, serializeSourceRef } from "./frontmatter.js";
import type { ConfidenceTag, ConfidenceVerb, TaggedClaim } from "./types.js";

export const TAG_RE = /^<!--\s*memory:(?<verb>extracted|inferred|ambiguous)(?<rest>[^>]*?)-->\s*$/;

export function parseClaims(body: string): TaggedClaim[] {
  const lines = normalizeNewlines(body).split("\n");
  const claims: TaggedClaim[] = [];
  let fenceMarker: string | undefined;

  for (let index = 0; index < lines.length; index += 1) {
    const tagLine = lines[index] ?? "";
    const currentFenceMarker = readFenceMarker(tagLine);
    if (currentFenceMarker !== undefined) {
      if (fenceMarker === undefined) {
        fenceMarker = currentFenceMarker;
      } else if (currentFenceMarker === fenceMarker) {
        fenceMarker = undefined;
      }
      continue;
    }

    if (fenceMarker !== undefined) {
      continue;
    }

    const match = TAG_RE.exec(tagLine);
    if (match?.groups?.verb === undefined) {
      continue;
    }

    const claimLines: string[] = [];
    for (let claimIndex = index + 1; claimIndex < lines.length; claimIndex += 1) {
      const line = lines[claimIndex] ?? "";
      if (line.trim().length === 0 || TAG_RE.test(line)) {
        break;
      }

      claimLines.push(line);
    }

    if (claimLines.length === 0) {
      throw new Error(`Confidence tag on line ${index + 1} is not followed by a claim paragraph.`);
    }

    claims.push({
      tag: parseTag(match.groups.verb as ConfidenceVerb, match.groups.rest ?? ""),
      body: claimLines.join("\n"),
      lineNumber: index + 1
    });
  }

  return claims;
}

function readFenceMarker(line: string): string | undefined {
  const trimmed = line.trimStart();
  if (trimmed.startsWith("```")) {
    return "```";
  }

  if (trimmed.startsWith("~~~")) {
    return "~~~";
  }

  return undefined;
}

export function serializeTag(tag: ConfidenceTag): string {
  switch (tag.verb) {
    case "extracted":
      return serializeComment("extracted", {
        source: serializeSourceRef(tag.source),
        ...(tag.note === undefined ? {} : { note: tag.note })
      });
    case "inferred":
      return serializeComment("inferred", {
        confidence: serializeConfidence(tag.confidence),
        ...(tag.source === undefined ? {} : { source: serializeSourceRef(tag.source) }),
        ...(tag.note === undefined ? {} : { note: tag.note })
      });
    case "ambiguous": {
      const reason = tag.reason.trim();
      if (reason.length === 0) {
        throw new Error('Ambiguous confidence tags require a non-empty "reason".');
      }

      return serializeComment("ambiguous", { reason });
    }
  }
}

type TagAttributes = Record<string, string>;

function parseTag(verb: ConfidenceVerb, rest: string): ConfidenceTag {
  const attrs = parseAttributes(rest);

  switch (verb) {
    case "extracted": {
      const source = attrs.source;
      if (source === undefined) {
        throw new Error('Extracted confidence tags require "source".');
      }

      assertOnlyKeys(attrs, verb, ["source", "note"]);
      return {
        verb,
        source: parseSourceRef(source),
        ...(attrs.note === undefined ? {} : { note: attrs.note })
      };
    }
    case "inferred": {
      const confidence = attrs.confidence;
      if (confidence === undefined) {
        throw new Error('Inferred confidence tags require "confidence".');
      }

      assertOnlyKeys(attrs, verb, ["confidence", "source", "note"]);
      return {
        verb,
        confidence: parseConfidence(confidence),
        ...(attrs.source === undefined ? {} : { source: parseSourceRef(attrs.source) }),
        ...(attrs.note === undefined ? {} : { note: attrs.note })
      };
    }
    case "ambiguous": {
      const reason = attrs.reason?.trim();
      if (reason === undefined || reason.length === 0) {
        throw new Error('Ambiguous confidence tags require a non-empty "reason".');
      }

      assertOnlyKeys(attrs, verb, ["reason"]);
      return {
        verb,
        reason
      };
    }
  }
}

function parseAttributes(rest: string): TagAttributes {
  const attrs: TagAttributes = Object.create(null) as TagAttributes;
  let index = 0;

  while (index < rest.length) {
    index = skipWhitespace(rest, index);
    if (index >= rest.length) {
      break;
    }

    const keyStart = index;
    while (index < rest.length && isKeyCharacter(rest[index] ?? "")) {
      index += 1;
    }

    if (keyStart === index) {
      throw new Error(`Invalid confidence tag attribute near "${rest.slice(index).trim()}".`);
    }

    const key = rest.slice(keyStart, index);
    if ((rest[index] ?? "") !== "=") {
      throw new Error(`Invalid confidence tag attribute "${key}".`);
    }

    index += 1;
    const { value, nextIndex } = readAttributeValue(rest, index);
    if (attrs[key] !== undefined) {
      throw new Error(`Duplicate confidence tag attribute "${key}".`);
    }

    attrs[key] = value;
    index = nextIndex;
  }

  return attrs;
}

function readAttributeValue(input: string, index: number): { value: string; nextIndex: number } {
  if (index >= input.length) {
    throw new Error("Missing confidence tag attribute value.");
  }

  if (input[index] === '"') {
    const endQuote = findClosingQuote(input, index + 1);
    return {
      value: JSON.parse(input.slice(index, endQuote + 1)) as string,
      nextIndex: endQuote + 1
    };
  }

  let nextIndex = index;
  while (nextIndex < input.length && !isWhitespace(input[nextIndex] ?? "")) {
    nextIndex += 1;
  }

  if (nextIndex === index) {
    throw new Error("Missing confidence tag attribute value.");
  }

  return {
    value: input.slice(index, nextIndex),
    nextIndex
  };
}

function findClosingQuote(input: string, start: number): number {
  let escaped = false;

  for (let index = start; index < input.length; index += 1) {
    const char = input[index] ?? "";
    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === '"') {
      return index;
    }
  }

  throw new Error("Unterminated quoted confidence tag attribute.");
}

function assertOnlyKeys(
  attrs: TagAttributes,
  verb: ConfidenceVerb,
  allowedKeys: string[]
): void {
  const disallowedKeys = Object.keys(attrs).filter((key) => !allowedKeys.includes(key));
  if (disallowedKeys.length > 0) {
    throw new Error(
      `${verb} confidence tags do not support: ${disallowedKeys.map((key) => `"${key}"`).join(", ")}.`
    );
  }
}

function parseConfidence(rawConfidence: string): number {
  const confidence = Number(rawConfidence);
  if (!Number.isFinite(confidence) || confidence <= 0 || confidence > 1) {
    throw new Error(`Invalid confidence value "${rawConfidence}". Expected a number in (0, 1].`);
  }

  return confidence;
}

function serializeComment(verb: ConfidenceVerb, attrs: TagAttributes): string {
  const parts = Object.entries(attrs).map(([key, value]) => `${key}=${serializeAttributeValue(key, value)}`);
  return `<!-- memory:${verb}${parts.length === 0 ? "" : ` ${parts.join(" ")}`} -->`;
}

function serializeAttributeValue(key: string, value: string): string {
  return key === "source" || key === "confidence" ? value : JSON.stringify(value);
}

function serializeConfidence(confidence: number): string {
  return String(parseConfidence(String(confidence)));
}

function normalizeNewlines(value: string): string {
  return value.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

function skipWhitespace(input: string, index: number): number {
  while (index < input.length && isWhitespace(input[index] ?? "")) {
    index += 1;
  }

  return index;
}

function isKeyCharacter(char: string): boolean {
  return (char >= "a" && char <= "z") || (char >= "A" && char <= "Z");
}

function isWhitespace(char: string): boolean {
  return char === " " || char === "\t" || char === "\n" || char === "\r";
}
