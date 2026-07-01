import { describe, expect, it } from "vitest";
import type { MdNode } from "./ast.js";
import { renderMarkdownPlaintext, renderPlaintext } from "./plaintext-renderer.js";

describe("terminal markdown plaintext renderer", () => {
  it("renders table body cells as header-labelled sentences", () => {
    const markdown = [
      "| Name | Age | Status |",
      "| ---- | --- | ------ |",
      "| Alice | 30 | ready |",
      "| Bob |  | busy |"
    ].join("\n");

    expect(renderMarkdownPlaintext(markdown)).toBe(
      "Name is Alice. Age is 30. Status is ready. Name is Bob. Status is busy."
    );
  });

  it("omits standalone table rows and cells", () => {
    const tableCellNode: MdNode = {
      type: "tableCell",
      children: [{ type: "text", value: "orphan" }]
    };
    const tableRowNode: MdNode = { type: "tableRow", children: [tableCellNode] };

    expect(renderPlaintext(tableRowNode)).toBe("");
    expect(renderPlaintext(tableCellNode)).toBe("");
  });
});
