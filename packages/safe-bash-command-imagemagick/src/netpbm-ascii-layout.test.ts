import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/core";
import {createCommandArguments} from "safe-bash-contracts/command";
import {createMagickCommand, runConvertCli, runMagickCliSync} from "./index.js";

it.each([
  {format: "ppm", expected: "P3\n2 1\n255\n255 0 0 0 0 255\n"},
  {format: "pgm", expected: "P2\n2 1\n255\n54 18\n"},
  {format: "pbm", expected: "P1\n2 1\n0 1\n"},
])("groups plain $format samples like ImageMagick", async ({format, expected}) => {
  const input = Buffer.from("50360a3220310a3235350aff00000000ff", "hex");
  const argv = ["/in.pnm", "-depth", "8", "-compress", "None", `/out.${format}`];
  for (const run of [runConvertCli, runMagickCliSync]) {
    const files = new Map<string, Uint8Array>([["/in.pnm", input]]);
    expect(await run(argv, files)).toEqual({exitCode: 0, stdout: "", stderr: ""});
    expect(Buffer.from(files.get(`/out.${format}`)!).toString()).toBe(expected);
  }
  const fs = new MemoryFileSystem();
  await fs.writeFile("/in.pnm", input);
  const args = createCommandArguments(argv);
  let stderr = "";
  const result = await createMagickCommand().execute({command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs, signal: new AbortController().signal, stdin: (async function* () {})(), stdout: {async write() {}}, stderr: {async write(bytes) {stderr += new TextDecoder().decode(bytes);}}});
  expect(stderr).toBe("");
  expect(result.exitCode).toBe(0);
  expect(Buffer.from(await fs.readFile(`/out.${format}`)).toString()).toBe(expected);
});
