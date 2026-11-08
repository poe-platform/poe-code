import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";
import { createIdentifyCommand, runIdentifyCli } from "./index.js";

it.each([
  [1, "TopLeft"], [2, "TopRight"], [3, "BottomRight"], [4, "BottomLeft"],
  [5, "LeftTop"], [6, "RightTop"], [7, "RightBottom"], [8, "LeftBottom"],
  [undefined, "Undefined"]
] as const)("formats orientation %s through the public identify command", async (orientation, name) => {
  const image = sharp({ create: { width: 1, height: 1, channels: 3, background: "red" } });
  const bytes = await (orientation === undefined ? image.png() : image.withMetadata({ orientation }).jpeg()).toBuffer();
  const format = "%[orientation]|%[exif:Orientation]";
  const expected = `${name}|${orientation ?? ""}`;
  const native = spawnSync("magick", ["identify", "-format", format, "-"], { input: bytes, encoding: "utf8" });
  expect(native.status, native.stderr).toBe(0);
  expect(native.stdout).toBe(expected);
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input", bytes);
  let stdout = "", stderr = "";
  const result = await createIdentifyCommand().execute({
    command: "identify", args: createCommandArguments(["-format", format, "/input"]).args,
    cwd: "/", env: {}, fs, stdin: (async function* () {})(), signal: new AbortController().signal,
    stdout: { write: async bytes => { stdout += new TextDecoder().decode(bytes); } },
    stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } }
  });
  expect(result).toMatchObject({ exitCode: 0 });
  expect(stderr).toBe("");
  expect(stdout).toBe(expected);
  expect(await runIdentifyCli(["-format", format, "/input"], new Map([["/input", bytes]])))
    .toEqual({ exitCode: 0, stdout: expected, stderr: "" });
});
