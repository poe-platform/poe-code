import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createIdentifyCommand, runIdentifyCli, runMagickCli } from "./index.js";

it.each([3, 4] as const)("identify reports Q16 separately from %i-channel PNG depth", async (channels) => {
  const bytes = await sharp(new Uint8Array([200, 100, 50, 128].slice(0, channels)), {
    raw: { width: 1, height: 1, channels }
  }).png().toBuffer();
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input.png", bytes);
  const argumentValues = createCommandArguments(["-format", "%q|%z|%[bit-depth]|%[fx:depth]", "/input.png"]);
  let stdout = "", stderr = "";
  const result = await createIdentifyCommand().execute({
    command: "identify", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
    signal: new AbortController().signal, stdin: (async function* () {})(),
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
  });
  expect({ ...result, stdout, stderr }).toEqual({ exitCode: 0, stdout: "16|8|8|8", stderr: "" });
});

for (const red of [20, 200]) {
  for (const channels of [3, 4] as const) {
    it(`evaluates FX constants independently of red=${red}, channels=${channels}`, async () => {
      const bytes = await sharp(new Uint8Array([red, 100, 50, 128].slice(0, channels)), {
        raw: { width: 1, height: 1, channels }
      }).png().toBuffer();
      const fs = new MemoryFileSystem();
      await fs.writeFile("/input.png", bytes);
      const format = "%[fx:quantumrange]|%[fx:depth]|%[fx:depth*2]|%[fx:quantumrange/255]";
      const argumentValues = createCommandArguments(["-format", format, "/input.png"]);
      let stdout = "", stderr = "";
      const result = await createIdentifyCommand().execute({
        command: "identify", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
      });
      const expected = "65535|8|16|257";
      expect({ ...result, stdout, stderr }).toEqual({ exitCode: 0, stdout: expected, stderr: "" });
      const files = new Map([["/input.png", bytes]]);
      expect(await runIdentifyCli(argumentValues.args, files)).toEqual({ exitCode: 0, stdout: expected, stderr: "" });
      expect(await runMagickCli(["/input.png", "-format", format, "info:"], files))
        .toEqual({ exitCode: 0, stdout: expected, stderr: "" });
    });
  }
}

it("uses the 16-bit PNG source depth in FX expressions", async () => {
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABEAIAAAAr0DSeAAAAFUlEQVQI12MUMgmrmLXnzYoUhTszACHGBfjAwcGSAAAAAElFTkSuQmCC", "base64");
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input.png", bytes);
  for (const input of [new Map([["/input.png", bytes]]), { filesystem: fs, cwd: "/" }]) {
    expect(await runIdentifyCli(["-format", "%[fx:quantumrange]|%[fx:depth]", "/input.png"], input))
      .toEqual({ exitCode: 0, stdout: "65535|16", stderr: "" });
  }
});
