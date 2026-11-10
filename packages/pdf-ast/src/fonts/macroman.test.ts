import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PagedStorage } from "@poe-code/safe-fs/storage";
import { cosArray, cosDict, cosName, cosNumber, cosStream, dictGet, dictSet } from "../ast.js";
import { evaluateRetainedContentSteps } from "../content/retained-evaluator.js";
import { PdfDocument } from "../document.js";
import { PdfRetainedDocument } from "../retained-document.js";
import { PdfFileSource } from "../source.js";

it.each([
  ["name", "team’s “text”"],
  ["dictionary", "team’s “text”"],
  ["differences", "team's “text”"],
  ["unicode", "team!s “text”"],
  ["notdef", "teams “text”"],
])("decodes MacRoman text with %s encoding overrides", async (mode, expected) => {
  let bytes: Uint8Array = readFileSync(new URL("../fixtures/macroman.pdf", import.meta.url));
  if (mode !== "name") {
    const original = PdfDocument.load(bytes);
    const resources = original.cos.resolveDict(dictGet(original.getPage(0).pageDict, "Resources"))!;
    const fonts = original.cos.resolveDict(dictGet(resources, "Font"))!;
    const font = original.cos.resolveDict(dictGet(fonts, "F1"))!;
    dictSet(font, "Encoding", cosDict({
      BaseEncoding: cosName("MacRomanEncoding"),
      ...(mode === "dictionary" ? {} : {
        Differences: cosArray([cosNumber(0xd5), cosName(mode === "notdef" ? ".notdef" : "quotesingle")]),
      }),
    }));
    if (mode === "unicode") {
      dictSet(font, "ToUnicode", original.cos.allocateObject(cosStream(new TextEncoder().encode(
        "1 begincodespacerange <00> <ff> endcodespacerange 1 beginbfchar <d5> <0021> endbfchar"
      ))));
    }
    bytes = original.save();
  }
  const document = PdfDocument.load(bytes);
  const glyphs = document.getPage(0).evaluateDisplayList().glyphs;
  expect(glyphs.map(glyph => glyph.unicode).join("")).toBe(expected);
  if (mode === "name") expect(glyphs[4]!.unicode.codePointAt(0)).toBe(0x2019);
  // An empty glyph still advances the cursor, so logical extraction retains its gap.
  expect(document.extractText()).toBe(mode === "notdef" ? "team s “text”" : expected);

  const fs = createMemoryFileSystem();
  await fs.mkdir("/scratch");
  await fs.writeFile("/input.pdf", bytes);
  const source = await PdfFileSource.open(fs, "/input.pdf");
  const storage = { fs, directory: "/scratch" };
  const backing = new PagedStorage({ fs, cwd: "/scratch", env: {}, signal: new AbortController().signal });
  const retained = await PdfRetainedDocument.open(source, storage);
  try {
    const page = (await retained.pages().next()).value!;
    const unicode: string[] = [];
    for await (const event of evaluateRetainedContentSteps(retained, page.streamContents(), {
      pageIndex: 0, width: 612, height: 792, resourcesDict: (await page.attributes()).resources,
    }, storage, { imageStorage: backing })) {
      if (event.operation.kind === "glyph") unicode.push(event.operation.value.unicode);
    }
    expect(unicode.join("")).toBe(expected);
  } finally {
    await retained.close();
    await backing.close();
    await source.close();
    expect(await fs.readdir("/scratch")).toEqual([]);
  }
});
