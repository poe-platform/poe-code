import { Volume } from "memfs";
import { expect, it } from "vitest";
import * as api from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";
import { nativeRepeatTemplate } from "../tests/native-repeat-template.js";

const executeNative = nativeRepeatTemplate<{
  readonly input: string;
  readonly limits: typeof textContext.limits;
  readonly route: string;
  readonly observedView: string;
  readonly retained: string;
}>(new URL("../../safe-bash-command-docx/tests/tests/fixtures/tracked-text-native.mjs", import.meta.url));

for (const strict of [false, true]) for (const route of ["sdk", "sdk-batch", "cli", "cli-batch"]) for (const scenario of ["properties", "hyperlink"]) for (const observedView of ["original", "final", "baseline"])
it(`tracked replacement respects admitted depth7800 retained boundaries; strict=${strict}; route=${route}; scenario=${scenario}${observedView === "original" ? "" : "; observedView=" + observedView}`, async () => {
  const foreign = "<f:unknown>".repeat(7800) + "<f:value/>" + "</f:unknown>".repeat(7800);
  const native = "<w:customXml>".repeat(7800) + "<w:r><w:t>Boundary</w:t></w:r>" + "</w:customXml>".repeat(7800);
  const word = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const content = '<w:p xmlns:f="urn:original:tracked-boundary" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f">' + (scenario === "properties" ? '<w:pPr>' + foreign + '</w:pPr>' : '') + '<w:r><w:t>Coast</w:t>' + (scenario === "run-opaque" ? foreign : '') + '</w:r>' + (scenario === "hyperlink" ? '<w:hyperlink>' + native + '</w:hyperlink>' : '') + '</w:p>';
  const memory = Volume.fromJSON({ "/input": "" }), limits = { ...textContext.limits, maxArchiveBytes: 524288, maxEntryBytes: 262144, maxTotalBytes: 524288 };
  const parts = readPackage(await textFixture('<w:p><w:r><w:t>Coast</w:t></w:r></w:p>', {}, strict));
  parts.set("word/document.xml", new TextEncoder().encode('<w:document xmlns:w="' + word + '"><w:body>' + content + '</w:body></w:document>'));
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("1980-01-01T00:00:00Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, { ...textContext, limits });
  const fixture = { input: new Uint8Array(memory.readFileSync("/input") as Buffer) };
  const original = scenario === "hyperlink" ? "CoastBoundary" : "Coast";
  const response = await executeNative({ input: Buffer.from(fixture.input).toString("base64"), limits, route, observedView, retained: scenario === "properties" ? "<w:pPr>" + foreign + "</w:pPr>" : "<w:hyperlink>" + native + "</w:hyperlink>" });
  if (observedView === "baseline") expect(response, response.stack ?? response.error).toMatchObject({ ok: true, beforeText: original, outputBytes: 0 });
  else expect(response, response.stack ?? response.error).toMatchObject({ ok: true, view: observedView, text: observedView === "original" ? original : original.replace("Coast", "Shore"), exactMemberOrderNondirtyPartsAndRetainedSource: true });
  expect(Buffer.compare(Buffer.from(memory.readFileSync("/input") as Buffer), Buffer.from(fixture.input))).toBe(0);
});
