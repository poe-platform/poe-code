import { defineGroup } from "agent-kit";
import { readTool, readSectionTool } from "./tools.js";

export const markdownGroup = defineGroup({
  name: "markdown-reader",
  description: "Read markdown files section-by-section.",
  scope: ["mcp"],
  children: [readTool, readSectionTool]
});
