import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: RGB24 hashes after decoding the PPM sheet.
for (const mode of ["sync", "buffered", "retained", "magick", "montage"] as const) {
  it.each([
    { options: [], width: 24, height: 8, hash: "08121d7b99af6a029b4f4494a9681842e613b413f248bd5fd5281880ced8ac93" },
    { options: ["-polaroid", "0"], width: 80, height: 36, hash: "da81a80c77ce7edb7ec696a58898cdb3b51f832d9a28035ede1671a8d31f4ab4" },
    { options: ["-polaroid", "15"], width: 100, height: 46, hash: "f70cd171dfb74bfbe2d81e7a545190b1413208ee363e829c2ba5b829b01321bd" },
    { options: ["-polaroid", "90"], width: 72, height: 40, hash: "50176d4c26cffb91a18b01bbc9e4701e3e204450e4ea08fedc78b0336909c9b5" },
    { options: ["-bordercolor", "lime", "-polaroid", "0"], width: 80, height: 36, hash: "f91846e154b63e59e598a1c686d86de5dfca197d21eb18b27a601517dc68826f" }
  ])(`${mode}: decorates each montage tile before layout: $options`, async ({ options, width, height, hash }) => {
    const argv = ["-size", "12x8", "xc:red", "xc:blue", ...options, "-tile", "2x1", "-geometry", "+0+0", "-depth", "8", "ppm:-"];
    const fs = new MemoryFileSystem();
    let output: Uint8Array;
    if (mode === "magick" || mode === "montage") {
      const command = mode === "magick" ? createMagickCommand() : createMontageCommand();
      const argumentValues = createCommandArguments(mode === "magick" ? ["montage", ...argv] : argv);
      const stdout: Uint8Array[] = [];
      let stderr = "";
      const result = await command.execute({
        command: command.name, args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(chunk) { stdout.push(chunk); } },
        stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
      });
      expect({ exitCode: result.exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
      output = Buffer.concat(stdout);
    } else {
      const files = new Map<string, Uint8Array>();
      const result = mode === "sync" ? runMontageCliSync(argv, files)
        : await runMontageCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
      expect(result).toMatchObject({ exitCode: 0, stderr: "" });
      output = result.stdoutBytes!;
    }
    const header = Buffer.from(`P6\n${width} ${height}\n255\n`);
    expect(Buffer.from(output.subarray(0, header.length))).toEqual(header);
    expect(output.byteLength).toBe(header.length + width * height * 3);
    expect(createHash("sha256").update(output.subarray(header.length)).digest("hex")).toBe(hash);
  });
}

for (const mode of ["sync", "buffered", "retained"] as const) {
  it.each([[], [""], ["NaN"], ["Infinity"], ["15oops"]])(`${mode}: rejects invalid polaroid angle %j without overwriting output`, async (...angle) => {
    const argv = ["-size", "12x8", "xc:red", "-polaroid", ...angle, ...(angle.length ? ["ppm:out"] : [])];
    const files = new Map([["out", Buffer.from("KEEP")]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/out", files.get("out")!);
    const result = mode === "sync" ? runMontageCliSync(argv, files)
      : await runMontageCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("-polaroid");
    expect(new TextDecoder().decode(mode === "retained" ? await fs.readFile("/out") : files.get("out"))).toBe("KEEP");
  });

  it(`${mode}: limits polaroid to its input group and captures border color before later settings`, async () => {
    const argv = ["-size", "12x8", "(", "xc:red", "-bordercolor", "lime", "-polaroid", "0", ")", "xc:blue",
      "-bordercolor", "yellow", "-tile", "2x1", "-geometry", "+0+0", "-depth", "8", "ppm:-"];
    const result = mode === "sync" ? runMontageCliSync(argv, new Map())
      : await runMontageCli(argv, mode === "buffered" ? new Map() : { filesystem: new MemoryFileSystem(), cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    const header = Buffer.from("P6\n52 36\n255\n");
    const output = Buffer.from(result.stdoutBytes!);
    expect(output.subarray(0, header.length)).toEqual(header);
    const pixels = output.subarray(header.length);
    let lime = 0, blue = 0;
    for (let y = 0; y < 36; y++) for (let x = 0; x < 52; x++) {
      const pixel = pixels.subarray((y * 52 + x) * 3, (y * 52 + x) * 3 + 3).toString("hex");
      if (x < 40) lime += Number(pixel === "00ff00");
      else {
        expect(pixel).toBe(y >= 14 && y < 22 ? "0000ff" : "ffffff");
        blue += Number(pixel === "0000ff");
      }
    }
    expect(lime).toBe(764);
    expect(blue).toBe(96);
  });
}
