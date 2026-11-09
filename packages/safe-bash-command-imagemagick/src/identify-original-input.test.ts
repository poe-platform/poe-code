import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createIdentifyCommand, runIdentifyCli } from "./index.js";

// Two 3x2 frames (red and blue), encoded by native ImageMagick.
const gif = Uint8Array.from(Buffer.from("R0lGODlhAwACAPAAAP8AAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQAAAAAACwAAAAAAwACAAACAoRfACH5BAAAAAAALAAAAAADAAIAgAAA/wAAAAIChF8AOw==", "base64"));

it.each([
  ["anim.gif", 2],
  ["anim.gif[1]", 1],
  ["anim.gif[0-1]", 2],
  ["./anim.gif[1]", 1]
] as const)("identify preserves original input %s in the original filename escape", async (input, frames) => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/anim.gif", gif);
  const argumentValues = createCommandArguments(["-format", "%M|%i\n", input]);
  const filename = input.slice(0, input.indexOf("[") < 0 ? input.length : input.indexOf("["));
  const expected = { exitCode: 0, stdout: `${input}|${filename}\n`.repeat(frames), stderr: "" };
  let stdout = "", stderr = "";
  const result = await createIdentifyCommand().execute({
    command: "identify", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
    signal: new AbortController().signal, stdin: (async function* () {})(),
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
  });
  expect({ ...result, stdout, stderr }).toEqual(expected);
  expect(await runIdentifyCli(argumentValues.args, new Map([[filename, gif]]))).toEqual(expected);
});
