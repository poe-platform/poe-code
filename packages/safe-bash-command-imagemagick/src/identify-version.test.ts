import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createIdentifyCommand } from "./index.js";

it.each([false, true])("identify expands the advertised implementation version (ping=%s)", async ping => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/tile.ppm", new Uint8Array([
    ...new TextEncoder().encode("P6\n3 2\n255\n"),
    255, 0, 0, 0, 255, 0, 0, 0, 255,
    255, 0, 0, 0, 255, 0, 0, 0, 255
  ]));
  const outputs: string[] = [];
  for (const argv of [
    ["-version"],
    [...(ping ? ["-ping"] : []), "-format", "X%[version]Y", "/tile.ppm"]
  ]) {
    const argumentValues = createCommandArguments(argv);
    let stdout = "", stderr = "";
    const result = await createIdentifyCommand().execute({
      command: "identify", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    });
    expect({ ...result, stderr }).toEqual({ exitCode: 0, stderr: "" });
    outputs.push(stdout);
  }
  expect(outputs[0]).toBe("Version: ImageMagick 7.1.1-safe-bash (@poe-code/image-ast)\n");
  expect(outputs[1]).toBe(`X${outputs[0]!.slice("Version: ".length).trimEnd()}Y`);
});
