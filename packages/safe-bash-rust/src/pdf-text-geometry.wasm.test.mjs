import assert from "node:assert/strict";
import { test } from "node:test";
import { Shell, agentCommands, createMemoryFileSystem } from "@poe-platform/safe-bash";
import {
  PdfDocument,
  cosArray,
  cosNumber,
  cosDict,
  cosName,
  cosStream,
  dictGet,
  dictSet
} from "@poe-code/pdf-ast";
import { SaxesParser } from "saxes";
import { RustWasmBash } from "./index.js";

function input(rotation = 0, shifted = false) {
  const doc = PdfDocument.create();
  doc.addPage([80, 40]).drawText("Unselected", { x: 5, y: 20, size: 8 });
  const page = doc.addPage([200, 200]);
  page.setRotation(rotation);
  const x = shifted ? 30 : 0,
    y = shifted ? 40 : 0;
  if (shifted)
    dictSet(page.pageDict, "MediaBox", cosArray([x, y, x + 200, y + 200].map((n) => cosNumber(n))));
  dictSet(page.pageDict, "CropBox", cosArray([x, y, x + 200, y + 120].map((n) => cosNumber(n))));
  page.drawText("BodyInsideCropBox", { x: x + 20, y: y + 60, size: 12 });
  page.drawText("BleedOutsideCropBox", { x: x + 20, y: y + 170, size: 12 });
  return doc.save();
}
async function run(runtime, pdf, flags) {
  const memory = runtime === "TypeScript" ? createMemoryFileSystem() : undefined;
  const shell = memory
    ? new Shell({ fs: memory }).use(agentCommands())
    : new RustWasmBash({ cwd: "/", forceNative: true });
  const fs = memory ?? shell.fs;
  try {
    await fs.writeFile("/in.pdf", pdf);
    const result = await shell.exec(`pdftotext -f 2 -l 2 ${flags} /in.pdf -`);
    if (runtime === "Rust") assert.equal(shell._companion, null);
    return result;
  } finally {
    await shell.dispose();
  }
}
function boxes(xml) {
  const rows = [],
    parser = new SaxesParser();
  let text = "";
  parser.on("opentag", (node) => {
    if (["page", "block", "line", "word"].includes(node.name))
      rows.push({ tag: node.name, ...node.attributes });
    if (node.name === "word") text = "";
  });
  parser.on("text", (value) => {
    text += value;
  });
  parser.on("closetag", (node) => {
    if (node.name === "word") rows.at(-1).text = text;
  });
  parser.write(xml).close();
  return rows;
}
for (const runtime of ["TypeScript", "Rust"]) {
  test(
    `${runtime} text geometry uses actual font metrics and crops words`,
    { skip: !WebAssembly.Suspending },
    async () => {
      const pdf = input();
      for (const flags of ["-bbox -cropbox", "-bbox-layout -cropbox", "-bbox -cropbox -r 144"]) {
        const result = await run(runtime, pdf, flags);
        assert.equal(result.exitCode, 0, result.stderr);
        const rows = boxes(result.stdout);
        assert.deepEqual(rows[0], { tag: "page", width: "200.000000", height: "120.000000" });
        const words = rows.filter((row) => row.tag === "word");
        assert.equal(words.length, 1);
        assert.equal(words[0].text, "BodyInsideCropBox");
        const scale = flags.includes("144") ? 2 : 1;
        for (const [key, value] of Object.entries({
          xMin: 20,
          yMin: 51.384,
          xMax: 126.044,
          yMax: 62.484
        }))
          assert.ok(
            Math.abs(Number(words[0][key]) - value * scale) < 1e-5,
            `${key}: ${words[0][key]}`
          );
        for (const row of rows.filter((row) => ["line", "block"].includes(row.tag)))
          for (const key of ["xMin", "yMin", "xMax", "yMax"]) assert.equal(row[key], words[0][key]);
      }
      const tsv = await run(runtime, pdf, "-tsv -cropbox");
      assert.equal(tsv.exitCode, 0, tsv.stderr);
      assert.match(
        tsv.stdout,
        /5\t2\t0\t0\t0\t0\t20.00\t51.38\t106.04\t11.10\t100\tBodyInsideCropBox\n/
      );
      assert.ok(!tsv.stdout.includes("Bleed"));
      const crop = await run(runtime, pdf, "-x 0 -y 100 -W 200 -H 100");
      assert.equal(crop.exitCode, 0, crop.stderr);
      assert.equal(crop.stdout, "BodyInsideCropBox\n\n\f");
      const ordinary = await run(runtime, pdf, "-cropbox");
      assert.match(ordinary.stdout, /BleedOutsideCropBox/);
    }
  );
  test(
    `${runtime} text geometry preserves page rotation and shifted CropBox`,
    { skip: !WebAssembly.Suspending },
    async () => {
      for (const rotation of [0, 90, 180, 270])
        for (const flags of [
          "-bbox -cropbox",
          "-bbox-layout -cropbox",
          "-tsv -cropbox",
          "-raw -bbox -cropbox",
          "-raw -tsv -cropbox"
        ]) {
          const pdf = input(rotation, true),
            actual = await run(runtime, pdf, flags);
          assert.equal(actual.exitCode, 0, actual.stderr);
          if (flags.includes("bbox")) {
            const rows = boxes(actual.stdout),
              words = rows.filter((row) => row.tag === "word");
            assert.equal(words.length, 1);
            assert.equal(words[0].text, "BodyInsideCropBox");
            assert.equal(words[0].xMin, "20.000000");
            assert.equal(words[0].yMin, "51.384000");
            if (runtime === "Rust")
              assert.deepEqual(rows, boxes((await run("TypeScript", pdf, flags)).stdout));
          } else {
            if (flags.includes("raw")) assert.ok(!actual.stdout.includes("###FLOW###"));
            if (runtime === "Rust")
              assert.equal(actual.stdout, (await run("TypeScript", pdf, flags)).stdout);
          }
        }
    }
  );
}

function wordsPdf(kind) {
  const doc = PdfDocument.create();
  doc.addPage([80, 40]);
  const page = doc.addPage([200, 200]);
  const font = doc.cos.allocateObject(
    cosDict({
      Type: cosName("Font"),
      Subtype: cosName("Type1"),
      BaseFont: cosName(kind === "courier" ? "Courier" : "Helvetica"),
      ...(kind === "descriptor"
        ? { FontDescriptor: cosDict({ Ascent: cosNumber(850), Descent: cosNumber(-150) }) }
        : {})
    })
  );
  dictSet(page.pageDict, "Resources", cosDict({ Font: cosDict({ F1: font }) }));
  if (kind === "columns")
    page.setRawContentStream(
      "BT /F1 10 Tf 1 0 0 1 150 150 Tm (R1) Tj 1 0 0 1 20 150 Tm (L1) Tj 1 0 0 1 150 135 Tm (R2) Tj 1 0 0 1 20 135 Tm (L2) Tj ET"
    );
  else if (kind === "spacing")
    page.setRawContentStream("BT /F1 12 Tf 1 0 0 1 20 130 Tm 4 Tc (ABC) Tj ET");
  else if (kind === "inherited") {
    dictSet(
      doc.cos.resolveDict(dictGet(page.pageDict, "Parent")),
      "CropBox",
      cosArray([10, 30, 170, 160].map((n) => cosNumber(n)))
    );
    page.setRawContentStream("BT /F1 12 Tf 20 130 Td (Alpha Beta) Tj 0 -16 Td (Gamma Delta) Tj ET");
  } else if (kind === "diagonal")
    page.setRawContentStream(
      "BT /F1 12 Tf 1 0 0 1 20 130 Tm (Axis) Tj 0.8 0.6 -0.6 0.8 20 60 Tm (Diagonal) Tj ET"
    );
  else
    page.setRawContentStream("BT /F1 12 Tf 20 130 Td (Alpha Beta) Tj 0 -16 Td (Gamma Delta) Tj ET");
  return doc.save();
}
for (const runtime of ["TypeScript", "Rust"])
  for (const kind of [
    "words",
    "courier",
    "descriptor",
    "columns",
    "spacing",
    "inherited",
    "diagonal"
  ])
    test(
      `${runtime} text geometry retains ${kind} word and enclosing bounds`,
      { skip: !WebAssembly.Suspending },
      async () => {
        const pdf = wordsPdf(kind);
        for (const flags of [
          "-bbox-layout",
          "-tsv",
          "-bbox -cropbox",
          "-bbox-layout -x 0 -W 55",
          "-tsv -r 144 -x 0 -W 110",
          "-bbox -nodiag",
          "-raw -bbox"
        ]) {
          const actual = await run(runtime, pdf, flags);
          assert.equal(actual.exitCode, 0, actual.stderr);
          if (runtime === "Rust") {
            const expected = await run("TypeScript", pdf, flags);
            assert.equal(actual.stderr, expected.stderr);
            if (flags.includes("bbox"))
              assert.deepEqual(boxes(actual.stdout), boxes(expected.stdout), `${kind}: ${flags}`);
            else assert.equal(actual.stdout, expected.stdout, `${kind}: ${flags}`);
          } else if (kind === "descriptor" && !flags.includes("-r")) {
            const word = flags.includes("bbox")
              ? boxes(actual.stdout).find((row) => row.tag === "word")
              : null;
            if (word) {
              assert.equal(word.yMin, "59.800000");
              assert.equal(word.yMax, "71.800000");
            }
          }
          if (kind === "words" && flags.includes("-W")) {
            assert.ok(!actual.stdout.includes("Beta"));
            assert.ok(!actual.stdout.includes("Delta"));
          }
        }
      }
    );

for (const runtime of ["TypeScript", "Rust"])
  test(
    `${runtime} text geometry validates input, limits and output publication`,
    { skip: !WebAssembly.Suspending },
    async () => {
      const memory = runtime === "TypeScript" ? createMemoryFileSystem() : undefined;
      const shell = memory
        ? new Shell({ fs: memory }).use(agentCommands())
        : new RustWasmBash({ cwd: "/", forceNative: true });
      const fs = memory ?? shell.fs;
      try {
        await fs.writeFile("/in.pdf", input());
        await fs.writeFile("/out.html", new TextEncoder().encode("keep"));
        for (const flags of ["-r NaN", "-r Infinity", "-x NaN", "-W Infinity", "-f 3"]) {
          const result = await shell.exec(`pdftotext -bbox ${flags} /in.pdf /out.html`);
          assert.notEqual(result.exitCode, 0);
          assert.notEqual(result.stderr, "");
          assert.equal(new TextDecoder().decode(await fs.readFile("/out.html")), "keep");
        }
        const write = await shell.exec("pdftotext -bbox /in.pdf /missing/out.html");
        assert.notEqual(write.exitCode, 0);
        assert.notEqual(write.stderr, "");
        try {
          const limit = await shell.exec("pdftotext -bbox /in.pdf /out.html", {
            limits: { maxOutputBytes: 64 }
          });
          assert.notEqual(limit.exitCode, 0);
        } catch (error) {
          assert.equal(error.name, "ShellLimitError");
        }
        assert.equal(new TextDecoder().decode(await fs.readFile("/out.html")), "keep");
        const full = await shell.exec("pdftotext -bbox /in.pdf -");
        assert.equal(full.exitCode, 0, full.stderr);
        try {
          const wrappedLimit = await shell.exec("pdftotext -bbox /in.pdf /out.html", {
            limits: { maxOutputBytes: new TextEncoder().encode(full.stdout).length - 1 }
          });
          assert.notEqual(wrappedLimit.exitCode, 0);
        } catch (error) {
          assert.equal(error.name, "ShellLimitError");
        }
        assert.equal(new TextDecoder().decode(await fs.readFile("/out.html")), "keep");
        await fs.writeFile(
          "/bad.pdf",
          new TextEncoder().encode("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n")
        );
        const malformed = await shell.exec("pdftotext -bbox /bad.pdf /out.html");
        assert.notEqual(malformed.exitCode, 0);
        assert.equal(new TextDecoder().decode(await fs.readFile("/out.html")), "keep");
        if (runtime === "Rust") assert.equal(shell._companion, null);
      } finally {
        await shell.dispose();
      }
    }
  );

for (const runtime of ["TypeScript", "Rust"])
  test(
    `${runtime} text geometry handles a Unicode CMap explicitly`,
    { skip: !WebAssembly.Suspending },
    async () => {
      const doc = PdfDocument.create();
      doc.addPage([80, 40]);
      const page = doc.addPage([200, 200]);
      const cmap = doc.cos.allocateObject(
        cosStream(
          new TextEncoder().encode(
            "begincmap 1 begincodespacerange <00> <FF> endcodespacerange 1 beginbfchar <41> <03A9> endbfchar endcmap"
          )
        )
      );
      const font = doc.cos.allocateObject(
        cosDict({
          Type: cosName("Font"),
          Subtype: cosName("Type1"),
          BaseFont: cosName("Helvetica"),
          ToUnicode: cmap
        })
      );
      dictSet(page.pageDict, "Resources", cosDict({ Font: cosDict({ F1: font }) }));
      page.setRawContentStream("BT /F1 12 Tf 20 100 Td (A) Tj ET");
      const result = await run(runtime, doc.save(), "-bbox");
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(boxes(result.stdout).find((row) => row.tag === "word").text, "Ω");
    }
  );

for (const runtime of ["TypeScript", "Rust"])
  test(
    `${runtime} cropped text preserves logical, raw and layout formatting`,
    { skip: !WebAssembly.Suspending },
    async () => {
      for (const kind of ["words", "columns", "spacing", "diagonal"])
        for (const flags of [
          "-x 0 -W 55",
          "-raw -x 0 -W 55",
          "-layout -x 0 -W 55",
          "-layout -x 0",
          "-raw -layout -x 0",
          "-x 0 -W 55 -htmlmeta -eol dos"
        ]) {
          const pdf = wordsPdf(kind),
            actual = await run(runtime, pdf, flags);
          assert.equal(actual.exitCode, 0, actual.stderr);
          if (runtime === "Rust") {
            const expected = await run("TypeScript", pdf, flags);
            assert.equal(actual.stdout, expected.stdout, `${kind}: ${flags}`);
          }
          if (kind === "words" && flags.includes("-W")) {
            assert.ok(actual.stdout.includes("Alpha"));
            assert.ok(!actual.stdout.includes("Beta"));
          }
        }
    }
  );

for (const runtime of ["TypeScript", "Rust"])
  test(
    `${runtime} text geometry rejects unsupported StandardEncoding rather than mislabeling ligatures`,
    { skip: !WebAssembly.Suspending },
    async () => {
      const doc = PdfDocument.create();
      doc.addPage([80, 40]);
      const page = doc.addPage([200, 200]);
      const font = doc.cos.allocateObject(
        cosDict({
          Type: cosName("Font"),
          Subtype: cosName("Type1"),
          BaseFont: cosName("Helvetica"),
          Encoding: cosName("StandardEncoding")
        })
      );
      dictSet(page.pageDict, "Resources", cosDict({ Font: cosDict({ F1: font }) }));
      page.setRawContentStream("BT /F1 12 Tf 20 100 Td <AE> Tj ET");
      const result = await run(runtime, doc.save(), "-bbox");
      if (runtime === "TypeScript") {
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(boxes(result.stdout).find((row) => row.tag === "word").text, "ﬁ");
      } else {
        assert.notEqual(result.exitCode, 0);
        assert.equal(result.stdout, "");
        assert.match(result.stderr, /unsupported font encoding/);
      }
    }
  );
