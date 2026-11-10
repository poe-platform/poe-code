import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createIdentifyCommand, runConvertCli, runIdentifyCli, runMagickCli } from "./index.js";

it.each(["fixture", "alpha", "16-bit", "large palette"])("counts unique colors for %s", async (kind) => {
  const pixels = new Uint8Array(300 * 4);
  for (let i = 0; i < 300; i++) pixels.set([i % 256, Math.floor(i / 256), 0, 255], i * 4);
  const bytes = kind === "fixture"
    ? await readFile(new URL("./fixtures/sticker.png", import.meta.url))
    : kind === "16-bit"
      // Native PNG48: #123456789abc and #123556789abc have identical 8-bit previews.
      ? Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABEAIAAAAr0DSeAAAAFUlEQVQI12MUMgmrmLWHgZGBgYEBABS7Am12iOHyAAAAAElFTkSuQmCC", "base64")
      : await sharp(kind === "alpha" ? new Uint8Array([
        255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 255,
        0, 255, 0, 0, 0, 0, 255, 0, 255, 0, 0, 128
      ]) : pixels, { raw: { width: kind === "alpha" ? 6 : 300, height: 1, channels: 4 } }).png().toBuffer();
  const expected = kind === "alpha" ? "5" : kind === "16-bit" ? "2" : kind === "large palette" ? "300" : "3";
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input.png", bytes);
  const format = "%[opaque]|%[colors]|%k|%[COLORS]|%%[colors]|%%k";
  const argumentValues = createCommandArguments(["-format", format, "/input.png"]);
  let stdout = "", stderr = "";
  const result = await createIdentifyCommand().execute({
    command: "identify", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
    signal: new AbortController().signal, stdin: (async function* () {})(),
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
  });
  const opaque = kind === "alpha" ? "False" : "True";
  expect({ ...result, stdout, stderr }).toEqual({ exitCode: 0, stdout: `${opaque}|${expected}|${expected}|${expected}|%[colors]|%k`, stderr: "" });
  const files = new Map([["/input.png", bytes]]);
  expect(await runIdentifyCli(argumentValues.args, files)).toEqual({ exitCode: 0, stdout, stderr: "" });
  expect(await runMagickCli(["/input.png", "-format", "%k|%[colors]", "info:"], files))
    .toEqual({ exitCode: 0, stdout: `${expected}|${expected}`, stderr: "" });
  for (const run of [runIdentifyCli, runConvertCli]) {
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/input.png", bytes);
    const args = run === runIdentifyCli
      ? ["-format", format, "/input.png"]
      : ["/input.png", "-format", format, "info:"];
    expect(await run(args, { filesystem, cwd: "/" })).toEqual({
      exitCode: 0, stdout, stderr: ""
    });
    expect(await filesystem.readdir("/")).toEqual([{ name: "input.png", type: "file" }]);
    expect(await filesystem.readFile("/input.png")).toEqual(new Uint8Array(bytes));
  }
});
