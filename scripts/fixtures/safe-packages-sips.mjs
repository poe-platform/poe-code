import assert from "node:assert/strict";
import { Shell } from "@poe-platform/safe-bash/core";
import { sipsCommands, createIdentifyCommand } from "@poe-platform/safe-bash/commands/sips";
import { pandocCommands } from "@poe-platform/safe-bash/commands/pandoc";
import { shufCommands } from "@poe-platform/safe-bash/commands/shuf";
import sharp from "@poe-platform/safe-bash/sharp";
import { readHeifMetadataFromSource } from "@poe-platform/safe-bash/image-ast";
import { createMemoryFileSystem } from "@poe-platform/safe-fs";

export const verification = (async () => {
  const heif = await sharp({create: {width: 3, height: 2, channels: 4, background: "blue"}}).heif().toBuffer();
  class BorrowedBytes extends Uint8Array {slice(start, end) {return this.subarray(start, end);}}
  const loan = new BorrowedBytes(4096);
  const metadata = await readHeifMetadataFromSource({size: heif.length, async read(position, length) {loan.fill(0);loan.set(heif.subarray(position, position + length));return loan.subarray(0, length);}}, new AbortController().signal);
  assert.equal(metadata.width, 3);
  assert.equal(metadata.height, 2);
  const fs = createMemoryFileSystem();
  await fs.writeFile("/in.png", await sharp({create: {width: 13, height: 7, channels: 4, background: "blue"}}).png().toBuffer());
  await fs.writeFile("/input.md", new TextEncoder().encode("alpha\n\nbeta\n"));
  await fs.writeFile("/random", new Uint8Array(128));
  const filesystem = new Proxy(fs, {get(target, key) {
    if (key === "readFile" || key === "writeFile") return () => {throw new Error("whole-file I/O forbidden");};
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  }});
  const shell = new Shell({fs: filesystem}).use(sipsCommands()).use(pandocCommands()).use(shufCommands()).use({name: "retained-identify", setup(host) {host.commands.register(createIdentifyCommand());}});
  try {
    const result = await shell.exec("sips -r 90 -s format jpeg /in.png --out /out.jpg && identify -format '%m %wx%h' /out.jpg");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.ok(result.stdout.endsWith("JPEG 7x13"));
    assert.equal((await sharp(await fs.readFile("/out.jpg")).metadata()).width, 7);
    const pdf = await shell.exec("sips -s format pdf /out.jpg --out /out.pdf");
    assert.equal(pdf.exitCode, 0, pdf.stderr);
    assert.equal((await sharp(await fs.readFile("/out.pdf")).metadata()).width, 7);
    const composed = await shell.exec("pandoc -f markdown -t plain /input.md | shuf --random-source=/random");
    assert.equal(composed.exitCode, 0, composed.stderr);
    assert.deepEqual(composed.stdout.split("\n").filter(Boolean).sort(), ["alpha", "beta"]);
    const inspected = await shell.exec("sips -g pixelWidth /out.jpg | shuf --random-source=/random");
    assert.equal(inspected.exitCode, 0, inspected.stderr);
    assert.ok(inspected.stdout.includes("pixelWidth: 7"));
  } finally {await shell.dispose();}
})();
