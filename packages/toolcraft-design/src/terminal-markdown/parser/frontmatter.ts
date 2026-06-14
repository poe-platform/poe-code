import { FrontmatterParseError, parseFrontmatter } from "@poe-code/frontmatter";
import type { MdRange } from "../ast.js";

type ExtractedFrontmatter = {
  frontmatter?: Record<string, unknown>;
  body: string;
  range?: MdRange;
};

export function extractFrontmatter(markdown: string): ExtractedFrontmatter {
  let parsed: ReturnType<typeof parseFrontmatter>;

  try {
    parsed = parseFrontmatter(markdown);
  } catch (error) {
    if (
      error instanceof FrontmatterParseError &&
      error.message === "Missing YAML frontmatter end delimiter (---)."
    ) {
      return { body: markdown };
    }

    throw error;
  }

  if (parsed.body === markdown && Object.keys(parsed.frontmatter).length === 0) {
    return { body: markdown };
  }

  return withRange(
    {
      frontmatter: parsed.frontmatter,
      body: parsed.body
    },
    {
      start: 0,
      end: Buffer.byteLength(markdown.slice(0, markdown.length - parsed.body.length), "utf8")
    }
  );
}

function withRange<T extends ExtractedFrontmatter>(result: T, range: MdRange): T {
  if (result.frontmatter === undefined) {
    return result;
  }

  Object.defineProperty(result, "range", {
    configurable: true,
    enumerable: false,
    value: range,
    writable: true
  });

  return result;
}
