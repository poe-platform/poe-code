import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test, vi } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";
import { PdfDocument, PdfRetainedPage, decodePng, encodePng, encodeJpeg, cosName, cosStream, cosDict, cosArray, cosNumber, dictSet } from "@poe-code/pdf-ast";
import { createPdftoppmCommand, runPdftoppmCli, createPdftocairoCommand, runPdftocairoCli, runPdftocairoCliSync } from "./index.js";
function pdf() {
  const doc = PdfDocument.create();
  for (const rotation of [0, 90]) {
    const page = doc.addPage(); dictSet(page.pageDict, "MediaBox", cosArray([0, 0, 17, 19].map(value => cosNumber(value))));
    dictSet(page.pageDict, "Rotate", cosNumber(rotation)); page.drawRect({ x: 2, y: 3, width: 7, height: 8, fill: { r: 0.2, g: 0.7, b: 0.4 } });
  }
  return doc.save();
}
async function fixture(input: Uint8Array, args: string[], stdin = false) {
  const fs = createMemoryFileSystem(); await fs.writeFile("/in.pdf", input);
  let reads = 0, writes = 0, published = 0; const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const guarded = new Proxy(Object.create(fs) as typeof fs, { get(_target, key) {
    if (key === "readFile") return async () => { reads++; throw new Error("whole reads forbidden"); };
    if (key === "writeFile") return async () => { writes++; throw new Error("whole writes forbidden"); };
    if (key === "publishStagedFile") return async (...args: Parameters<NonNullable<typeof fs.publishStagedFile>>) => { published++; return fs.publishStagedFile!(...args); };
    const value = Reflect.get(fs, key); return typeof value === "function" ? value.bind(fs) : value;
  } });
  const carrier = createCommandArguments(args), controller = new AbortController();
  const context = { command: "pdftoppm", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs: guarded, signal: controller.signal,
    stdin: (async function* (): AsyncGenerator<Uint8Array, void, unknown> { if (!stdin) return; const buffer = new Uint8Array(37); for (let at = 0; at < input.length; at += 37) { const size = Math.min(37, input.length - at); buffer.set(input.subarray(at, at + size)); yield buffer.subarray(0, size); } })(),
    stdout: { async write(bytes: Uint8Array) { await Promise.resolve(); stdout.push(bytes.slice()); } }, stderr: { async write(bytes: Uint8Array) { stderr.push(bytes.slice()); } },
  };
  return { fs, context, controller, stdout, stderr, counts: () => ({ reads, writes, published }), async clean() { assert.deepEqual(await fs.readdir("/scratch"), []); } };
}
test("retained invoice rendering evaluates once across tiles and preserves the complete image", async () => {
  const doc = PdfDocument.create(), page = doc.addPage([144, 144]);
  page.drawRect({ x: 5, y: 5, width: 134, height: 134, fill: { r: 0.9, g: 0.95, b: 0.9 } });
  page.drawText("INVOICE", { x: 10, y: 120, size: 16 });
  page.drawText("Total: $430.44", { x: 10, y: 20, size: 12 });
  const input = doc.save(), args = ["-png", "-r", "150", "in.pdf", "out"], files = new Map([["in.pdf", input]]);
  const expected = await runPdftoppmCli(args, files), f = await fixture(input, args);
  const evaluate = vi.spyOn(PdfRetainedPage.prototype, "evaluateSteps");
  try {
    assert.equal((await createPdftoppmCommand().execute(f.context)).exitCode, expected.exitCode);
    assert.deepEqual(await f.fs.readFile("/out-1.png"), files.get("out-1.png"));
    assert.equal(evaluate.mock.calls.length, 1);
    assert.deepEqual(f.counts(), { reads: 0, writes: 0, published: 1 }); await f.clean();
  } finally { evaluate.mockRestore(); }
});
test("Poppler resolves general and per-axis DPI after parsing every flag", async () => {
  const doc = PdfDocument.create();
  doc.addPage([288, 144]);
  const input = doc.save();
  for (const [cli, command] of [[runPdftoppmCli, createPdftoppmCommand()], [runPdftocairoCli, createPdftocairoCommand()]] as const) {
    for (const [flags, size] of [
      [["-r", "72", "-rx", "36"], [288, 144]],
      [["-ry", "18", "-rx", "36", "-r", "72"], [144, 36]],
      [["-ry", "18", "-rx", "150", "-r", "72"], [288, 144]],
      [["-ry", "18", "-r", "72", "-r", "0"], [600, 36]],
      [["-rx", "0.25", "-ry", "0.75"], [1, 2]],
    ] as const) {
      const args = ["-png", "-singlefile", ...flags, "in.pdf", "page"];
      const files = new Map([["in.pdf", input]]), f = await fixture(input, args);
      assert.equal((await cli(args, files)).exitCode, 0);
      assert.equal((await command.execute(f.context)).exitCode, 0);
      for (const bytes of [files.get("page.png")!, await f.fs.readFile("/page.png")]) {
        const { width, height } = decodePng(bytes);
        assert.deepEqual([width, height], size, flags.join(" "));
      }
      await f.clean();
    }
  }
});
test("pdftocairo applies raster DPI along the rotated output axes", async () => {
  for (const rotation of [90, 270] as const) {
    const doc = PdfDocument.create(), page = doc.addPage([12, 8]);
    page.setRotation(rotation);
    page.drawRect({ x: 2, y: 2, width: 4, height: 4, fill: { r: 0, g: 0, b: 0 } });
    const input = doc.save(), top = rotation === 90 ? 2 : 6;
    for (const flags of [["-rx", "144", "-ry", "72"], ["-scale-to-x", "16", "-scale-to-y", "12"]]) {
      const args = ["-png", "-singlefile", ...flags, "in.pdf", "page"];
      const files = new Map([["in.pdf", input]]), f = await fixture(input, args);
      assert.equal((await runPdftocairoCli(args, files)).exitCode, 0);
      assert.equal((await createPdftocairoCommand().execute(f.context)).exitCode, 0);
      for (const bytes of [files.get("page.png")!, await f.fs.readFile("/page.png")]) {
        const { width, height, data } = decodePng(bytes);
        assert.deepEqual([width, height], [16, 12]);
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
          const value = x >= 4 && x < 12 && y >= top && y < top + 4 ? 0 : 255;
          assert.deepEqual(Array.from(data.subarray((y * width + x) * 4, (y * width + x + 1) * 4)), [value, value, value, 255]);
        }
      }
      await f.clean();
    }
  }
});

test("Poppler scales a subpoint page by its actual dimensions", async () => {
  const doc = PdfDocument.create();
  doc.addPage([0.5, 0.75]);
  const input = doc.save();
  for (const [cli, command] of [[runPdftoppmCli, createPdftoppmCommand()], [runPdftocairoCli, createPdftocairoCommand()]] as const) {
    for (const [flags, size] of [[["-scale-to", "13"], [9, 13]], [["-scale-to-x", "15", "-scale-to-y", "17"], [15, 17]]] as const) {
      const args = ["-png", "-singlefile", ...flags, "in.pdf", "page"];
      const files = new Map([["in.pdf", input]]), f = await fixture(input, args);
      assert.equal((await cli(args, files)).exitCode, 0);
      assert.equal((await command.execute(f.context)).exitCode, 0);
      for (const bytes of [files.get("page.png")!, await f.fs.readFile("/page.png")]) {
        const { width, height } = decodePng(bytes);
        assert.deepEqual([width, height], size);
      }
      await f.clean();
    }
  }
});
test("renders an embedded fax scan like Poppler pdftoppm at 72 dpi", async () => {
  const doc = PdfDocument.create(), page = doc.addPage([19, 7]);
  const scan = doc.cos.allocateObject(cosStream(Buffer.from("935cdc6ed249622466a0cd66ba492a4925001001", "hex"), {
    compress: false, dict: cosDict({ Type: cosName("XObject"), Subtype: cosName("Image"),
      Width: cosNumber(19), Height: cosNumber(7), ColorSpace: cosName("DeviceGray"), BitsPerComponent: cosNumber(1),
      Filter: cosName("CCITTFaxDecode"), DecodeParms: cosDict({K: cosNumber(-1), Columns: cosNumber(19), BlackIs1: {kind:"boolean",value:true}}) })
  }));
  page.setRawContentStream(`q 19 0 0 7 0 0 cm /${page.ensureXObjectResource(scan)} Do Q`);
  const input = doc.save(), args = ["-gray", "-singlefile", "-r", "72", "in.pdf", "page"];
  const files = new Map([["in.pdf", input]]), f = await fixture(input, args);
  assert.equal((await runPdftoppmCli(args, files)).exitCode, 0);
  assert.equal((await createPdftoppmCommand().execute(f.context)).exitCode, 0);
  const expected = "50350a313920370a3235350a00000000000000000000000000000000000000dfdf150000009bdfdf630000004ddfdfb20000ff480600008febff8b1c00004bd5ffcf330000ffa39f9f9fe7ffffc59f9f9fc5ffffe79f9f9f7f7f7febffffa57f7f7fbfffffd27f7f7f92ff000055e6ffb72f000034afffd86700001277ff003cebffcc2f000026a8ffe27200000f65fff8";
  for (const bytes of [files.get("page.pgm")!, await f.fs.readFile("/page.pgm")]) assert.equal(Buffer.from(bytes).toString("hex"), expected);
  await f.clean();
});
test("pdftoppm interpolates the color channels of an upright JPEG like Poppler", async () => {
  const { readFileSync } = await import("node:fs");
  const doc = PdfDocument.create(), page = doc.addPage([17, 13]);
  const photo = doc.embedJpg(readFileSync(new URL("../../pdf-ast/src/fixtures/jpeg-rgb-direct.jpg", import.meta.url)));
  page.drawImage(photo, { x: 0, y: 0, width: 17, height: 13 });
  const input = doc.save(), args = ["-r", "72", "-singlefile", "in.pdf", "page"];
  const files = new Map([["in.pdf", input]]), f = await fixture(input, args);
  assert.equal((await runPdftoppmCli(args, files)).exitCode, 0);
  assert.equal((await createPdftoppmCommand().execute(f.context)).exitCode, 0);
  const offset = "P6\n17 13\n255\n".length + (4 * 17 + 3) * 3;
  for (const bytes of [files.get("page.ppm")!, await f.fs.readFile("/page.ppm")]) {
    assert.ok([31, 63, 58].every((v, i) => Math.abs(bytes[offset + i]! - v) <= 1));
  }
  await f.clean();
});
for (const flags of [["-svg"], [], ["-gray"], ["-mono"], ["-png"], ["-jpeg"], ["-jpegcmyk"], ["-tiff"], ["-png", "-gray"], ["-tiff", "-tiffcompression", "lzw"], ["-rx", "90", "-ry", "47", "-x", "2", "-W", "9"]]) {
  test(`retained rendering matches bytes without whole input or output: ${flags.join(" ")}`, async () => {
    const input = pdf(), args = [...flags, "in.pdf", "out"], files = new Map([["in.pdf", input]]); const expected = await runPdftoppmCli(args, files);
    const f = await fixture(input, args); assert.equal((await createPdftoppmCommand().execute(f.context)).exitCode, expected.exitCode);
    for (const [name, bytes] of files) if (name !== "in.pdf") assert.deepEqual(await f.fs.readFile("/" + name), bytes);
    assert.equal(new TextDecoder().decode(Buffer.concat(f.stderr)), expected.stderr); assert.deepEqual(f.counts(), { reads: 0, writes: 0, published: 2 }); await f.clean();
  });
}
test("retained rendering accepts reused stdin and streams multiple images to a slow sink", async () => {
  const input = pdf(), args = ["-png", "-", "-"]; const expected = await runPdftoppmCli(args, new Map([["-", input]])); const f = await fixture(input, args, true);
  assert.equal((await createPdftoppmCommand().execute(f.context)).exitCode, 0); assert.deepEqual(new Uint8Array(Buffer.concat(f.stdout)), expected.stdoutBytes);
  assert.deepEqual(f.counts(), { reads: 0, writes: 0, published: 0 }); await f.clean();
});
for (const flags of [["-f", "9"], ["-q", "-f", "9"], ["-f", "2", "-singlefile", "-forcenum", "-setpageno", "7", "-sep", "_", "-progress"], ["-e", "-singlefile", "-scale-to", "20"], ["-o", "-scale-to-x", "20", "-scale-to-y", "-1"]]) {
  test(`retained rendering preserves selection and diagnostics: ${flags.join(" ")}`, async () => {
    const input = pdf(), args = [...flags, "in.pdf", "out"], files = new Map([["in.pdf", input]]); const expected = await runPdftoppmCli(args, files);
    const f = await fixture(input, args); assert.equal((await createPdftoppmCommand().execute(f.context)).exitCode, expected.exitCode);
    for (const [name, bytes] of files) if (name !== "in.pdf") assert.deepEqual(await f.fs.readFile("/" + name), bytes);
    assert.equal(new TextDecoder().decode(Buffer.concat(f.stderr)), expected.stderr); assert.equal(f.counts().reads, 0); await f.clean();
  });
}
test("retained renderer rejects input budget before payload reads and publication", async () => {
  const input = pdf(), f = await fixture(input, ["in.pdf", "out"]);
  await assert.rejects(async () => createPdftoppmCommand({ limits: { maxInputBytes: input.length - 1 } }).execute(f.context));
  assert.deepEqual(f.counts(), { reads: 0, writes: 0, published: 0 }); await f.clean();
});
test("retained renderer propagates sink failures and cleans staged pages", async () => {
  const f = await fixture(pdf(), ["in.pdf", "-"]), reason = { reason: "sink closed" };
  f.context.stdout.write = async () => { throw reason; };
  await assert.rejects(async () => createPdftoppmCommand().execute(f.context), error => error === reason); await f.clean();
});
test("retained renderer cancels stdin with primary error identity and no publication", async () => {
  const input = pdf(), f = await fixture(input, ["-", "out"], true), reason = { reason: "input cancelled" }; let closed = false;
  f.context.stdin = (async function* () { try { yield input.subarray(0, 31); f.controller.abort(reason); yield input.subarray(31); } finally { closed = true; } })();
  await assert.rejects(async () => createPdftoppmCommand().execute(f.context), error => error === reason); assert.equal(closed, true);
  assert.equal(f.counts().published, 0); await f.clean();
});
test("retained renderer keeps an existing destination after a partially accepted publication write fails", async () => {
  const f = await fixture(pdf(), ["-singlefile", "in.pdf", "out"]); await f.fs.writeFile("/out.ppm", new TextEncoder().encode("old image"));
  const base = f.context.fs;
  f.context.fs = new Proxy(Object.create(base) as typeof base, { get(_target, key) {
    if (key === "createStagedFile") return async (...args: Parameters<NonNullable<typeof base.createStagedFile>>) => {
      const staged = await base.createStagedFile!(...args); if (args[1] !== "output") return staged;
      return { ...staged, writer: { finish: staged.writer!.finish.bind(staged.writer), async write(...values: Parameters<NonNullable<typeof staged.writer>["write"]>) {
        await staged.writer!.write(...values); throw Object.assign(new Error("partial publication write"), { code: "EIO" });
      } } };
    };
    const value = Reflect.get(base, key); return typeof value === "function" ? value.bind(base) : value;
  } });
  assert.equal((await createPdftoppmCommand().execute(f.context)).exitCode, 1);
  assert.equal(new TextDecoder().decode(await f.fs.readFile("/out.ppm")), "old image"); assert.equal(f.counts().published, 0); await f.clean();
});
for (const quiet of [false, true]) test(`retained renderer preserves encrypted input diagnostics (quiet=${quiet})`, async () => {
  const doc = PdfDocument.create(); doc.addPage([8, 8]); const input = doc.save({ encrypt: { userPassword: "reader", ownerPassword: "owner" } });
  const args = [...(quiet ? ["-q"] : []), "-upw", "wrong", "in.pdf", "out"], expected = await runPdftoppmCli(args, new Map([["in.pdf", input]]));
  const f = await fixture(input, args); assert.equal((await createPdftoppmCommand().execute(f.context)).exitCode, expected.exitCode);
  assert.equal(new TextDecoder().decode(Buffer.concat(f.stderr)), expected.stderr); assert.equal(f.counts().published, 0); await f.clean();
});
for (const flags of [[], ["-png"], ["-png", "-gray"], ["-png", "-mono"], ["-jpeg"], ["-tiff", "-mono"], ["-png", "-antialias", "none", "-transp"]]) {
  test(`retained Cairo preserves existing raster bytes and default output names: ${flags.join(" ")}`, async () => {
    const input = pdf(), args = [...flags, "in.pdf"], files = new Map([["in.pdf", input]]), expected = await runPdftocairoCli(args, files);
    const f = await fixture(input, args); f.context.command = "pdftocairo";
    assert.equal((await createPdftocairoCommand({ limits: { maxInputBytes: input.length } }).execute(f.context)).exitCode, expected.exitCode);
    for (const [name, bytes] of files) if (name !== "in.pdf") assert.deepEqual(await f.fs.readFile("/" + name), bytes);
    assert.deepEqual(f.counts(), { reads: 0, writes: 0, published: files.size - 1 }); await f.clean();
  });
}
test("retained Cairo keeps stdout grayscale semantics with reused input and a slow sink", async () => {
  const input = pdf(), args = ["-png", "-gray", "-", "-"], expected = await runPdftocairoCli(args, new Map([["-", input]]));
  const f = await fixture(input, args, true); f.context.command = "pdftocairo";
  assert.equal((await createPdftocairoCommand({ limits: { maxInputBytes: input.length } }).execute(f.context)).exitCode, 0);
  assert.deepEqual(new Uint8Array(Buffer.concat(f.stdout)), expected.stdoutBytes); assert.equal(f.counts().reads, 0); await f.clean();
});
test("retained Cairo preserves publication exit code and missing-parent diagnostic", async () => {
  const f = await fixture(pdf(), ["-png", "in.pdf", "/missing/out"]); f.context.command = "pdftocairo";
  assert.equal((await createPdftocairoCommand().execute(f.context)).exitCode, 2);
  assert.equal(new TextDecoder().decode(Buffer.concat(f.stderr)), "Error opening output file /missing/out-1.png\n");
  assert.equal(f.counts().published, 0); await f.clean();
});

for (const cairo of [false, true]) for (const failure of ["none", "write", "cancel"]) test(`retained raster spills decoded images to caller storage (Cairo=${cairo}, failure=${failure})`, async () => {
  const document = PdfDocument.create(), page = document.addPage([16, 16]);
  const data = Uint8Array.from({ length: 257 * 129 * 4 }, (_, at) => at % 4 === 3 ? 255 : at * 31 % 256);
  page.drawImage(document.embedPng(encodePng({ width: 257, height: 129, data })), { x: 0, y: 0, width: 16, height: 16 });
  const input = document.save(), args = ["-png", "-r", "72", "in.pdf", "-"], f = await fixture(input, args);
  const expected = await (cairo ? runPdftocairoCli : runPdftoppmCli)(args, new Map([["in.pdf", input]]));
  const reason = new Error("pixel backing failure");
  const base = f.context.fs; let spills = 0, closed = 0, largestWrite = 0;
  f.context.fs = new Proxy(Object.create(base) as typeof base, { get(_target, key) {
    if (key === "open") return async (...args: Parameters<NonNullable<typeof base.open>>) => {
      const descriptor = await base.open!(...args);
      if (!args[0].includes(".storage-")) return descriptor;
      spills++;
      return new Proxy(descriptor, { get(target, property) {
        if (property === "write") return async (...values: Parameters<typeof descriptor.write>) => {
          largestWrite = Math.max(largestWrite, values[0].length);
          if (failure === "write") throw reason;
          if (failure === "cancel") f.controller.abort(reason);
          return descriptor.write(...values);
        };
        if (property === "close") return async () => { closed++; await descriptor.close(); };
        const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value;
      } });
    };
    const value = Reflect.get(base, key); return typeof value === "function" ? value.bind(base) : value;
  } });
  const execute = async () => (cairo ? createPdftocairoCommand() : createPdftoppmCommand()).execute(f.context);
  if (failure === "none") {
    assert.equal((await execute()).exitCode, 0);
    assert.deepEqual(new Uint8Array(Buffer.concat(f.stdout)), expected.stdoutBytes);
  } else { await assert.rejects(execute, error => error === reason); assert.equal(f.stdout.length, 0); }
  assert.ok(spills > 0, "decoded images must spill through injected safe-fs"); assert.equal(closed, spills);
  assert.ok(largestWrite <= 16384); await f.clean();
});

for(const args of [["-svg","in.pdf"],["-svg","in.pdf","custom.SVG"],["-svg","-","-"],["-svg","-f","2","in.pdf","out"]])test(`retained Cairo SVG preserves bytes ${args.join(" ")}`,async()=>{const input=pdf(),files=new Map([[args.includes("-")?"-":"in.pdf",input]]),expected=await runPdftocairoCli(args,files),f=await fixture(input,args,args.includes("-"));assert.equal((await createPdftocairoCommand().execute(f.context)).exitCode,expected.exitCode);for(const [name,bytes] of files)if(name!=="in.pdf"&&name!=="-")assert.deepEqual(await f.fs.readFile("/"+name),bytes);if(expected.stdoutBytes)assert.deepEqual(new Uint8Array(Buffer.concat(f.stdout)),expected.stdoutBytes);assert.deepEqual(f.counts().reads,0);await f.clean();});
for(const cairo of [false,true])test(`SVG preserves sink failure identity and removes all staging Cairo=${cairo}`,async()=>{const f=await fixture(pdf(),['-svg','in.pdf','-']),reason=new Error('SVG sink failed');f.context.stdout.write=async()=>{throw reason;};await assert.rejects(async()=> (cairo?createPdftocairoCommand():createPdftoppmCommand()).execute(f.context),error=>error===reason);assert.deepEqual(f.counts(),{reads:0,writes:0,published:0});await f.clean();});

for (const rotation of [0, 90, 180, 270] as const) for (const beforeRotation of [false, true]) {
  for (const [x, y, width, height] of [[100, -1, 100, 67], [-1, 100, 150, 100], [100, 50, 100, 50]] as const) {
    test(`axis scaling rotation=${rotation}, beforeRotation=${beforeRotation}, x=${x}, y=${y}`, async () => {
      const doc = PdfDocument.create(); doc.addPage([216, 144]).setRotation(rotation);
      const input = doc.save();
      const args = ["-png", "-singlefile", "-scale-to-x", String(x), "-scale-to-y", String(y),
        ...(beforeRotation ? ["-scale-dimension-before-rotation"] : []), "in.pdf", "out"];
      const quarter = rotation === 90 || rotation === 270;
      const expected = quarter ? (beforeRotation ? (x === 100 && y === -1 ? [100, 150] : x === -1 ? [67, 100] : [100, 50]) : [height, width]) : [width, height];
      const files = new Map([["in.pdf", input]]);
      assert.equal((await runPdftoppmCli(args, files)).exitCode, 0);
      const buffered = decodePng(files.get("out.png")!);
      assert.deepEqual([buffered.width, buffered.height], expected);
      const f = await fixture(input, args);
      assert.equal((await createPdftoppmCommand().execute(f.context)).exitCode, 0);
      const retained = decodePng(await f.fs.readFile("/out.png"));
      assert.deepEqual([retained.width, retained.height], expected);
      await f.clean();
    });
  }
}

for (const rotation of [0, 90, 180, 270] as const) for (const [x, y, width, height] of (rotation === 90 || rotation === 270
  ? [[100, -1, 100, 150], [-1, 100, 67, 101], [100, 50, 100, 51]] as const
  : [[100, -1, 101, 67], [-1, 100, 150, 100], [100, 50, 101, 50]] as const)) {
  test(`Cairo targets rotated axes rotation=${rotation}, x=${x}, y=${y}`, async () => {
    const doc = PdfDocument.create(); doc.addPage([216, 144]).setRotation(rotation);
    const input = doc.save(), args = ["-png", "-singlefile", "-scale-to-x", String(x), "-scale-to-y", String(y), "in.pdf", "out"];
    const files = new Map([["in.pdf", input]]);
    assert.equal((await runPdftocairoCli(args, files)).exitCode, 0);
    const buffered = decodePng(files.get("out.png")!);
    assert.deepEqual([buffered.width, buffered.height], [width, height]);
    const sync = runPdftocairoCliSync([...args.slice(0, -1), "-"], new Map([["in.pdf", input]]));
    assert.equal(sync.exitCode, 0);
    const stdout = decodePng(sync.stdoutBytes!);
    assert.deepEqual([stdout.width, stdout.height], [width, height]);
    const f = await fixture(input, args); f.context.command = "pdftocairo";
    assert.equal((await createPdftocairoCommand().execute(f.context)).exitCode, 0);
    const retained = decodePng(await f.fs.readFile("/out.png"));
    assert.deepEqual([retained.width, retained.height], [width, height]);
    await f.clean();
  });
}

for (const cairo of [false, true]) for (const [pageWidth, pageHeight, scale, width, height] of [
  [220, 160, 128, 128, 94],
  [30, 20.25, 128, 128, 87],
  [220, 160, 100, 100, 73],
  [30, 20.25, 100, 100, 68],
] as const) {
  test(`scaled raster rounds up ${pageWidth}x${pageHeight} to ${scale}, Cairo=${cairo}`, async () => {
    const doc = PdfDocument.create(); doc.addPage([pageWidth, pageHeight]);
    const input = doc.save(), args = ["-png", "-singlefile", "-scale-to", String(scale), "in.pdf", "out"];
    const files = new Map([["in.pdf", input]]);
    assert.equal((await (cairo ? runPdftocairoCli : runPdftoppmCli)(args, files)).exitCode, 0);
    const buffered = decodePng(files.get("out.png")!);
    assert.deepEqual([buffered.width, buffered.height], [width, height]);
    const f = await fixture(input, args);
    f.context.command = cairo ? "pdftocairo" : "pdftoppm";
    assert.equal((await (cairo ? createPdftocairoCommand() : createPdftoppmCommand()).execute(f.context)).exitCode, 0);
    const retained = decodePng(await f.fs.readFile("/out.png"));
    assert.deepEqual([retained.width, retained.height], [width, height]);
    await f.clean();
  });
}

for (const cairo of [false, true]) for (const [dpi, width, height] of [
  [36, 15, 11], [72, 30, 21], [96, 40, 27], [150, 63, 43],
] as const) {
  test(`fractional fixture page rounds up at ${dpi} DPI, Cairo=${cairo}`, async () => {
    const input = readFileSync(new URL("../../pdf-ast/src/fixtures/pdfjs-jp2-resetprob.pdf", import.meta.url));
    const args = ["-f", "1", "-l", "1", "-r", String(dpi), "-png", "-singlefile", "in.pdf", ...(cairo ? ["-"] : [])];
    const f = await fixture(input, args);
    f.context.command = cairo ? "pdftocairo" : "pdftoppm";
    assert.equal((await (cairo ? createPdftocairoCommand() : createPdftoppmCommand()).execute(f.context)).exitCode, 0);
    const retained = decodePng(new Uint8Array(Buffer.concat(f.stdout)));
    assert.deepEqual([retained.width, retained.height], [width, height]);
    const buffered = await (cairo ? runPdftocairoCli : runPdftoppmCli)(args, new Map([["in.pdf", input]]));
    assert.equal(buffered.exitCode, 0);
    const bitmap = decodePng(buffered.stdoutBytes!);
    assert.deepEqual([bitmap.width, bitmap.height], [width, height]);
    await f.clean();
  });
}

for (const format of ["png", "pbm"] as const) for (const retained of [false, true]) {
  test(`monochrome ${format} preserves Poppler midtones (retained=${retained})`, async () => {
    const doc = PdfDocument.create(), page = doc.addPage([200, 100]);
    page.drawRect({ x: 10, y: 10, width: 80, height: 60, fill: { r: 1, g: 0, b: 0 } });
    page.drawRect({ x: 110, y: 10, width: 8, height: 8, fill: { r: 0, g: 0, b: 0 } });
    const input = doc.save(), args = [...(format === "png" ? ["-png"] : []), "-mono", "-r", "72", "-singlefile", "in.pdf", "out"];
    const f = await fixture(input, args), files = new Map([["in.pdf", input]]);
    const result = retained ? await createPdftoppmCommand().execute(f.context) : await runPdftoppmCli(args, files);
    assert.equal(result.exitCode, 0);
    const bytes = retained ? await f.fs.readFile(`/out.${format}`) : files.get(`out.${format}`)!;
    const rgba = format === "png" ? decodePng(bytes).data : undefined;
    const header = new TextEncoder().encode("P4\n200 100\n");
    if (!rgba) assert.deepEqual(bytes.subarray(0, header.length), header);
    const pixel = (x: number, y: number) => rgba ? rgba[(y * 200 + x) * 4]! : (bytes[header.length + y * 25 + (x >> 3)]! & (128 >> (x & 7))) ? 0 : 255;
    // Poppler 26.09.0, pdftoppm -mono -r 72: 3,300 black / 1,500 white.
    const native = [[255, 0, 255, 0], [0, 0, 0, 0], [255, 0, 255, 0], [0, 0, 0, 255]];
    let black = 0;
    for (let y = 30; y < 90; y++) for (let x = 10; x < 90; x++) {
      assert.equal(pixel(x, y), native[y & 3]![x & 3]);
      if (pixel(x, y) === 0) black++;
    }
    assert.equal(black, 3300);
    assert.equal(pixel(0, 0), 255);
    for (let y = 82; y < 90; y++) for (let x = 110; x < 118; x++) assert.equal(pixel(x, y), 0);
    if (retained) await f.clean();
  });
}

test("renders short JPEG samples on the PDF grid in both command paths", async () => {
  const doc = PdfDocument.create();
  const image = doc.embedJpg(encodeJpeg({ width: 1, height: 1, data: new Uint8Array([255, 0, 0, 255]) }));
  const stream = doc.cos.resolve(image.xobjectRef);
  assert.equal(stream?.kind, "stream");
  if (stream?.kind !== "stream") throw new Error("Missing image");
  dictSet(stream.dict, "Width", cosNumber(200));
  dictSet(stream.dict, "Height", cosNumber(100));
  doc.addPage([200, 100]).drawImage(image, { x: 0, y: 0, width: 200, height: 100 });
  const input = doc.save(), args = ["-png", "-r", "72", "-singlefile", "in.pdf", "out"];
  const files = new Map([["in.pdf", input]]), f = await fixture(input, args);
  assert.equal((await runPdftoppmCli(args, files)).exitCode, 0);
  assert.equal((await createPdftoppmCommand().execute(f.context)).exitCode, 0);
  for (const bytes of [files.get("out.png")!, await f.fs.readFile("/out.png")]) {
    const bitmap = decodePng(bytes);
    assert.deepEqual([bitmap.width, bitmap.height], [200, 100]);
    assert.ok(bitmap.data[0]! >= 250);
    assert.ok(bitmap.data[1]! <= 5);
    assert.ok(bitmap.data[2]! <= 5);
    assert.equal(bitmap.data[3], 255);
    assert.ok(bitmap.data.subarray(4).every(value => value === 255));
  }
  await f.clean();
});

test("Illustrator transparency overlaps retain color through the public command", async () => {
  const input = readFileSync(new URL("../../pdf-ast/src/fixtures/pdfjs-transparency_group.pdf", import.meta.url));
  const f = await fixture(input, ["-f", "1", "-l", "1", "-scale-to", "256", "-singlefile", "-png", "/in.pdf"]);
  assert.equal((await createPdftoppmCommand().execute(f.context)).exitCode, 0);
  assert.equal(Buffer.concat(f.stderr).toString(), "");
  const bitmap = decodePng(Buffer.concat(f.stdout));
  assert.equal(bitmap.width, 256);
  assert.equal(bitmap.height, 192);
  // Poppler 26.08.0 reference. These points lie on subpixel outlines;
  // allow the different curve flattening and 4x4 coverage of our rasterizer.
  for (const [x, y, expected] of [
    [100, 95, [160, 149, 124, 255]],
    [99, 43, [159, 146, 117, 255]],
    [165, 134, [141, 77, 99, 255]],
    [30, 30, [255, 255, 255, 255]],
  ] as const) {
    const actual = bitmap.data.subarray((y * bitmap.width + x) * 4, (y * bitmap.width + x) * 4 + 4);
    for (let channel = 0; channel < 4; channel++) {
      assert.ok(Math.abs(actual[channel]! - expected[channel]!) <= (x === 30 || channel === 3 ? 0 : 25), `(${x},${y}): ${Array.from(actual)} expected ${expected}`);
    }
  }
  await f.clean();
});

for (const retained of [false, true]) {
  test(`TIFF preserves both resolution axes (${retained ? "retained" : "buffered"})`, async () => {
    const doc = PdfDocument.create(); doc.addPage([612, 792]);
    const input = doc.save(), args = ["-rx", "24", "-ry", "48", "-tiff", "-singlefile", "in.pdf", "out"];
    let bytes: Uint8Array;
    if (retained) {
      const f = await fixture(input, args);
      assert.equal((await createPdftoppmCommand().execute(f.context)).exitCode, 0);
      bytes = await f.fs.readFile("/out.tif"); await f.clean();
    } else {
      const files = new Map([["in.pdf", input]]);
      assert.equal((await runPdftoppmCli(args, files)).exitCode, 0);
      bytes = files.get("out.tif")!;
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const ifd = view.getUint32(4, true), tags = new Map<number, number>();
    for (let i = 0; i < view.getUint16(ifd, true); i++) {
      const at = ifd + 2 + i * 12, type = view.getUint16(at + 2, true), value = view.getUint32(at + 8, true);
      tags.set(view.getUint16(at, true), type === 5 ? view.getUint32(value, true) / view.getUint32(value + 4, true) : value);
    }
    assert.deepEqual([tags.get(256), tags.get(257)], [204, 528]);
    assert.deepEqual([tags.get(282), tags.get(283), tags.get(296)], [24, 48, 2]);
  });
}

for (const retained of [false, true]) {
  for (const [flags, expected] of [
    [[], [150, 150]],
    [["-r", "96"], [96, 96]],
    [["-rx", "24", "-ry", "48"], [24, 48]],
    [["-scale-to", "36"], [36, 36]],
  ] as const) {
    test(`JPEG preserves JFIF resolution ${flags.join(" ")} (${retained ? "retained" : "buffered"})`, async () => {
      const doc = PdfDocument.create(); doc.addPage([72, 72]);
      const input = doc.save(), args = [...flags, "-jpeg", "-singlefile", "in.pdf", "out"];
      let bytes: Uint8Array;
      if (retained) {
        const f = await fixture(input, args);
        assert.equal((await createPdftoppmCommand().execute(f.context)).exitCode, 0);
        bytes = await f.fs.readFile("/out.jpg"); await f.clean();
      } else {
        const files = new Map([["in.pdf", input]]);
        assert.equal((await runPdftoppmCli(args, files)).exitCode, 0);
        bytes = files.get("out.jpg")!;
      }
      assert.equal(new TextDecoder().decode(bytes.subarray(6, 11)), "JFIF\0");
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      assert.equal(bytes[13], 1); // Densities are pixels per inch.
      assert.deepEqual([view.getUint16(14), view.getUint16(16)], expected);
    });
  }
}

for (const rotation of [0, 90]) for (const flags of [[], ["-r", "300"]]) test(`Cairo SVG preserves Letter page point dimensions (rotation=${rotation}, flags=${flags})`, async () => {
  const doc = PdfDocument.create(), page = doc.addPage([612, 792]);
  dictSet(page.pageDict, "Rotate", cosNumber(rotation));
  page.drawRect({ x: 10, y: 20, width: 100, height: 50, fill: { r: 1, g: 0, b: 0 } });
  const input = doc.save(), args = ["-svg", ...flags, "in.pdf", "out.svg"];
  const width = rotation ? 792 : 612, height = rotation ? 612 : 792;
  const header = `width="${width}pt" height="${height}pt" viewBox="0 0 ${width} ${height}"`;
  for (const run of [runPdftocairoCli, runPdftocairoCliSync]) {
    const files = new Map([["in.pdf", input]]);
    assert.equal((await run(args, files)).exitCode, 0);
    assert.ok(new TextDecoder().decode(files.get("out.svg")).includes(header));
  }
  const f = await fixture(input, args); f.context.command = "pdftocairo";
  assert.equal((await createPdftocairoCommand().execute(f.context)).exitCode, 0);
  assert.ok(new TextDecoder().decode(await f.fs.readFile("/out.svg")).includes(header));
  assert.deepEqual(f.counts(), { reads: 0, writes: 0, published: 1 }); await f.clean();
});
