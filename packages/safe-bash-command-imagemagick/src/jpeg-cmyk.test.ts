import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, runConvertCli } from "./index.js";

it.each([0, 1])("decodes CMYK JPEG against independent Pillow pixels (progressive=%s)", async (progressive) => {
  const base = `packages/pdf-ast/src/fixtures/jpeg-CMYK-${progressive}-0-17`;
  const bytes = readFileSync(`${base}.jpg`);
  const expected = new Uint8Array(readFileSync(`${base}.rgba`));
  const fs = new MemoryFileSystem();
  await fs.writeFile("/in.jpg", bytes);
  const argumentValues = createCommandArguments(["/in.jpg", "/out.png"]);
  let stderr = "";
  const result = await createConvertCommand().execute({
    command: "convert", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
    signal: new AbortController().signal, stdin: (async function* () {})(),
    stdout: { async write() {} },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
  });
  expect({ ...result, stderr }).toEqual({ exitCode: 0, stderr: "" });
  expect(decodeImage(await fs.readFile("/out.png")).data).toEqual(expected);
  const files = new Map<string, Uint8Array>([["/in.jpg", bytes]]);
  expect(await runConvertCli(argumentValues.args, files)).toEqual({ exitCode: 0, stdout: "", stderr: "" });
  expect(decodeImage(files.get("/out.png")!).data).toEqual(expected);
  expect(decodeImage(bytes).data).toEqual(expected);
});
