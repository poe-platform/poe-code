import assert from "node:assert/strict";
import { test } from "node:test";
import { Shell, agentCommands, createMemoryFileSystem } from "@poe-platform/safe-bash";
import {
  PdfDocument,
  cosArray,
  cosDict,
  cosName,
  cosNumber,
  cosStream,
  dictSet,
  decodePng,
  cosBool
} from "@poe-code/pdf-ast";
import { SaxesParser } from "saxes";
import { RustWasmBash } from "./index.js";

function document(rotation = 0, cropped = false) {
  const doc = PdfDocument.create();
  doc.addPage([80, 40]).drawText("Unselected", { x: 4, y: 20, size: 9 });
  const page = doc.addPage([200, 200]);
  dictSet(page.pageDict, "MediaBox", cosArray([30, 30, 230, 230].map((n) => cosNumber(n))));
  page.setRotation(rotation);
  if (cropped) {
    dictSet(page.pageDict, "MediaBox", cosArray([30, 30, 250, 280].map((n) => cosNumber(n))));
    dictSet(page.pageDict, "CropBox", cosArray([40, 50, 220, 240].map((n) => cosNumber(n))));
  }
  page.drawText("Images and vectors", { x: 45, y: 210, size: 12 });
  const im = doc.cos.allocateObject(
    cosStream(new Uint8Array([240, 120, 40]), {
      dict: cosDict({
        Type: cosName("XObject"),
        Subtype: cosName("Image"),
        Width: cosNumber(1),
        Height: cosNumber(1),
        BitsPerComponent: cosNumber(8),
        ColorSpace: cosName("DeviceRGB")
      })
    })
  );
  const key = page.ensureXObjectResource(im);
  page.setRawContentStream(
    new TextDecoder().decode(page.getRawContentStream()) +
      `\nq 70 0 0 70 45 120 cm /${key} Do Q\n0.1 0.4 0.8 rg 130 120 70 70 re f\n0.2 0.7 0.3 rg 45 40 155 60 re f\nq 45 40 50 60 re W n 1 0 0 rg 45 40 155 15 re f Q`
  );
  return doc.save();
}
async function output(runtime, input, flags = "") {
  const memory = runtime === "TypeScript" ? createMemoryFileSystem() : undefined;
  const shell = memory
    ? new Shell({ fs: memory }).use(agentCommands())
    : new RustWasmBash({ cwd: "/", forceNative: true });
  const fs = memory ?? shell.fs;
  try {
    await fs.mkdir("/scratch", { recursive: true });
    await fs.writeFile("/in.pdf", input);
    const result = await shell.exec(
      `TMPDIR=/scratch pdftocairo -svg -f 2 -l 2 ${flags} /in.pdf /out.svg`
    );
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    if (runtime === "Rust") assert.equal(shell._companion, null);
    return await fs.readFile("/out.svg");
  } finally {
    await shell.dispose();
  }
}
for (const runtime of ["TypeScript", "Rust"])
  for (const rotation of [0, 90, 180, 270]) {
    test(
      `${runtime} Cairo SVG keeps selected-page vectors, glyphs, images, clips and rotation ${rotation}`,
      { skip: !WebAssembly.Suspending },
      async () => {
        const bytes = document(rotation),
          svg = await output(runtime, bytes);
        const text = new TextDecoder().decode(svg);
        assert.ok(
          (text.match(/<path\b/g) ?? []).length > 10,
          "text must retain vector glyph outlines"
        );
        assert.equal(
          (text.match(/<image\b/g) ?? []).length,
          1,
          "only the original bitmap is raster content"
        );
        assert.match(text, /<clipPath\b/);
        assert.match(text, /width="200pt" height="200pt"/);
        const images = [],
          parser = new SaxesParser();
        parser.on("opentag", (node) => {
          if (node.name === "image") images.push(node.attributes);
        });
        parser.write(text).close();
        const href = images[0].href ?? images[0]["xlink:href"];
        assert.ok(href.startsWith("data:image/png;base64,"));
        const bitmap = decodePng(Buffer.from(href.split(",")[1], "base64"));
        assert.deepEqual([bitmap.width, bitmap.height], [1, 1]);
        assert.deepEqual([...bitmap.data], [240, 120, 40, 255]);
        for (const value of ["rgb(26,102,204)", "rgb(51,179,77)", "rgb(255,0,0)"])
          assert.ok(text.includes(value), value);
      }
    );
  }
for (const runtime of ["TypeScript", "Rust"]) {
  test(
    `${runtime} Cairo SVG reports write failures and preserves existing output on resource limits`,
    { skip: !WebAssembly.Suspending },
    async () => {
      const memory = runtime === "TypeScript" ? createMemoryFileSystem() : undefined;
      const shell = memory
        ? new Shell({ fs: memory }).use(agentCommands())
        : new RustWasmBash({ cwd: "/", forceNative: true });
      const fs = memory ?? shell.fs;
      try {
        await fs.mkdir("/scratch", { recursive: true });
        await fs.writeFile("/in.pdf", document());
        const missing = await shell.exec(
          "TMPDIR=/scratch pdftocairo -svg -f 2 /in.pdf /missing/out.svg"
        );
        assert.notEqual(missing.exitCode, 0);
        assert.notEqual(missing.stderr, "");
        await fs.writeFile("/out.svg", new TextEncoder().encode("keep"));
        await assert.rejects(
          shell.exec("TMPDIR=/scratch pdftocairo -svg -f 2 /in.pdf /out.svg", {
            limits: { maxOutputBytes: 1 }
          }),
          { name: "ShellLimitError" }
        );
        assert.equal(new TextDecoder().decode(await fs.readFile("/out.svg")), "keep");
        if (runtime === "Rust") assert.equal(shell._companion, null);
      } finally {
        await shell.dispose();
      }
    }
  );
}

function special(kind, rotation = 0) {
  const doc = PdfDocument.create();
  doc.addPage([80, 40]);
  const page = doc.addPage([200, 200]);
  page.setRotation(rotation);
  const numbers = (values) => cosArray(values.map((n) => cosNumber(n)));
  const form = (ops, isolated = true) =>
    doc.cos.allocateObject(
      cosStream(new TextEncoder().encode(ops), {
        dict: cosDict({
          Type: cosName("XObject"),
          Subtype: cosName("Form"),
          BBox: numbers([0, 0, 200, 200]),
          Group: cosDict({ S: cosName("Transparency"), I: cosBool(isolated) }),
          Resources: cosDict({ ExtGState: cosDict({ Blend: cosDict({ BM: cosName("Screen") }) }) })
        })
      })
    );
  if (kind.startsWith("mask")) {
    const mask = form("0 1 0 rg 30 30 110 110 re f");
    dictSet(
      page.pageDict,
      "Resources",
      cosDict({
        ExtGState: cosDict({
          Mask: cosDict({
            ca: cosNumber(0.8),
            SMask: cosDict({ S: cosName(kind === "mask-alpha" ? "Alpha" : "Luminosity"), G: mask })
          })
        })
      })
    );
    page.setRawContentStream(
      "1 0 0 rg 0 0 200 200 re f q /Mask gs 0 0 1 rg 10 10 170 170 re f Q 0 1 0 rg 150 150 20 20 re f"
    );
  } else if (kind.startsWith("group")) {
    const ref = form(
      (kind === "group-backdrop" ? "/Blend gs " : "") +
        "0 1 0 rg 30 30 100 100 re f 0 0 1 rg 60 60 100 100 re f",
      kind !== "group-backdrop"
    );
    dictSet(
      page.pageDict,
      "Resources",
      cosDict({
        XObject: cosDict({ Artwork: ref }),
        ExtGState: cosDict({ Fade: cosDict({ ca: cosNumber(0.5) }) })
      })
    );
    page.setRawContentStream("1 0 0 rg 0 0 200 200 re f q /Fade gs /Artwork Do Q");
  } else if (kind.startsWith("gradient")) {
    const shade = cosDict({
      ShadingType: cosNumber(2),
      ColorSpace: cosName("DeviceRGB"),
      Coords: numbers([20, 20, 150, 130]),
      Extend: cosArray([
        cosBool(kind !== "gradient-bounded"),
        cosBool(kind !== "gradient-bounded")
      ]),
      BBox: numbers([15, 15, 180, 180]),
      Function: cosDict({
        FunctionType: cosNumber(2),
        Domain: numbers([0, 1]),
        C0: numbers([1, 0, 0]),
        C1: numbers([0, 0, 1]),
        N: cosNumber(kind === "gradient-power" ? 3 : kind === "gradient-steep" ? 0.01 : 1)
      })
    });
    dictSet(page.pageDict, "Resources", cosDict({ Shading: cosDict({ Color: shade }) }));
    page.setRawContentStream("q 0.9 0.1 -0.1 0.8 20 10 cm /Color sh Q");
  } else if (kind === "curves") {
    page.setRawContentStream(
      "q 20 20 160 160 re 50 50 100 100 re W* n 0.2 0.5 0.8 rg 10 10 m 30 160 160 190 190 10 c h f Q 1 0 0 RG 5 w [0 12] 3 d 1 J 20 20 m 180 160 l S"
    );
  } else if (kind === "text-clip") {
    page.drawText("PDF", { x: 25, y: 65, size: 60 });
    const ops = new TextDecoder().decode(page.getRawContentStream());
    page.setRawContentStream(
      ops
        .replace(/^q\s*/, "")
        .replace(/\sQ\s*$/, "")
        .replace("BT", "BT 7 Tr") + "\n0 0 1 rg 0 0 200 200 re f"
    );
  }
  return doc.save();
}
for (const runtime of ["TypeScript", "Rust"])
  for (const kind of [
    "mask-alpha",
    "mask-luminosity",
    "group-isolated",
    "group-backdrop",
    "gradient-linear",
    "gradient-power",
    "gradient-steep",
    "gradient-bounded",
    "curves",
    "text-clip"
  ]) {
    test(
      `${runtime} Cairo SVG preserves ${kind} as a complete XML document`,
      { skip: !WebAssembly.Suspending },
      async () => {
        const svg = new TextDecoder().decode(await output(runtime, special(kind)));
        let nodes = 0;
        const parser = new SaxesParser();
        parser.on("opentag", () => nodes++);
        parser.write(svg).close();
        assert.ok(nodes >= 2);
        assert.ok(
          kind.startsWith("gradient")
            ? svg.includes("<image") || svg.includes("<linearGradient")
            : svg.includes(
                kind.startsWith("mask") ? "<mask" : kind === "group-backdrop" ? "<image" : "<path"
              )
        );
      }
    );
  }
for (const runtime of ["TypeScript", "Rust"])
  for (const rotation of [0, 90, 180, 270]) {
    test(
      `${runtime} Cairo SVG preserves page geometry rotation ${rotation}`,
      { skip: !WebAssembly.Suspending },
      async () => {
        for (const cropped of [false, true])
          for (const option of [
            "-r 72",
            "-rx 144 -ry 72",
            "-r 72 -x 10 -y 15 -W 80 -H 65",
            "-scale-to-x 240 -scale-to-y 120 -x 10 -y 15 -W 80 -H 65"
          ]) {
            const flags = `${cropped ? "-cropbox " : ""}${option}`;
            const source = document(rotation, cropped);
            const actual = new TextDecoder().decode(await output(runtime, source, flags));
            const expected =
              runtime === "TypeScript"
                ? actual
                : new TextDecoder().decode(await output("TypeScript", source, flags));
            const dimensions = (text) => {
              const values = {};
              const parser = new SaxesParser();
              parser.on("opentag", (node) => {
                if (node.name === "svg") Object.assign(values, node.attributes);
              });
              parser.write(text).close();
              return [
                parseFloat(values.width),
                parseFloat(values.height),
                ...values.viewBox.split(/\s+/).map(Number)
              ];
            };
            const a = dimensions(actual),
              b = dimensions(expected);
            for (let i = 0; i < a.length; i++)
              assert.ok(Math.abs(a[i] - b[i]) < 1e-5, `${flags}: ${a} vs ${b}`);
            const quarter = rotation === 90 || rotation === 270;
            const pageWidth = cropped ? (quarter ? 190 : 180) : 200;
            const pageHeight = cropped ? (quarter ? 180 : 190) : 200;
            const physical = option.startsWith("-scale")
              ? [pageWidth / 3, (pageHeight * 65) / 120]
              : option.includes("-W")
                ? [80, 65]
                : [pageWidth, pageHeight];
            for (let i = 0; i < 2; i++)
              assert.ok(Math.abs(a[i] - physical[i]) < 1e-5, `${flags}: ${a} vs ${physical}`);
          }
      }
    );
  }

for (const runtime of ["TypeScript", "Rust"]) {
  test(
    `${runtime} Cairo SVG obeys file names, page filters and streams`,
    { skip: !WebAssembly.Suspending },
    async () => {
      const memory = runtime === "TypeScript" ? createMemoryFileSystem() : undefined;
      const shell = memory
        ? new Shell({ fs: memory }).use(agentCommands())
        : new RustWasmBash({ cwd: "/", forceNative: true });
      const fs = memory ?? shell.fs;
      try {
        await fs.mkdir("/scratch", { recursive: true });
        await fs.writeFile("/in.pdf", document());
        for (const [command, path, width] of [
          ["pdftocairo -svg /in.pdf", "/in.svg", 80],
          ["pdftocairo -svg -f 2 /in.pdf /custom", "/custom.svg", 200],
          ["pdftocairo -svg -f 2 /in.pdf /UPPER.SVG", "/UPPER.svg", 200],
          ["pdftocairo -svg -e /in.pdf /even", "/even.svg", 200],
          ["pdftocairo -svg -f 2 /in.pdf -", null, 200],
          ["cat /in.pdf | pdftocairo -svg -f 2 -", null, 200]
        ]) {
          const result = await shell.exec(`export TMPDIR=/scratch; ${command}`);
          assert.equal(result.exitCode, 0, result.stderr);
          const text = path ? new TextDecoder().decode(await fs.readFile(path)) : result.stdout;
          assert.match(text, new RegExp(`width="${width}pt"`));
          const parser = new SaxesParser();
          parser.write(text).close();
          if (path) assert.equal(result.stdout, "");
        }
        await fs.writeFile("/out.svg", new TextEncoder().encode("keep"));
        const empty = await shell.exec("TMPDIR=/scratch pdftocairo -svg -f 2 -o /in.pdf /out");
        assert.equal(empty.exitCode, 0);
        assert.equal(empty.stdout, "");
        assert.equal(new TextDecoder().decode(await fs.readFile("/out.svg")), "keep");
        const invalid = await shell.exec("TMPDIR=/scratch pdftocairo -svg -f 3 /in.pdf /out");
        assert.equal(invalid.exitCode, 99);
        assert.equal(new TextDecoder().decode(await fs.readFile("/out.svg")), "keep");
        if (runtime === "Rust") assert.equal(shell._companion, null);
      } finally {
        await shell.dispose();
      }
    }
  );
}

for (const runtime of ["TypeScript", "Rust"])
  test(
    `${runtime} Cairo SVG composite retains rotated scale and crop geometry`,
    { skip: !WebAssembly.Suspending },
    async () => {
      for (const rotation of [0, 90, 180, 270])
        for (const flags of [
          "-rx 144 -ry 72",
          "-scale-to-x 240 -scale-to-y 120",
          "-scale-to-x 240 -scale-to-y 120 -x 10 -y 15 -W 80 -H 65"
        ]) {
          const input = special("group-backdrop", rotation);
          const actual = new TextDecoder().decode(await output(runtime, input, flags));
          const expected =
            runtime === "TypeScript"
              ? actual
              : new TextDecoder().decode(await output("TypeScript", input, flags));
          const dims = (svg) => {
            let attrs;
            const parser = new SaxesParser();
            parser.on("opentag", (node) => {
              if (node.name === "svg") attrs = node.attributes;
            });
            parser.write(svg).close();
            return attrs;
          };
          const da = dims(actual),
            db = dims(expected);
          for (const key of ["width", "height"])
            assert.ok(Math.abs(parseFloat(da[key]) - parseFloat(db[key])) < 1e-5);
          // Different floating-point DPI round trips can add one backing pixel.
          const va = da.viewBox.split(" ").map(Number),
            vb = db.viewBox.split(" ").map(Number);
          for (let i = 0; i < 4; i++)
            assert.ok(Math.abs(va[i] - vb[i]) <= 1, `${rotation}: ${flags}: ${va} vs ${vb}`);
          const png = (svg) =>
            decodePng(Buffer.from(svg.split("base64,")[1].split('"')[0], "base64"));
          const a = png(actual),
            b = png(expected);
          assert.ok(Math.abs(a.width - b.width) <= 1 && Math.abs(a.height - b.height) <= 1);
          // Interior samples are insensitive to the runtimes' different edge antialiasing.
          for (const [u, v] of [
            [0.1, 0.1],
            [0.4, 0.4],
            [0.5, 0.5],
            [0.9, 0.9]
          ]) {
            const i = (Math.floor(v * a.height) * a.width + Math.floor(u * a.width)) * 4;
            const j = (Math.floor(v * b.height) * b.width + Math.floor(u * b.width)) * 4;
            if (!flags.includes("-W")) {
              const [x, y] =
                rotation === 90
                  ? [v * 200, u * 200]
                  : rotation === 180
                    ? [(1 - u) * 200, v * 200]
                    : rotation === 270
                      ? [(1 - v) * 200, (1 - u) * 200]
                      : [u * 200, (1 - v) * 200];
              const green = x > 30 && x < 130 && y > 30 && y < 130;
              const blue = x > 60 && x < 160 && y > 60 && y < 160;
              const reference = [255, green ? 128 : 0, blue ? 128 : 0, 255];
              for (let c = 0; c < 4; c++)
                assert.ok(
                  Math.abs(a.data[i + c] - reference[c]) <= 2,
                  `${rotation}: ${flags}: independent composite ${x},${y}`
                );
            }
            for (let c = 0; c < 4; c++)
              assert.ok(
                Math.abs(a.data[i + c] - b.data[j + c]) <= 2,
                `${rotation}: ${flags}: ${u},${v}: ${a.data.slice(i, i + 4)} vs ${b.data.slice(j, j + 4)}`
              );
          }
        }
    }
  );

test(
  "Rust SVG retains the sharp end of a nonlinear axial gradient",
  { skip: !WebAssembly.Suspending },
  async () => {
    const svg = new TextDecoder().decode(await output("Rust", special("gradient-steep")));
    const stops = [],
      parser = new SaxesParser();
    parser.on("opentag", (node) => {
      if (node.name === "stop")
        stops.push([
          Number(node.attributes.offset),
          ...node.attributes["stop-color"].slice(4, -1).split(",").map(Number)
        ]);
    });
    parser.write(svg).close();
    for (const t of [0.0001, 0.001, 0.01, 0.1, 0.5, 0.999]) {
      const end = stops.findIndex((stop) => stop[0] >= t),
        a = stops[end - 1],
        b = stops[end];
      const u = (t - a[0]) / (b[0] - a[0]),
        expected = [255 * (1 - t ** 0.01), 0, 255 * t ** 0.01];
      for (let i = 0; i < 3; i++)
        assert.ok(
          Math.abs(a[i + 1] + (b[i + 1] - a[i + 1]) * u - expected[i]) <= 2,
          `${t}: gradient channel ${i}`
        );
    }
  }
);
