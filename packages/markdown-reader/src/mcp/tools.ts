import { defineCommand } from "toolcraft";
import { S } from "toolcraft-schema";
import { readMarkdown } from "../core/read-markdown.js";
import { readSection } from "../core/read-section.js";

const readParams = S.Object({
  file: S.String({ description: "Path to the markdown file" }),
  depth: S.Optional(S.Number({ description: "Limit TOC to headings at depth <= n" }))
});

const tocEntryResult = S.Object({
  depth: S.Number(),
  number: S.String({ nullable: true }),
  title: S.String()
});

export const readTool = defineCommand({
  name: "read",
  description: "Read the table of contents and frontmatter of a markdown file.",
  params: readParams,
  result: S.Object({
    file: S.String(),
    frontmatter: S.Record(S.Json()),
    sections: S.Array(tocEntryResult)
  }),
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
  result: S.Object({
    file: S.String(),
    section: tocEntryResult,
    markdown: S.String()
  }),
  scope: ["mcp"],
  handler: async ({ params }) => readSection(params)
});
