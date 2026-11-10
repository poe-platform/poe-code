import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createIdentifyCommand, runConvertCli, runIdentifyCli } from "./index.js";

const sharp = createRequire(import.meta.url)("sharp") as typeof import("sharp");
const pixels = Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 0, 0, 0, 255, 0, 0, 0, 255]);

describe.each([false, true])("identify interlace, ping=%s", ping => {
  it.each([
    ["jpeg", true, "JPEG"],
    ["jpeg", false, "None"],
    ["png", true, "PNG"],
    ["png", false, "None"],
    ["ppm", false, "None"]
  ] as const)("reports %s progressive=%s from input metadata", async (format, progressive, interlace) => {
    const input = sharp(pixels, { raw: { width: 3, height: 2, channels: 3 } });
    const bytes = format === "ppm"
      ? Buffer.concat([Buffer.from("P6\n3 2\n255\n"), pixels])
      : await input[format]({ progressive }).toBuffer();
    const path = `/input.${format}`;
    const fs = new MemoryFileSystem();
    await fs.writeFile(path, bytes);
    const template = "%[interlace]|%[INTERLACE]";
    const argumentValues = createCommandArguments([...(ping ? ["-ping"] : []), "-format", template, path]);
    let stdout = "", stderr = "";
    const result = await createIdentifyCommand().execute({
      command: "identify", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    });
    const expected = { exitCode: 0, stdout: `${interlace}|${interlace}`, stderr: "" };
    expect({ ...result, stdout, stderr }).toEqual(expected);
    expect(await runIdentifyCli(argumentValues.args, new Map([[path, bytes]]))).toEqual(expected);
    if (!ping) {
      for (const files of [new Map([[path, bytes]]), { filesystem: fs, cwd: "/" }]) {
        expect(await runConvertCli([path, "-format", template, "info:"], files)).toEqual(expected);
      }
    }
  });
});
