import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createIdentifyCommand } from "./index.js";

it.each([
  ["ppm", "Undefined"],
  ["png", "Zip"],
  ["jpeg", "JPEG"],
  ["bmp", "None"]
])("identifies %s compression through both property spellings", async (format, compression) => {
  const ppm = Buffer.concat([
    Buffer.from("P6\n3 2\n255\n"),
    Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 0, 0, 0, 255, 0, 0, 0, 255])
  ]);
  const converted = spawnSync("magick", ["ppm:-", "-compress", "None", `${format}:-`], { input: ppm });
  expect(converted.status).toBe(0);
  const bytes = format === "ppm" ? ppm : converted.stdout;
  const native = spawnSync("magick", ["identify", "-format", "%C|%[compression]", "-"], { input: bytes });
  expect(native.status).toBe(0);
  expect(native.stderr.toString()).toBe("");
  expect(native.stdout.toString()).toBe(`${compression}|${compression}`);

  const fs = new MemoryFileSystem();
  await fs.writeFile(`/tile.${format}`, bytes);
  let stdout = "", stderr = "";
  const result = await createIdentifyCommand().execute({
    command: "identify",
    args: createCommandArguments(["-format", "%C|%[compression]", `tile.${format}`]).args,
    cwd: "/", env: {}, fs,
    stdin: (async function* () {})(), signal: new AbortController().signal,
    stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
    stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
  });
  expect(result).toEqual({ exitCode: 0 });
  expect(stderr).toBe("");
  expect(stdout).toBe(native.stdout.toString());
});
