import { expect, it } from "vitest";
import { CFFParser, Stream } from "../vendor/pdfjs-fonts.mjs";
import { STANDARD_FONT_CFF_BASE64 } from "./standard-font-data.js";
import { readStoredCffMetadata } from "./stored-cff-metadata.js";
import { FontProgramStore } from "./stored-program.js";

it("reads bundled CFF programs through caller-backed indexes and charsets", async () => {
  for (const encoded of Object.values(STANDARD_FONT_CFF_BASE64)) {
    const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
    const native = new CFFParser(new Stream(bytes.slice()), {}, false).parse();
    const pages: Uint8Array[] = [bytes];
    let end = bytes.length;
    const storage = {
      allocate(n: number) {
        const at = end;
        end += n;
        const page = new Uint8Array(n);
        pages[at] = page;
        return at;
      },
      async read(at: number, n: number) {
        expect(n).toBeLessThanOrEqual(4096);
        if (at < bytes.length) return bytes.slice(at, at + n);
        return pages[at]!.slice(0, n);
      },
      async write(at: number, data: Uint8Array) {
        pages[at]!.set(data);
      }
    };
    const input = new FontProgramStore({ storage, position: 0, byteLength: bytes.length });
    const cff = await readStoredCffMetadata(input.range(), storage);
    expect(cff.glyphs.count).toBe(native.charStrings.objects.length);
    expect(cff.matrix).toEqual(native.topDict.getByName("FontMatrix"));
    const names: Array<string | number> = [];
    for await (const value of cff.charset()) {
      const name = await cff.name(value);
      if (typeof name === "string") names.push(name);
      else {
        if (!name) throw Error("missing source name");
        let text = "";
        for (let i = 0; i < name.length; i++) text += String.fromCharCode((await name.byte(i))!);
        names.push(text);
      }
    }
    expect(names).toEqual(native.charset.charset);
    expect(cff.subrs?.count ?? 0).toBe(native.topDict.privateDict?.subrsIndex?.objects.length ?? 0);
  }
});
