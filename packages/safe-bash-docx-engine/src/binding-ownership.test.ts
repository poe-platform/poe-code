import { expect, it } from "vitest";
import { readArchive } from "./archive.js";
import { DocumentPackage } from "./package.js";
import { DocumentBudget } from "./budget.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
it("censuses native binding owners without treating inert user data as declarations", async () => {
  const { readDocumentBindingOwnership } = await import("./binding-ownership.js");
  const archive = await readArchive(await textFixture('<w:p><w:sdt><w:sdtPr><w:text/><w:dataBinding w:storeItemID="1111" w:xpath="/value"/></w:sdtPr><w:sdtContent><w:r><w:t>Old</w:t></w:r></w:sdtContent></w:sdt></w:p>'), textContext);
  const budget = new DocumentBudget({}, textContext.signal), graph = new DocumentPackage(archive, textContext.limits, budget);
  expect(readDocumentBindingOwnership(graph, budget).declarations).toMatchObject([{ part: "/word/document.xml", storeItemId: "1111", xpath: "/value", supportedStory: true }]);
});
