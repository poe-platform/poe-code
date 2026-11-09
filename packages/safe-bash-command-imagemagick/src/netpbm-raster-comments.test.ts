import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/core";
import {decodeImage} from "@poe-code/image-ast";
import {createCommandArguments} from "safe-bash-contracts/command";
import {createMagickCommand, runMagickCliSync} from "./index.js";

for (const sync of [false, true]) it.each(["\r", "\n", "\r\n"])(`preserves PGM samples after raster comments ending in %j, sync=${sync}`, async ending => {
  const input = Buffer.from(`P2\n3 1\n15\n1 #note${ending}5 13\n`);
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input.pgm", input);
  await fs.writeFile("/out.miff", Buffer.from("keep"));
  const files = new Map([["input.pgm", input], ["out.miff", Buffer.from("keep")]]);
  const args = createCommandArguments(["input.pgm", "out.miff"]);
  let stderr = "";
  const result = sync ? runMagickCliSync(args.args, files) : await createMagickCommand().execute({command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs, signal: new AbortController().signal, stdin: (async function* () {})(), stdout: {async write() {}}, stderr: {async write(bytes) {stderr += new TextDecoder().decode(bytes);}}});
  expect("stderr" in result ? result.stderr : stderr).toBe("");
  expect(result.exitCode).toBe(0);
  const output = sync ? files.get("out.miff")! : await fs.readFile("/out.miff");
  expect(Array.from(decodeImage(output).data)).toEqual([17, 17, 17, 255, 85, 85, 85, 255, 221, 221, 221, 255]);
});
