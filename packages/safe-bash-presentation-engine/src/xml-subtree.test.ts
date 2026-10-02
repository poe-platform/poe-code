import { expect, it } from "vitest";
import { parseXmlPart } from "./xml.js";
it("extracts an owned standalone subtree retaining admission limits for live edits", () => {
  const xml = parseXmlPart(new TextEncoder().encode('<a:root xmlns:a="urn:tree"><a:p/></a:root>'), {
    maxBytes: 150,
    maxNodes: 5,
    maxDepth: 4
  });
  const subtree = xml.subtree(xml.root.children[0]!);
  expect(subtree.root.name).toEqual({ namespace: "urn:tree", localName: "p" });
  expect(
    subtree.setText(subtree.root, "More than the original empty node").bytes().length
  ).toBeGreaterThan(40);
  expect(() => subtree.setText(subtree.root, "x".repeat(150))).toThrow(
    expect.objectContaining({ code: "resource-limit" })
  );
  expect(() => xml.subtree(subtree.root)).toThrow(
    expect.objectContaining({ code: "invalid-value" })
  );
});
