import { FrontmatterParseError, parseFrontmatterDocument } from "@poe-code/frontmatter";

export interface SplitFrontmatterResult {
  frontmatter: Record<string, unknown>;
  body: string;
}

export function splitFrontmatter(markdown: string): SplitFrontmatterResult {
  try {
    const parsed = parseFrontmatterDocument(markdown);

    if (parsed.errors.length > 0) {
      const firstError = parsed.errors[0];
      const line =
        firstError?.pos === undefined ? 2 : parsed.lineCounter.linePos(firstError.pos[0]).line;
      const message = firstError?.message ?? "unknown YAML parse error";
      throw toSafeJSDiagnosticError(line, message);
    }

    return {
      frontmatter: parsed.frontmatter,
      body: parsed.body
    };
  } catch (error) {
    if (error instanceof FrontmatterParseError) {
      throw toSafeJSFrontmatterError(markdown, error);
    }

    throw error;
  }
}

function toSafeJSDiagnosticError(line: number, message: string): Error {
  if (message === "Missing YAML frontmatter end delimiter (---).") {
    return new Error(`Invalid frontmatter at line ${line}: missing closing delimiter (---).`);
  }

  if (message === "YAML frontmatter must parse to an object.") {
    return new Error(`Invalid frontmatter at line ${line}: expected a YAML mapping.`);
  }

  return new Error(`Invalid YAML frontmatter at line ${line}: ${message}`);
}

function toSafeJSFrontmatterError(markdown: string, error: FrontmatterParseError): Error {
  if (error.message === "Missing YAML frontmatter end delimiter (---).") {
    return new Error(
      `Invalid frontmatter at line ${countLines(stripByteOrderMark(markdown))}: missing closing delimiter (---).`
    );
  }

  if (error.message === "YAML frontmatter must parse to an object.") {
    return new Error("Invalid frontmatter at line 2: expected a YAML mapping.");
  }

  if (error.message.startsWith("Invalid YAML frontmatter: ")) {
    return new Error(`Invalid YAML frontmatter at line 2: ${error.message.slice(26)}`);
  }

  return error;
}

function stripByteOrderMark(value: string): string {
  return value.startsWith("\uFEFF") ? value.slice(1) : value;
}

function countLines(value: string): number {
  let count = 1;

  for (const character of value) {
    if (character === "\n") {
      count += 1;
    }
  }

  return count;
}
