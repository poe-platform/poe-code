import { expect, it } from "vitest";
import { Document, StaleHandleError } from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";

it("retains annotation references and formatting when run text is set or cleared", async () => {
  const document = await Document(await textFixture(
    '<w:p><w:commentRangeStart w:id="0"/><w:r><w:rPr><w:b/></w:rPr><w:t>Old</w:t><w:commentReference w:id="0"/></w:r><w:commentRangeEnd w:id="0"/></w:p>',
    { comments: { kind: "comments", xml: `<w:comments xmlns:w="${w}"><w:comment w:id="0" w:author=""><w:p/></w:comment></w:comments>` } }
  ), textContext);
  const run = document.paragraphs[0]!.runs[0]!;
  const marker = run.element.children.find(node => node.localName === "commentReference")!;
  const oldText = run.element.children.find(node => node.localName === "t")!;
  run.text = "New";
  expect(run.text).toBe("New");
  expect(run.bold).toBe(true);
  expect(marker.localName).toBe("commentReference");
  expect(run.element.children.map(node => node.localName)).toEqual(["rPr", "t", "commentReference"]);
  expect(() => oldText.text).toThrow(StaleHandleError);
  expect(run.clear()).toBe(run);
  expect(run.text).toBe("");
  expect(run.bold).toBe(true);
  expect(marker.localName).toBe("commentReference");
});
