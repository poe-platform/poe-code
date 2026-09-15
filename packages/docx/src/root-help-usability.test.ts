import { expect, it } from "vitest";
import { parseDocxArguments } from "./command.js";
import { getDocxDiscovery, type DocxHelpData } from "./discovery.js";
import { docxOperationSchemas } from "./operation-schema.js";

it("leads root help with common flag-based workflows and keeps lines readable", () => {
  const help = getDocxDiscovery({ operation: "help", inputs: [], options: {} })!;
  const introduction = help.human.split("Implemented commands")[0]!;
  expect(introduction).toContain("docx text INPUT");
  expect(introduction).toContain("--find Draft --with Final --all -o final.docx");
  expect(introduction).toContain("--name title --value 'Coastal café' --in-place");
  expect(help.human.split("\n").every(line => line.length <= 140)).toBe(true);
  expect((help.data as DocxHelpData).paths.flatMap(path => path.operationIds)).toEqual(Object.keys(docxOperationSchemas));
  for (const line of introduction.split("\n").filter(line => line.trimStart().startsWith("docx "))) {
    expect(line).not.toContain("--ops-json");
  }
  expect(parseDocxArguments(["help", "images", "replace"].map(word => new TextEncoder().encode(word))).operation).toBe("help");
});

it("wraps root command discovery at the maintained help width", () => {
  const help = getDocxDiscovery({ operation: "help", inputs: [], options: {} })!;
  expect(Math.max(...help.human.split("\n").map(line => line.length))).toBeLessThanOrEqual(140);
});
