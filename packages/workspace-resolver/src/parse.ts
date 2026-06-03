import type { ParsedLocator } from "./types.js";

export function parseLocator(input: string): ParsedLocator {
  const value = input.trim();
  if (value.length === 0 || looksLikeWindowsDrivePath(value)) {
    return { scheme: "local", path: value };
  }

  const schemeSeparator = value.indexOf("://");
  if (schemeSeparator === -1) {
    return { scheme: "local", path: value };
  }

  const scheme = value.slice(0, schemeSeparator).toLowerCase();
  const rest = value.slice(schemeSeparator + 3);

  if (scheme === "github") {
    return parseGithubLocator(rest);
  }

  if (scheme === "ssh") {
    return parseSshLocator(value);
  }

  if (scheme === "docker") {
    return parseDockerLocator(rest);
  }

  throw new Error(`Unsupported workspace locator scheme "${scheme}".`);
}

function parseGithubLocator(input: string): Extract<ParsedLocator, { scheme: "github" }> {
  const { head, tail } = splitOnce(input, "#");
  const segments = splitPathSegments(head);
  const owner = segments[0];
  const repo = segments[1];

  if (!owner || !repo) {
    throw new Error(`Invalid github workspace locator "${input}".`);
  }

  const pathSubdir = joinPathSegments(segments.slice(2));
  let ref: string | undefined;
  let fragmentSubdir: string | undefined;

  if (tail !== undefined && tail.length > 0) {
    const refParts = splitOnce(tail, ":");
    ref = refParts.head || undefined;
    fragmentSubdir = refParts.tail || undefined;
  }

  if (pathSubdir && fragmentSubdir) {
    throw new Error(`Invalid github workspace locator "${input}".`);
  }

  const subdir = pathSubdir || fragmentSubdir;
  if (subdir !== undefined && hasUnsafeSubdirectorySegment(subdir)) {
    throw new Error(`Invalid github workspace subdirectory "${subdir}".`);
  }

  return {
    scheme: "github",
    owner,
    repo,
    ...(ref ? { ref } : {}),
    ...(subdir ? { subdir } : {})
  };
}

function hasUnsafeSubdirectorySegment(subdir: string): boolean {
  return subdir.split("/").some((segment) => segment === "." || segment === "..");
}

function parseSshLocator(input: string): Extract<ParsedLocator, { scheme: "ssh" }> {
  const url = new URL(input);
  const host = url.hostname;
  const pathname = url.pathname;

  if (!host || pathname.length === 0) {
    throw new Error(`Invalid ssh workspace locator "${input}".`);
  }

  const port = url.port.length > 0 ? Number.parseInt(url.port, 10) : undefined;

  return {
    scheme: "ssh",
    ...(url.username ? { user: decodeURIComponent(url.username) } : {}),
    host,
    ...(port !== undefined ? { port } : {}),
    path: pathname
  };
}

function parseDockerLocator(input: string): Extract<ParsedLocator, { scheme: "docker" }> {
  const slashIndex = input.indexOf("/");
  if (slashIndex === -1) {
    throw new Error(`Invalid docker workspace locator "${input}".`);
  }

  const container = input.slice(0, slashIndex);
  const path = input.slice(slashIndex);
  if (container.length === 0 || path.length === 0) {
    throw new Error(`Invalid docker workspace locator "${input}".`);
  }

  return {
    scheme: "docker",
    container,
    path
  };
}

function splitOnce(
  input: string,
  separator: string
): { head: string; tail?: string } {
  const index = input.indexOf(separator);
  if (index === -1) {
    return { head: input };
  }

  return {
    head: input.slice(0, index),
    tail: input.slice(index + separator.length)
  };
}

function splitPathSegments(input: string): string[] {
  const segments: string[] = [];
  let current = "";

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char === "/") {
      if (current.length > 0) {
        segments.push(current);
      }
      current = "";
      continue;
    }
    current += char;
  }

  if (current.length > 0) {
    segments.push(current);
  }

  return segments;
}

function joinPathSegments(segments: string[]): string | undefined {
  if (segments.length === 0) {
    return undefined;
  }

  let output = segments[0] ?? "";
  for (let index = 1; index < segments.length; index += 1) {
    output += `/${segments[index]}`;
  }
  return output;
}

function looksLikeWindowsDrivePath(input: string): boolean {
  if (input.length < 3 || input[1] !== ":") {
    return false;
  }

  const drive = input.charCodeAt(0);
  const isLetter =
    (drive >= 65 && drive <= 90) ||
    (drive >= 97 && drive <= 122);

  if (!isLetter) {
    return false;
  }

  const separator = input[2];
  return separator === "\\" || separator === "/";
}
