import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { inputRequestSchema } from "../../tiny-stdio-mcp-server/dist/input-request-schema.js";

const original = new URL(
  "../../tiny-stdio-mcp-server/src/input-request-schema.ts",
  import.meta.url
);
const source = readFileSync(original, "utf8");
const parsed = ts.createSourceFile(fileURLToPath(original), source, ts.ScriptTarget.Latest, true);
const notice = ts
  .getLeadingCommentRanges(parsed.getFullText(), 0)
  ?.find((comment) => source.slice(comment.pos, comment.pos + 3) === "/*!");
if (notice === undefined) throw new Error("MCP schema licensing notice is missing");
const schema = structuredClone(inputRequestSchema);
schema.$comment =
  "Derived from MCP 2026-07-28 normative schema definitions in tiny-stdio-mcp-server. Metadata and extension key formats added for repository conformance. See MCP-LICENSE.txt for upstream licensing and source notices.";
for (const name of ["MetaObject", "ResultMetaObject"])
  schema.$defs[name].propertyNames = { format: "mcp-metadata-key" };
for (const name of ["ClientCapabilities", "ServerCapabilities"])
  schema.$defs[name].properties.extensions.propertyNames = { format: "mcp-extension-key" };
mkdirSync(new URL("../schema", import.meta.url), { recursive: true });
writeFileSync(
  new URL("../schema/protocol.json", import.meta.url),
  JSON.stringify(schema, null, 2) + "\n"
);
const notices = ts.getLeadingCommentRanges(source, 0) ?? [];
const sourceNotice = notices.map((comment) => source.slice(comment.pos, comment.end)).join("\n");
writeFileSync(
  new URL("../MCP-LICENSE.txt", import.meta.url),
  sourceNotice +
    "\n\nModified for Rust validation: metadata and extension key formats added. Normative schema data is evaluated by the independent Rust schema engine; no upstream SDK implementation is included.\n"
);
