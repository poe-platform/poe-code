import { expect, it } from "vitest";
import { parseDocxArguments } from "./command.js";
import { getDocxDiscovery } from "./discovery.js";

const discover = (...args: string[]) => getDocxDiscovery(parseDocxArguments(args.map(value => new TextEncoder().encode(value))))!;

it("declares note reads, edits, numbering metadata and nullable removed locations", () => {
  for (const action of ["list", "get", "add", "set", "remove"]) {
    const read = action === "list" || action === "get";
    expect(discover("schema", "notes", action).data).toMatchObject({ operations: [{
      id: `notes.${action}`, featureIds: ["F24"], support: read ? "read" : "edit",
      result: { oneOf: [{ properties: { data: { properties: read ? {
        items: { items: { properties: { id: { type: "integer", minimum: 0 }, references: { type: "array" } } } },
        separators: { items: { properties: { id: { type: "integer" } } } },
        numbering: { properties: { document: { properties: { footnote: { properties: {
          format: { type: "string" }, start: { type: "integer" }, restart: { type: "string" }
        } } } }, sections: { type: "array" } } }
      } : { changes: { items: { properties: { after: { oneOf: [{ type: "object" }, { type: "null" }] } } } } } } } }, {}] }
    }] });
  }
});

it("explains note scope, shared removal and storage renumbering without layout claims", () => {
  expect(discover("help", "notes", "list").human).toContain("both footnotes and endnotes");
  expect(discover("help", "notes", "get").human).toContain("defaults to footnotes");
  expect(discover("help", "notes", "set").human).toContain("--shared");
  const remove = discover("help", "notes", "remove").human;
  expect(remove).toContain("--reference");
  expect(remove).toContain("--references all");
  expect(remove).toContain("storage IDs");
  expect(remove).toContain("pagination");
  expect(discover("capabilities").data).toMatchObject({ features: expect.arrayContaining([
    { id: "F24", level: "edit", subsets: expect.arrayContaining([expect.objectContaining({ name: "footnotes-endnotes", level: "edit" })]), detected: null }
  ]) });
});
