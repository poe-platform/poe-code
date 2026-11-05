import assert from "node:assert/strict";
import { it } from "node:test";
import { PdfDocument, dictGet, dictSet } from "@poe-code/pdf-ast";
import { runQpdfCli } from "./index.js";

for (const mode of ["blank", "shared", "selection", "object-streams"]) it(`writes actual xref and page offsets for a three-page linearized PDF (${mode})`, async () => {
  const doc = PdfDocument.create();
  for (const width of [200, 300, 400]) {
    const page = doc.addPage({ width, height: 500 });
    if (mode !== "blank") page.drawText(`Page ${width}`, { x: 20, y: 20 });
  }
  if (mode === "shared") dictSet(doc.getPage(2).dict, "Resources", dictGet(doc.getPage(1).dict, "Resources")!);
  const files = new Map([["in.pdf", doc.save()]]);
  const args = ["--linearize", "in.pdf", "out.pdf"];
  if (mode === "object-streams") args.push("--object-streams=generate");
  if (mode === "selection") args.push("--pages", ".", "3,1,2", "--");
  assert.equal((await runQpdfCli(args, files)).exitCode, 0);
  const bytes = files.get("out.pdf")!, output = PdfDocument.load(bytes), parsed = output.cos;
  assert.deepEqual(output.getPages().map(page => page.width), mode === "selection" ? [400, 200, 300] : [200, 300, 400]);
  if (mode !== "blank") for (const width of [200, 300, 400]) assert.ok(output.extractText().includes(`Page ${width}`));
  const linear = [...parsed.objects.values()].find(object => object.value.kind === "dict" && dictGet(object.value, "Linearized"))!;
  assert.equal(linear.value.kind, "dict");
  if (linear.value.kind !== "dict") return;
  const dictionary = linear.value;
  const number = (key: string) => { const value = dictGet(dictionary, key); assert.equal(value?.kind, "number"); return value?.kind === "number" ? value.value : 0; };
  assert.equal(number("L"), bytes.length);
  assert.equal(number("N"), 3);
  const text = Buffer.from(bytes).toString("latin1");
  if (mode === "object-streams") {
    assert.ok(text.slice(number("T")).includes("/Type /XRef"));
    assert.ok([...parsed.objects.values()].some(object => {
      const type = object.value.kind === "stream" ? dictGet(object.value.dict, "Type") : undefined;
      return type?.kind === "name" && type.decoded === "ObjStm";
    }));
  } else assert.equal(text.slice(number("T"), number("T") + 21).trim(), "0000000000 65535 f");
  const report = await runQpdfCli(["--show-linearization", "out.pdf"], files);
  assert.equal(report.exitCode, 0);
  assert.ok(!report.stdout.includes("\n  nobjects: 0"), report.stdout);
  assert.match(report.stdout, /first_page_offset: [1-9][0-9]+/);
});
