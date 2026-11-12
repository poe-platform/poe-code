import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

const input = Buffer.concat([
  Buffer.from("P6\n7 3\n255\n"),
  Buffer.from("1e506e285a78326482a0968cb4aaa0b9afa5c8beb4".repeat(3), "hex")
]);

// Complete PPM digests from ImageMagick 7.1.2-35 Q16-HDRI, including every pixel.
for (const mode of ["sync", "buffered", "retained", "magick", "montage"] as const)
it.each([
  { angle: 7, width: 9, height: 5, sha256: "3b830d5be9b49c65164d511972159f07791f7c029795009b1281b711ccf147ce" },
  { angle: -7, width: 9, height: 5, sha256: "ff86f767fc9151e75810a55a31be7000fcf523753cd3aef2c4386d488711c45f" },
  { angle: 15, width: 9, height: 7, sha256: "0908b12a36d9fcdf49bed272d32cd9ff55ca68b5f4e83dbf88e26817f4c76d8c" },
  { angle: 45, width: 9, height: 9, sha256: "518fb530005399997ea008e01c76ae435bc9966ba800af08c450ac23c3b9cdca" },
  { angle: 0, width: 7, height: 3, sha256: "c20d9afda814f6be7e9aaa18abb4ef9c4f53066ef74c13d31ce1034b68af3d7e" },
  { angle: 90, width: 3, height: 7, sha256: "06f0f34b424e58ae67450ca47a399ade44c423e1d932db793ac72511a4c4c5c3" }
])(`matches native montage rotation pixels via ${mode}: $angle degrees`, async ({ angle, width, height, sha256 }) => {
  const args = ["in.ppm", "-rotate", String(angle), "-tile", "1x", "-geometry", "+0+0", "-depth", "8", "ppm:-"];
  const fs = new MemoryFileSystem();
  await fs.writeFile("/in.ppm", input);
  let output: Uint8Array;
  if (mode === "magick" || mode === "montage") {
    const command = mode === "magick" ? createMagickCommand() : createMontageCommand();
    const argumentValues = createCommandArguments(mode === "magick" ? ["montage", ...args] : args);
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
    const files = new Map([["in.ppm", input]]);
    const result = mode === "sync" ? runMontageCliSync(args, files)
      : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    output = result.stdoutBytes!;
  }
  const header = Buffer.from(`P6\n${width} ${height}\n255\n`);
  expect(Buffer.from(output.subarray(0, header.length))).toEqual(header);
  expect(output.length).toBe(header.length + width * height * 3);
  expect(createHash("sha256").update(output).digest("hex")).toBe(sha256);
});
