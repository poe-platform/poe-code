import { expect, it } from "vitest";
import { createDocxInspectionCommandEngine } from "./inspection-command.js";
import { getDocxDiscovery } from "./discovery.js";
import { paragraph, run, textContext, textFixture } from "../tests/fixtures/text.js";
it("executes sanitize through the common JSON command envelope", async () => {
  const bytes = await textFixture(paragraph("Plain")); let output = "";
  const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({ args: ["sanitize", "-", "--remove", "comments", "--allow-empty", "--dry-run", "--json"].map(value => new TextEncoder().encode(value)), cwd: "/", filesystem: { async readFile() { throw new Error("undeclared source"); } }, stdin: { async *[Symbol.asyncIterator]() { yield bytes; } }, stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } }, stderr: { async write() {} }, signal: textContext.signal });
  expect(JSON.parse(output).errors).toEqual([]); expect(result.exitCode).toBe(0); expect(JSON.parse(output)).toMatchObject({ operation: "sanitize", ok: true, affected: 0, data: { changed: false, dryRun: true, actions: [{ category: "comments", affected: 0 }] } });
});
it("reports one human effect with the retained gaps", async () => {
  const bytes = await textFixture(`<w:p><w:ins w:id="1" w:author="Reviewer">${run("New")}</w:ins></w:p>`); let output = "";
  const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({ args: ["sanitize", "-", "--remove", "revisions", "--revision-policy", "accept", "--dry-run"].map(value => new TextEncoder().encode(value)), cwd: "/", filesystem: { async readFile() { throw new Error("undeclared source"); } }, stdin: { async *[Symbol.asyncIterator]() { yield bytes; } }, stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } }, stderr: { async write() {} }, signal: textContext.signal });
  expect(result.exitCode).toBe(0); expect(output).toContain("1 record affected\n"); expect(output).toContain("Retained categories: properties, comments, links, objects");
});
it("discovers the bounded sanitize edit schema", () => {
  const discovery = getDocxDiscovery({ operation: "schema", inputs: [], options: {} })!;
  expect("operations" in discovery.data && discovery.data.operations.find(item => item.id === "sanitize")).toMatchObject({ support: "edit", featureIds: ["F46"] });
});
