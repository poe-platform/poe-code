import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import sharp from "@poe-code/image-ast";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createIdentifyCommand, runIdentifyCli } from "./index.js";

it.each(["png", "ppm", "gif", "jpeg"] as const)("distinguishes stored %s quality from the short-format fallback", async format => {
  const bytes = await sharp({ create: { width: 3, height: 2, channels: 3, background: "red" } })
    .toFormat(format, { quality: 81 }).toBuffer();
  const fs = new MemoryFileSystem();
  await fs.writeFile(`/input.${format}`, bytes);
  const argumentValues = createCommandArguments(["-format", "%Q|%[quality]", `/input.${format}`]);
  let stdout = "", stderr = "";
  const result = await createIdentifyCommand().execute({
    command: "identify", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
    signal: new AbortController().signal, stdin: (async function* () {})(),
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
  });
  const expected = { exitCode: 0, stdout: format === "jpeg" ? "81|81" : "92|0", stderr: "" };
  expect({ ...result, stdout, stderr }).toEqual(expected);
  expect(await runIdentifyCli(argumentValues.args, { filesystem: fs, cwd: "/" })).toEqual(expected);
});

describe.each([false, true])("JPEG tables moved after frame: %s", moveTables => {
it.each([
  ["packages/pdf-ast/src/fixtures/jpeg-rgb-direct.jpg", "91"],
  ["docs/banners/poe-code.jpg", "85"],
  ["packages/pdf-ast/src/fixtures/jpeg-L-0-0-17.jpg", "91"],
  ["packages/pdf-ast/src/fixtures/jpeg-L-1-0-17.jpg", "91"]
])("identifies source JPEG quality for %s", async (path, quality) => {
  const fs = new MemoryFileSystem();
  let bytes = readFileSync(path!);
  if (moveTables) {
    const headers: Uint8Array[] = [], tables: Uint8Array[] = [];
    let position = 2;
    while (bytes[position + 1] !== 0xda) {
      const end = position + 2 + bytes.readUInt16BE(position + 2);
      (bytes[position + 1] === 0xdb ? tables : headers).push(bytes.subarray(position, end));
      position = end;
    }
    bytes = Buffer.concat([bytes.subarray(0, 2), ...headers, ...tables, bytes.subarray(position)]);
  }
  await fs.writeFile("/input.jpg", bytes);
  const argumentValues = createCommandArguments(["-format", "%Q|%[quality]", "/input.jpg"]);
  let stdout = "", stderr = "";
  const result = await createIdentifyCommand().execute({
    command: "identify", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
    signal: new AbortController().signal, stdin: (async function* () {})(),
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
  });
  const expected = { exitCode: 0, stdout: `${quality}|${quality}`, stderr: "" };
  expect({ ...result, stdout, stderr }).toEqual(expected);
  expect(await runIdentifyCli(argumentValues.args, { filesystem: fs, cwd: "/" })).toEqual(expected);
});
});
