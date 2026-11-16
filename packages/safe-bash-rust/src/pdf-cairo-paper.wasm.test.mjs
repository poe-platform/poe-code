import assert from "node:assert/strict";
import test from "node:test";
import {PdfDocument, cosArray, cosNumber, cosStream, cosDict, cosName, dictSet, decodePng} from "@poe-code/pdf-ast";
import {RustWasmBash} from "./index.js";

for (const runtime of ["TypeScript", "Rust"]) {
  for (const [flags, sizes] of [
    ["", [[216, 144], [144, 216], [144, 144]]],
    ["-W 75 -H 80", [[216, 144], [144, 216], [144, 144]]],
    ["-paper A4", [[842, 595], [595, 842], [595, 842]]],
    ["-paperw 900 -paperh 500", [[500, 900], [900, 500], [900, 500]]],
    ["-paperw 300 -paperh 400 -origpagesizes", [[216, 144], [144, 216], [144, 144]]],
    ["-f 2 -l 2 -paperw 120 -paperh 180", [[120, 180]]],
    ["-o", [[216, 144], [144, 144]]],
    ["-e", [[144, 216]]],
    ["-o -e", []],
  ]) test(`${runtime} Cairo PDF page sizes and selection: ${flags}`, {skip: !WebAssembly.Suspending}, async () => {
    const {Shell, createMemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
    const memory = runtime === "TypeScript" ? createMemoryFileSystem() : undefined;
    const shell = memory ? new Shell({fs: memory}).use(agentCommands()) : new RustWasmBash({cwd: "/", forceNative: true});
    const fs = memory ?? shell.fs;
    try {
      const doc = PdfDocument.create(); doc.setTitle("Paper selection");
      for (const [index, size] of [[216, 144], [144, 216], [144, 144]].entries()) doc.addPage(size).drawText(`PAGE-${index + 1}`, {x: 20, y: 50, size: 10});
      await fs.writeFile("/in.pdf", doc.save());
      const result = await shell.exec(`TMPDIR=/scratch pdftocairo -pdf ${flags} /in.pdf /out.pdf`);
      assert.equal(result.exitCode, 0, result.stderr);
      const output = PdfDocument.load(await fs.readFile("/out.pdf"));
      assert.equal(output.getPageCount(), sizes.length);
      assert.deepEqual(sizes.map((_, i) => output.getPage(i).getSize()), sizes.map(([width, height]) => ({width, height})));
      assert.equal(output.getMetadata().title, "Paper selection");
      if (flags.includes("-f 2")) {
        const extracted = await shell.exec("pdftotext /out.pdf -");
        assert.equal(extracted.exitCode, 0, extracted.stderr);
        assert.equal(extracted.stdout.trim(), "PAGE-2");
      }
      if (runtime === "Rust") assert.equal(shell._companion, null);
    } finally {await shell.dispose();}
  });

  test(`${runtime} Cairo PDF rejects invalid paper options without replacing output`, {skip: !WebAssembly.Suspending}, async () => {
    const {Shell, createMemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
    const memory = runtime === "TypeScript" ? createMemoryFileSystem() : undefined;
    const shell = memory ? new Shell({fs: memory}).use(agentCommands()) : new RustWasmBash({cwd: "/", forceNative: true});
    const fs = memory ?? shell.fs;
    try {
      const doc = PdfDocument.create(); doc.addPage([100, 100]); await fs.writeFile("/in.pdf", doc.save());
      for (const [flags, message] of [
        ["-paperw 300", "Error: both -paperw and -paperh must be specified.\n"],
        ["-paperh 400", "Error: both -paperw and -paperh must be specified.\n"],
        ["-paper A4 -paperw 300", "Error: both -paperw and -paperh must be specified.\n"],
        ["-paper a4", "Invalid paper size\n"],
        ["-paper A4 -origpagesizes", "Error: -origpagesizes and -paper may not be used together.\n"],
      ]) {
        await fs.writeFile("/out.pdf", new TextEncoder().encode("keep output"));
        const result = await shell.exec(`TMPDIR=/scratch pdftocairo -pdf ${flags} /in.pdf /out.pdf`);
        assert.equal(result.exitCode, 99, flags); assert.equal(result.stderr, message);
        assert.equal(new TextDecoder().decode(await fs.readFile("/out.pdf")), "keep output");
      }
    } finally {await shell.dispose();}
  });

  for (const rotation of [0, 90, 180, 270]) test(`${runtime} Cairo PDF preserves artwork at shifted origin with rotation ${rotation}`, {skip: !WebAssembly.Suspending}, async () => {
    const {Shell, createMemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
    const memory = runtime === "TypeScript" ? createMemoryFileSystem() : undefined;
    const shell = memory ? new Shell({fs: memory}).use(agentCommands()) : new RustWasmBash({cwd: "/", forceNative: true});
    const fs = memory ?? shell.fs;
    try {
      const doc = PdfDocument.create(), page = doc.addPage([200, 200]);
      dictSet(page.pageDict, "MediaBox", cosArray([30, 30, 230, 230].map(n => cosNumber(n)))); page.setRotation(rotation);
      page.setRawContentStream("1 0 0 1 30 30 cm 1 0 0 rg 0 100 100 100 re f 0 1 0 rg 100 100 100 100 re f 0 0 1 rg 0 0 100 100 re f 0 0 0 rg 100 0 100 100 re f");
      await fs.writeFile("/in.pdf", doc.save());
      for (const size of [100, 300]) {
        const result = await shell.exec(`TMPDIR=/scratch pdftocairo -pdf -paperw ${size} -paperh ${size} /in.pdf /out.pdf`);
        assert.equal(result.exitCode, 0, result.stderr);
        const output = PdfDocument.load(await fs.readFile("/out.pdf"));
        assert.deepEqual(output.getPage(0).getSize(), {width: size, height: size});
        assert.equal(output.getPage(0).getRotation(), rotation);
        // A common reader checks the written PDF rather than each runtime's own renderer.
        const png = decodePng(output.getPage(0).renderToPng({scale: 1}));
        const pixel = (x, y) => [...png.data.slice((y * png.width + x) * 4, (y * png.width + x) * 4 + 3)];
        const colors = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [0, 0, 0]];
        const order = [[0, 1, 2, 3], [2, 0, 3, 1], [3, 2, 1, 0], [1, 3, 0, 2]][rotation / 90];
        const margin = Math.max(0, (size - 200) / 2), half = Math.min(size, 200) / 2;
        assert.deepEqual([pixel(margin + 10, margin + 10), pixel(margin + half + 10, margin + 10), pixel(margin + 10, margin + half + 10), pixel(margin + half + 10, margin + half + 10)], order.map(i => colors[i]));
        if (size === 300) assert.deepEqual(pixel(10, 10), [255, 255, 255]);
      }
    } finally {await shell.dispose();}
  });

  test(`${runtime} Cairo PDF keeps image resources and shared content arrays through crop and stdout`, {skip: !WebAssembly.Suspending}, async () => {
    const {Shell, createMemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
    const memory = runtime === "TypeScript" ? createMemoryFileSystem() : undefined;
    const shell = memory ? new Shell({fs: memory}).use(agentCommands()) : new RustWasmBash({cwd: "/", forceNative: true});
    const fs = memory ?? shell.fs;
    try {
      const doc = PdfDocument.create();
      const image = doc.cos.allocateObject(cosStream(new Uint8Array([255, 0, 0]), {dict: cosDict({Type: cosName("XObject"), Subtype: cosName("Image"), Width: cosNumber(1), Height: cosNumber(1), BitsPerComponent: cosNumber(8), ColorSpace: cosName("DeviceRGB")})}));
      const prefix = doc.cos.allocateObject(cosStream(new TextEncoder().encode("q 100 0 0 100 0 100 cm")));
      const paint = doc.cos.allocateObject(cosStream(new TextEncoder().encode("/Im1 Do Q")));
      const shared = doc.cos.allocateObject(cosArray([prefix, paint]));
      for (let i = 0; i < 2; i++) {
        const page = doc.addPage([200, 200]);
        dictSet(page.pageDict, "Resources", cosDict({XObject: cosDict({Im1: image})}));
        dictSet(page.pageDict, "Contents", shared);
      }
      await fs.writeFile("/in.pdf", doc.save());
      const result = await shell.exec("TMPDIR=/scratch pdftocairo -pdf -f 2 -l 2 -r 144 -W 100 -H 100 /in.pdf - > /out.pdf");
      assert.equal(result.exitCode, 0, result.stderr);
      const output = PdfDocument.load(await fs.readFile("/out.pdf"));
      assert.equal(output.getPageCount(), 1);
      assert.deepEqual(output.getPage(0).getSize(), {width: 200, height: 200});
      const png = decodePng(output.getPage(0).renderToPng({scale: 1}));
      const pixel = (x, y) => [...png.data.slice((y * png.width + x) * 4, (y * png.width + x) * 4 + 3)];
      assert.deepEqual(pixel(60, 60), [255, 0, 0]);
      assert.deepEqual(pixel(140, 140), [255, 0, 0]);
      assert.deepEqual(pixel(10, 10), [255, 255, 255]);
      assert.deepEqual(Buffer.from(await fs.readFile("/in.pdf")), Buffer.from(doc.save()));
      await fs.writeFile("/out.pdf", new TextEncoder().encode("keep output"));
      await assert.rejects(shell.exec("TMPDIR=/scratch pdftocairo -pdf -paperw 300 -paperh 300 /in.pdf /out.pdf", {limits: {maxOutputBytes: 1}}), {name: "ShellLimitError", limit: "maxOutputBytes"});
      assert.equal(new TextDecoder().decode(await fs.readFile("/out.pdf")), "keep output");
      const missing = await shell.exec("TMPDIR=/scratch pdftocairo -pdf -q /in.pdf /missing/out.pdf");
      assert.equal(missing.exitCode, 2); assert.equal(missing.stderr, "Error opening output file /missing/out.pdf\n");
    } finally {await shell.dispose();}
  });
}
