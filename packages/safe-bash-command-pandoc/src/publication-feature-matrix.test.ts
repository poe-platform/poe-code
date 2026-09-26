import {expect, it} from "vitest";
import {writeDocument} from "./engine.js";
import type {Document} from "./types.js";

it.each(["latex", "rst", "rtf", "pptx", "json"])("uses a feature rejection rather than a capability gate for %s", async to => {
  const document: Document = {blocks: [{t: "Div", c: [["chapter", ["epub-chapter"], []],
    [{t: "Para", c: [{t: "Str", c: "Matrix"}]}]]}], metadata: {}, resources: [],
    ...(to === "json" ? {language: "en"} : {})};
  await expect(writeDocument(document, {to}, {yield: async () => {}}))
    .rejects.toMatchObject({code: "E_UNSUPPORTED_FEATURE", format: to});
});
