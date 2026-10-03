import { expect, it } from "vitest";
import { defaultSsconvertLimits } from "../engine.js";
import { createOdfXml } from "./odf-write-support.js";

function context(signal = new AbortController().signal, outputBytes = defaultSsconvertLimits.outputBytes) {
  return { signal, limits: { ...defaultSsconvertLimits, outputBytes }, environment: { env: {}, locale: "C", timezone: "UTC" }, own() {} };
}
async function collect(source: AsyncIterable<Uint8Array>) {
  const chunks = []; for await (const chunk of source) chunks.push(chunk.slice()); return Buffer.concat(chunks).toString();
}
it.each([[], ["", ""], ["a<&", "é\ud83e", "\udd80", ""]].map(fragments => ({ fragments })))("streams identical ODF container spelling for $fragments", async ({ fragments }) => {
  const xml = createOdfXml(context(), false);
  async function* parts() { yield* fragments; }
  expect(await collect(xml.stream("table:table-row", { "table:number-rows-repeated": 3 }, parts())))
    .toBe(xml.element("table:table-row", { "table:number-rows-repeated": 3 }, fragments.join("")));
  expect(await collect(xml.documentStream("office:document-content", parts())))
    .toBe(xml.document("office:document-content", fragments.join("")));
});
it("enforces the complete streaming container byte budget", async () => {
  const xml = createOdfXml(context(undefined, 30), false);
  async function* parts() { yield "é".repeat(20); }
  await expect(collect(xml.stream("text:p", {}, parts()))).rejects.toThrow("output bytes limit");
});
it.each(["failure", "cancel"])("closes ODF XML input on %s", async mode => {
  const controller = new AbortController(), reason = new Error(mode); let closed = 0;
  async function* parts() {
    try { yield "a".repeat(17000); if (mode === "cancel") controller.abort(reason); else throw reason; yield "b"; }
    finally { closed++; }
  }
  await expect(collect(createOdfXml(context(controller.signal), false).stream("text:p", {}, parts()))).rejects.toBe(reason);
  expect(closed).toBe(1);
});
