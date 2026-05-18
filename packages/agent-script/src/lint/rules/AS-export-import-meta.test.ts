import { describe, expect, it } from "vitest";

import { AS_EXPORT_IMPORT_META } from "./AS-export-import-meta.js";

describe("AS_EXPORT_IMPORT_META", () => {
  const codes = (source: string) =>
    AS_EXPORT_IMPORT_META(source).map((diagnostic) => diagnostic.code);

  it("reports import.meta assignment inside a nested arrow exported as the handler", () => {
    const source = "export default () => () => { import.meta.url = 'next'; };";

    expect(codes(source)).toEqual(["AS-IMPORT-META-ASSIGN"]);
  });

  it("does not follow import.meta through a binding alias", () => {
    const source = ["const m = import.meta;", "m.url = 'next';"].join("\n");

    expect(AS_EXPORT_IMPORT_META(source)).toEqual([]);
  });

  it("allows aliased import.meta destructuring because only direct assignment targets are rejected", () => {
    const source = "const { url: metaUrl } = import.meta; metaUrl;";

    expect(AS_EXPORT_IMPORT_META(source)).toEqual([]);
  });
});
