import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
  it.each([
    { output: "/palette.map", path: "/palette.map", depth: "8", write: false },
    { output: "MAP:/explicit.bin", path: "/explicit.bin", depth: "8", write: false },
    { output: "map:/explicit.bin", path: "/explicit.bin", depth: "16", write: false },
    { output: "MAP:/written.bin", path: "/written.bin", depth: "8", write: true },
  ])(`writes native MAP palette and index bytes (${mode}, $output, depth $depth, write $write)`, async ({ output, path, depth, write }) => {
    const input = new TextEncoder().encode("P3\n3 1\n255\n255 0 0 0 0 255 255 0 0\n");
    const files = new Map([["/in.ppm", input]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.ppm", input);
    const args = ["/in.ppm", "-depth", depth, ...(write ? ["-write", output, "-depth", "8", "rgb:/control.bin"] : [output])];
    if (mode === "command") {
      const argumentValues = createCommandArguments(args);
      let stderr = "";
      const result = await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
      });
      expect(result.exitCode).toBe(0);
      expect(stderr).toBe("");
    } else {
      expect(mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files)).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    }
    const read = (name: string) => mode === "retained" || mode === "command" ? filesystem.readFile(name) : files.get(name);
    expect(await read(path)).toEqual(Uint8Array.from([255, 0, 0, 0, 0, 255, 0, 1, 0]));
    if (write) expect(await read("/control.bin")).toEqual(Uint8Array.from([255, 0, 0, 0, 0, 255, 255, 0, 0]));
  });
}

for (const mode of ["sync", "buffered", "retained"] as const) {
  it.each([
    { name: "native color-tree order", input: new TextEncoder().encode("P3\n3 1\n255\n0 0 255 255 0 0 0 0 255\n"), expected: "ff00000000ff010001" },
    // Native PNG8 uses blue first here, unlike the quantizer's red-first palette.
    { name: "existing palette order", input: Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAMAAAABCAMAAAAsPuSGAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGUExURQAA//8AAMX6i9MAAAAMSURBVAjXY2BgZAAAAAYAAkn2hs0AAAAASUVORK5CYII=", "base64")), expected: "0000ffff0000000100" },
    { name: "grayscale palette", input: new TextEncoder().encode("P3\n3 1\n255\n255 255 255 128 128 128 0 0 0\n"), expected: "000000808080ffffff020100" },
    { name: "omitted alpha", input: new Uint8Array([...new TextEncoder().encode("P7\nWIDTH 3\nHEIGHT 1\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n"), 0, 0, 0, 0, 255, 0, 0, 255, 0, 0, 255, 255]), expected: "000000ff00000000ff000102" },
  ])(`preserves $name in MAP (${mode})`, async ({ input, expected }) => {
    const files = new Map([["/input", input]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/input", input);
    const args = ["/input", "-depth", "8", "/out.map"];
    expect(mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files)).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    const output = mode === "retained" ? await filesystem.readFile("/out.map") : files.get("/out.map")!;
    expect(Buffer.from(output).toString("hex")).toBe(expected);
  });

  it(`writes MAP indices across storage chunks (${mode})`, async () => {
    const width = 2051, header = new TextEncoder().encode(`P6\n${width} 1\n255\n`), input = new Uint8Array(header.length + width * 3);
    input.set(header);
    for (let i = 0; i < width; i++) input[header.length + i * 3 + (i % 2 ? 2 : 0)] = 255;
    const files = new Map([["/input.ppm", input]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/input.ppm", input);
    const args = ["/input.ppm", "/out.map"];
    expect(mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files)).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    const output = mode === "retained" ? await filesystem.readFile("/out.map") : files.get("/out.map")!;
    expect(output.subarray(0, 6)).toEqual(Uint8Array.from([255, 0, 0, 0, 0, 255]));
    expect(output.subarray(6)).toEqual(Uint8Array.from({ length: width }, (_, i) => i % 2));
  });
}
