import { Volume } from "memfs";
import { expect, it } from "vitest";
import * as source from "./index.js";
import { relationshipXmlIds as sourceIds } from "./relationship-xml.js";
import { compiledPublicRuntime } from "../tests/compiled-public-runtime.js";

const compiled = await compiledPublicRuntime;
const helperUrl = new URL("../dist/relationship-xml.js", import.meta.url).href;
const helperModule = await import("data:text/javascript;base64," + Buffer.from("export { relationshipXmlIds } from " + JSON.stringify(helperUrl) + ";").toString("base64")) as { relationshipXmlIds: typeof sourceIds };
expect(helperModule.relationshipXmlIds).not.toBe(sourceIds);
for (const runtime of ["source", "compiled"] as const) for (const count of [0, 4096]) for (const retainedBytes of [0, 7])
it(`physical relationship identity census admits traversal pointer memory before allocation; runtime=${runtime}; count=${count}; retainedBytes=${retainedBytes}`, () => {
  const api = runtime === "source" ? source : compiled, ids = runtime === "source" ? sourceIds : helperModule.relationshipXmlIds;
  const payload = '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships" xmlns:f="urn:original:physical-id-retention"><f:opaque>' + '<f:leaf/>'.repeat(count) + '</f:opaque></Relationships>';
  const memory = Volume.fromJSON({ "/original.xml": payload }), original = new Uint8Array(memory.readFileSync("/original.xml") as Buffer);
  const root = api.parseDocumentXml(original).root, budget = new api.DocumentBudget({ retainedBytes: Math.max(1, retainedBytes) });
  if (retainedBytes === 0) budget.charge("retainedBytes", 1);
  expect(() => ids(root, budget)).toThrow(api.ResourceLimitError);
  expect(new Uint8Array(memory.readFileSync("/original.xml") as Buffer)).toEqual(original);
  expect(root.children[0]!.children).toHaveLength(count);
});
