import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { expect, it } from "vitest";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

for (const mode of ["magick", "montage", "retained", "buffered", "sync"] as const)
for (const coder of ["gif", "gif87"])
it.each([
  { inputs: ["xc:red"], tile: "1x1", pages: 1 },
  { inputs: ["xc:red", "xc:blue"], tile: "2x1", pages: 1 },
  { inputs: ["xc:red", "xc:blue"], tile: "1x1", pages: 2 }
].filter(test => coder === "gif" || test.pages === 1))(`writes default GIF control metadata via ${mode} with ${coder}: $inputs $tile`, async ({ inputs, tile, pages }) => {
  const fs = new MemoryFileSystem();
  const args = [...inputs, "-tile", tile, "-geometry", "+0+0", `${coder}:-`];
  let bytes: Uint8Array;
  if (mode === "magick" || mode === "montage") {
    const chunks: Uint8Array[] = [];
    let stderr = "";
    const result = await (mode === "magick" ? createMagickCommand() : createMontageCommand()).execute({
      command: mode, args: mode === "magick" ? ["montage", ...args] : args,
      cwd: "/", env: {}, fs, signal: new AbortController().signal,
      stdin: (async function* () {})(),
      stdout: { async write(chunk) { chunks.push(chunk.slice()); } },
      stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
    });
    expect({ exitCode: result.exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
    bytes = Buffer.concat(chunks);
  } else {
    const files = new Map<string, Uint8Array>();
    const result = mode === "sync" ? runMontageCliSync(args, files)
      : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    bytes = result.stdoutBytes!;
  }
  const buffer = Buffer.from(bytes);
  expect(buffer.subarray(0, 6).toString()).toBe(coder === "gif" ? "GIF89a" : "GIF87a");
  // Check the extension itself: a reader's default delay can conceal its absence.
  let control = buffer.indexOf(Buffer.from([33, 249, 4]));
  if (coder === "gif87") expect(control).toBe(-1);
  else {
    for (let page = 0; page < pages; page++) {
      expect(control).toBeGreaterThanOrEqual(0);
      expect([...buffer.subarray(control, control + 6)]).toEqual([33, 249, 4, 0, 0, 0]);
      control = buffer.indexOf(Buffer.from([33, 249, 4]), control + 8);
    }
    expect(control).toBe(-1);
  }
  const image = decodeImage(bytes, { animated: true });
  expect(buffer.includes(Buffer.from("NETSCAPE2.0"))).toBe(coder === "gif" && pages > 1);
  if (coder === "gif" && pages > 1) expect(image.loop).toBe(0);
  if (coder === "gif") expect(image.delay).toEqual(Array(pages).fill(0));
  expect(image.width).toBe(tile === "2x1" ? 2 : 1);
  expect([...image.data]).toEqual([255, 0, 0, 255, 0, 0, 255, 255].slice(0, inputs.length * 4));
});
