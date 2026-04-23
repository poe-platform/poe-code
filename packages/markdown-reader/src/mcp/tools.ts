import { defineCommand } from "agent-kit";
import { S } from "agent-kit-schema";
import { readMarkdown } from "../core/read-markdown.js";
import { readSection } from "../core/read-section.js";

const readParams = S.Object({
  file: S.String({ description: "Path to the markdown file" }),
  depth: S.Optional(S.Number({ description: "Limit TOC to headings at depth <= n" }))
});

export const readTool = defineCommand({
  name: "read",
  description: "Read the table of contents and frontmatter of a markdown file.",
  params: readParams,
  scope: ["mcp"],
  handler: async ({ params }) => readMarkdown(params)
});

const readSectionParams = S.Object({
  file: S.String({ description: "Path to the markdown file" }),
  section: S.String({ description: "Numeric path or exact heading text to read" }),
  includeChildren: S.Optional(S.Boolean({ description: "Include nested child sections" }))
});

export const readSectionTool = defineCommand({
  name: "read-section",
  description: "Read one markdown section, including the heading and optionally child sections.",
  params: readSectionParams,
  scope: ["mcp"],
  handler: async ({ params }) => readSection(params)
});
