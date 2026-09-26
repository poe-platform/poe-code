import {PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, decodePDFRawStream} from "pdf-lib";

/** Read the text operators and embedded widths actually emitted by our fixtures. */
export async function pdfText(bytes: Uint8Array) {
  const pdf = await PDFDocument.load(bytes);
  const runs: {page: number; text: string; size: number; color: number[]; glyphs: {text: string; x: number; y: number}[]}[] = [];
  const decode = (stream: unknown) => {
    if (!(stream instanceof PDFRawStream)) throw new Error("Missing fixture content stream");
    return new TextDecoder().decode(decodePDFRawStream(stream).decode());
  };
  for (const [pageIndex, page] of pdf.getPages().entries()) {
    const resources = page.node.Resources()!.lookup(PDFName.of("Font"), PDFDict);
    const fonts = new Map<string, {text: Map<number, string>; widths: Map<number, number>}>();
    for (const [key, ref] of resources.entries()) {
      const font = pdf.context.lookup(ref, PDFDict), text = new Map<number, string>(), widths = new Map<number, number>();
      const cmap = decode(font.lookup(PDFName.of("ToUnicode")));
      for (const block of cmap.matchAll(/beginbfchar\s+([\s\S]*?)endbfchar/g)) {
        for (const pair of block[1]!.matchAll(/<([0-9a-f]+)>\s+<([0-9a-f]+)>/gi)) {
          const units = pair[2]!.match(/.{4}/g)!;
          text.set(Number.parseInt(pair[1]!, 16), String.fromCharCode(...units.map(unit => Number.parseInt(unit, 16))));
        }
      }
      const cidFont = font.lookup(PDFName.of("DescendantFonts"), PDFArray).lookup(0, PDFDict);
      const table = cidFont.lookup(PDFName.of("W"), PDFArray);
      for (let at = 0; at < table.size();) {
        const first = table.lookup(at++, PDFNumber).asNumber(), next = table.lookup(at++);
        if (next instanceof PDFArray) {
          for (let i = 0; i < next.size(); i++) widths.set(first + i, next.lookup(i, PDFNumber).asNumber());
        } else {
          if (!(next instanceof PDFNumber)) throw new Error("Invalid fixture font widths");
          const width = table.lookup(at++, PDFNumber).asNumber();
          for (let code = first; code <= next.asNumber(); code++) widths.set(code, width);
        }
      }
      fonts.set(key.toString(), {text, widths});
    }
    let color = [0, 0, 0], x = 0, y = 0, size = 0, fontKey = "";
    let run: (typeof runs)[number] | undefined;
    const content = (page.node.Contents() as PDFArray).asArray().map(ref => decode(pdf.context.lookup(ref))).join("\n");
    for (const line of content.split("\n")) {
      const parts = line.trim().split(/\s+/), operator = parts.pop();
      if (operator === "rg") color = parts.map(Number);
      else if (operator === "BT") run = {page: pageIndex + 1, text: "", size: 0, color: [], glyphs: []};
      else if (operator === "Tf") {fontKey = parts[0]!;size = Number(parts[1]);}
      else if (operator === "Tm") {
        if (parts.slice(0, 4).join(" ") !== "1 0 0 1") throw new Error("Unqualified fixture text matrix");
        x = Number(parts[4]);y = Number(parts[5]);
      } else if (operator === "Tj") {
        const codes = parts[0]!.slice(1, -1).match(/.{4}/g) ?? [], font = fonts.get(fontKey)!;
        if (!run || !font) throw new Error("Missing fixture text state");
        run.size = size;run.color = [...color];
        for (const encoded of codes) {
          const code = Number.parseInt(encoded, 16), text = font.text.get(code), width = font.widths.get(code);
          if (text === undefined || width === undefined) throw new Error("Unmapped emitted fixture glyph");
          run.text += text;run.glyphs.push({text, x, y});x += width * size / 1000;
        }
      } else if (operator === "TJ" || operator === "Td" || operator === "TD") throw new Error("Unqualified fixture text positioning operator");
      else if (operator === "ET" && run) {if (run.glyphs.length) runs.push(run);run = undefined;}
    }
  }
  return {pdf, runs};
}
