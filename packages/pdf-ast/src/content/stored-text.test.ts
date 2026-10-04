import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { cosArray, cosDict, cosName, cosStream, dictSet } from "../ast.js";
import { PdfDocument } from "../document.js";
import { PdfRetainedDocument } from "../retained-document.js";
import { PdfFileSource } from "../source.js";
import { evaluateContentStreamSteps } from "./evaluator.js";
import { evaluateRetainedContentSteps } from "./retained-evaluator.js";
import { parseContentEvents } from "./parser.js";

it.each(["simple", "cid-even", "cid-odd", "cmap", "unicode"])(
  "preserves growing %s text across backed read boundaries",
  async (mode) => {
    const original = PdfDocument.create(),
      page = original.addPage();
    const mapping = new TextEncoder().encode(
      "4 begincodespacerange <20> <7f> <8000> <80ff> <810000> <81ffff> <82000000> <82ffffff> endcodespacerange 4 beginbfchar <41> <0041> <8001> <00660069> <810002> <0042> <82000003> <0043> endbfchar"
    );
    const cmap = original.cos.allocateObject(cosStream(mapping));
    const simple = mode === "simple";
    const font = cosDict({
      Type: cosName("Font"),
      Subtype: cosName(simple ? "Type1" : "Type0"),
      BaseFont: cosName("Helvetica"),
      ...(simple
        ? {}
        : { DescendantFonts: cosArray([cosDict({ Subtype: cosName("CIDFontType2") })]) }),
      ...(mode === "cmap"
        ? { Encoding: cmap, ToUnicode: cmap }
        : mode === "unicode"
          ? { ToUnicode: cmap }
          : {})
    });
    const resources = cosDict({ Font: cosDict({ F: font }) });
    const token =
      mode === "cmap" || mode === "unicode"
        ? "41".repeat(4093) + "800181000282000003".repeat(35) + "82"
        : simple
          ? "41".repeat(9001)
          : "0041".repeat(4200) + (mode === "cid-odd" ? "41" : "");
    const bytes = new TextEncoder().encode(
      `BT /F 10 Tf <${token}> Tj [<4142> -20 (C)] TJ (D) ' 0 0 (E) " ET /Span << /ActualText (replacement) >> BDC BT /F 10 Tf (F) Tj ET EMC`
    );
    dictSet(page.pageDict, "Resources", resources);
    dictSet(page.pageDict, "Contents", original.cos.allocateObject(cosStream(bytes)));
    const params = { pageIndex: 0, width: 612, height: 792, resourcesDict: resources };
    const expected = Array.from(
      evaluateContentStreamSteps({
        ...params,
        nodes: parseContentEvents(bytes),
        cosDoc: original.cos
      })
    );
    const fs = createMemoryFileSystem();
    await fs.mkdir("/scratch");
    await fs.writeFile("/input", original.save());
    const source = await PdfFileSource.open(fs, "/input", { chunkBytes: 256, cacheBytes: 512 });
    const storage = { fs, directory: "/scratch" };
    const document = await PdfRetainedDocument.open(source, storage);
    const retainedPage = (await document.pages().next()).value!;
    const data = new Uint8Array(2 * 1024 * 1024);
    let end = 13,
      peakRead = 0;
    const loan = new Uint8Array(4096);
  const backing = {
      allocate(n: number) {
        const at = end;
        end += n;
        return at;
      },
      async read(at: number, n: number) {
        peakRead = Math.max(peakRead, n);
        loan.fill(0);
      loan.set(data.subarray(at, at + n));
      return loan.subarray(0, n);
      },
      async write(at: number, part: Uint8Array) {
        data.set(part, at);
      }
    };
    const actual = [];
    try {
      for await (const operation of evaluateRetainedContentSteps(
        document,
        retainedPage.streamContents(),
        { ...params, resourcesDict: (await retainedPage.attributes()).resources },
        storage,
        { imageStorage: backing, chunkBytes: 256 }
      ))
        actual.push(operation);
      expect(actual).toEqual(expected);
      expect(peakRead).toBeLessThanOrEqual(4096);
    } finally {
      await document.close();
      await source.close();
      expect(await fs.readdir("/scratch")).toEqual([]);
    }
  }
);
