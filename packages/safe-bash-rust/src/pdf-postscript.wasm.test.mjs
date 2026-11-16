import assert from "node:assert/strict";
import test from "node:test";
import {PdfDocument, cosArray, cosDict, cosName, cosNumber, cosStream, dictSet} from "@poe-code/pdf-ast";
import {Shell, agentCommands, createMemoryFileSystem} from "@poe-platform/safe-bash";
import {RustWasmBash} from "./index.js";

function input() {
  const doc = PdfDocument.create();
  for (const color of ["0.1 0.4 0.8", "0 1 0", "0 0 1"]) {
    const page = doc.addPage([24, 16]);
    page.setRawContentStream(`${color} rg 0 0 24 16 re f`);
  }
  const page = doc.getPage(1);
  const image = doc.cos.allocateObject(cosStream(Uint8Array.of(240, 120, 40), {dict: cosDict({Type: cosName("XObject"), Subtype: cosName("Image"), Width: cosNumber(1), Height: cosNumber(1), BitsPerComponent: cosNumber(8), ColorSpace: cosName("DeviceRGB")})}));
  const name = page.ensureXObjectResource(image);
  page.setRawContentStream(`0 1 0 rg 0 0 24 16 re f q 8 0 0 8 4 4 cm /${name} Do Q`);
  dictSet(doc.getPage(2).pageDict, "Rotate", cosNumber(90));
  dictSet(doc.getPage(2).pageDict, "MediaBox", cosArray([0, 0, 24, 16].map(n => cosNumber(n))));
  return doc.save();
}
function pages(text) {
  return [...text.matchAll(/%%Page: (\d+) \d+\n(?:<< \/PageSize \[([^\]]+)\] >> setpagedevice\n)?gsave\n([^\n]+) scale\n(\d+) (\d+) 8 \[[^\]]+\]\n\{currentfile 3 string readhexstring pop\} false 3 colorimage\n([0-9a-f]+)\ngrestore\nshowpage/g)]
    .map(match => ({ordinal: Number(match[1]), pageSize: match[2], scale: match[3], width: Number(match[4]), height: Number(match[5]), pixels: Buffer.from(match[6], "hex")}));
}
for (const runtime of ["TypeScript", "Rust"]) {
  for (const format of ["ps", "eps"]) test(`${runtime} Cairo ${format} paints selected images and rotated pages`, {skip: !WebAssembly.Suspending}, async () => {
    const memory = runtime === "TypeScript" ? createMemoryFileSystem() : undefined;
    const shell = memory ? new Shell({fs: memory}).use(agentCommands()) : new RustWasmBash({cwd: "/", forceNative: true});
    const fs = memory ?? shell.fs;
    try {
      await fs.mkdir("/scratch", {recursive: true}); await fs.writeFile("/in.pdf", input());
      for (const [flags, selected] of [["", [1, 2, 3]], ["-f 2 -l 3", [2, 3]], ["-f 3 -l 3", [3]], ["-o", [1, 3]], ["-e", [2]], ["-o -e", []]]) {
        const result = await shell.exec(`TMPDIR=/scratch pdftocairo -${format} -r 72 ${flags} /in.pdf /out.${format}`);
        assert.equal(result.exitCode, 0, result.stderr);
        const text = new TextDecoder().decode(await fs.readFile(`/out.${format}`));
        assert.ok(text.startsWith(format === "eps" ? "%!PS-Adobe-3.0 EPSF-3.0\n" : "%!PS-Adobe-3.0\n"));
        assert.match(text, new RegExp(`%%Pages: ${selected.length}\\n`));
        assert.ok(text.includes(`%%BoundingBox: 0 0 ${selected[0] === 3 ? "16 24" : "24 16"}\n`));
        assert.ok(text.endsWith("%%Trailer\n%%EOF\n"));
        const rendered = pages(text); assert.equal(rendered.length, selected.length);
        for (const [i, page] of rendered.entries()) {
          assert.equal(page.ordinal, i + 1);
          const rotated = selected[i] === 3;
          assert.deepEqual([page.width, page.height], rotated ? [16, 24] : [24, 16]);
          assert.equal(page.scale, rotated ? "16 24" : "24 16");
          assert.equal(page.pageSize, format === "eps" ? undefined : page.scale);
          assert.equal(page.pixels.length, page.width * page.height * 3);
          assert.deepEqual([...page.pixels.subarray(0, 3)], [[26, 102, 204], [0, 255, 0], [0, 0, 255]][selected[i] - 1]);
          if (selected[i] === 2) assert.deepEqual([...page.pixels.subarray((8 * 24 + 8) * 3, (8 * 24 + 8) * 3 + 3)], [240, 120, 40]);
        }
        const stdout = await shell.exec(`TMPDIR=/scratch pdftocairo -${format} -r 72 ${flags} /in.pdf -`);
        assert.equal(stdout.exitCode, 0, stdout.stderr); assert.equal(stdout.stdout, text);
      }
      const stdin = await shell.exec(`cat /in.pdf | TMPDIR=/scratch pdftocairo -${format} -r 72 - -`);
      assert.equal(stdin.exitCode, 0, stdin.stderr); assert.equal(pages(stdin.stdout).length, 3);
      const crop = await shell.exec(`TMPDIR=/scratch pdftocairo -${format} -rx 144 -ry 72 -f 2 -l 2 -x 8 -y 4 -W 8 -H 8 /in.pdf /crop.${format}`);
      assert.equal(crop.exitCode, 0, crop.stderr);
      const [page] = pages(new TextDecoder().decode(await fs.readFile(`/crop.${format}`)));
      assert.deepEqual([page.width, page.height, page.scale], [8, 8, "4 8"]);
      assert.ok(page.pixels.every((value, i) => value === [240, 120, 40][i % 3]));
      if (runtime === "Rust") assert.equal(shell._companion, null);
    } finally {await shell.dispose();}
  });
  for (const format of ["ps", "eps"]) test(`${runtime} Cairo ${format} preserves output on failures and derives file names`, {skip: !WebAssembly.Suspending}, async () => {
    const memory = runtime === "TypeScript" ? createMemoryFileSystem() : undefined;
    const shell = memory ? new Shell({fs: memory}).use(agentCommands()) : new RustWasmBash({cwd: "/", forceNative: true});
    const fs = memory ?? shell.fs;
    const kept = new TextEncoder().encode("existing output");
    try {
      await fs.mkdir("/scratch", {recursive: true}); await fs.writeFile("/in.pdf", input());
      const derived = await shell.exec(`TMPDIR=/scratch pdftocairo -${format} -r 72 /in.pdf`);
      assert.equal(derived.exitCode, 0, derived.stderr);
      assert.equal(pages(new TextDecoder().decode(await fs.readFile(`/in.${format}`))).length, 3);
      await fs.writeFile(`/out.${format}`, kept);
      await fs.writeFile("/bad.pdf", new TextEncoder().encode("not a PDF"));
      const malformed = await shell.exec(`TMPDIR=/scratch pdftocairo -${format} /bad.pdf /out.${format}`);
      assert.notEqual(malformed.exitCode, 0); assert.deepEqual(await fs.readFile(`/out.${format}`), kept);
      const invalid = await shell.exec(`TMPDIR=/scratch pdftocairo -${format} -f 4 /in.pdf /out.${format}`);
      assert.notEqual(invalid.exitCode, 0); assert.deepEqual(await fs.readFile(`/out.${format}`), kept);
      const missing = await shell.exec(`TMPDIR=/scratch pdftocairo -${format} -r 72 /in.pdf /missing/out.${format}`);
      assert.equal(missing.exitCode, 2); assert.match(missing.stderr, /Error opening output file/);
      await assert.rejects(shell.exec(`TMPDIR=/scratch pdftocairo -${format} -r 72 /in.pdf /out.${format}`, {limits: {maxOutputBytes: 1}}), {name: "ShellLimitError", limit: "maxOutputBytes"});
      assert.deepEqual(await fs.readFile(`/out.${format}`), kept);
      try {
        const limited = await shell.exec(`TMPDIR=/scratch pdftocairo -${format} -r 72 /in.pdf /out.${format}`, {limits: {maxOutputBytes: 5000}});
        assert.notEqual(limited.exitCode, 0);
      } catch (error) {
        assert.equal(error.name, "ShellLimitError");
        assert.equal(error.limit, "maxOutputBytes");
      }
      assert.deepEqual(await fs.readFile(`/out.${format}`), kept);
      const extension = await shell.exec(`TMPDIR=/scratch pdftocairo -${format} -r 72 -f 2 -l 2 /in.pdf /chosen`);
      assert.equal(extension.exitCode, 0, extension.stderr);
      assert.equal(pages(new TextDecoder().decode(await fs.readFile(`/chosen.${format}`))).length, 1);
      if (runtime === "Rust") assert.equal(shell._companion, null);
    } finally {await shell.dispose();}
  });
}
