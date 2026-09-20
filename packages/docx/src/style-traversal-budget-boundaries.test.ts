import { Volume } from "memfs";
import { expect, it } from "vitest";
import { CancellationError, ResourceLimitError } from "./archive.js";
import { DocumentBudget } from "./budget.js";
import { parseDocumentXml } from "./package-xml.js";
import type { PackagePart } from "./package.js";
import { styleAllocationIds } from "./style-allocation.js";
import { styleIds } from "./style-properties.js";

for (const strict of [false, true]) for (const kind of ["settings", "styles"] as const)
for (const boundary of ["work", "cancelled"] as const)
it(`retains typed traversal budget/cancellation refusal and source bytes; ${kind}; ${boundary}; strict=${strict}`, () => {
  const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const native = kind === "settings" ? '<w:defaultTableStyle w:val="Style1"/>' : '<w:style w:type="paragraph" w:styleId="Style1"><w:name w:val="First"/></w:style>';
  const memory = Volume.fromJSON({ "/source": `<w:${kind} xmlns:w="${w}" xmlns:f="urn:original:traversal-budget" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f">${'<f:inert/>'.repeat(16)}${native}</w:${kind}>` });
  const bytes = new Uint8Array(memory.readFileSync("/source") as Buffer), root = parseDocumentXml(bytes).root, controller = new AbortController();
  if (boundary === "cancelled") controller.abort();
  const budget = new DocumentBudget(boundary === "work" ? { work: 3 } : {}, controller.signal), expected = boundary === "work" ? ResourceLimitError : CancellationError;
  const part = { bytes, content_type: `application/vnd.openxmlformats-officedocument.wordprocessingml.${kind}+xml` } as PackagePart;
  expect(() => styleAllocationIds([part], budget, new Map([[bytes, root]]))).toThrow(expected);
  expect(Buffer.from(memory.readFileSync("/source") as Buffer).equals(bytes)).toBe(true);
  if (kind === "styles") expect(() => styleIds(root, new DocumentBudget(boundary === "work" ? { work: 3 } : {}, controller.signal))).toThrow(expected);
});
