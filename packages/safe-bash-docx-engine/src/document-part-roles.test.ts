import { expect, it } from "vitest";
import { parseDocumentXml } from "./package-xml.js";
const word = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
it("requires declared part roles and matching roots before admitting Word declarations", async () => {
  const { documentPartRole } = await import("./document-part-roles.js");
  const root = (xml: string) => parseDocumentXml(new TextEncoder().encode(xml)).root;
  expect(documentPartRole("application/xml", root(`<w:document xmlns:w="${word}"/>`))).toBe(null);
  expect(documentPartRole("application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml", root(`<w:document xmlns:w="${word}"/>`))).toBe("story");
  expect(documentPartRole("application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml", root(`<w:settings xmlns:w="${word}"/>`))).toBe("settings");
  expect(documentPartRole("application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml", root('<data/>'))).toBe(null);
});
