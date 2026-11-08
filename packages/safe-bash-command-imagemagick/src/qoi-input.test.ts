import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// QOI literals, DIFF, RUN, INDEX, and alpha transitions, plus a LUMA variant.
for (const channels of [3, 4]) for (const luma of [false, true]) for (const mode of ["sync", "buffered", "retained", "command"]) {
  it(`reads QOI ${channels} channels, luma=${luma}, ${mode}`, async () => {
    const pixels = Buffer.from("123456ff133557ff133557ffabcdef80123456ffabcdef00808080ff000000ff", "hex");
    if (channels === 3) for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255;
    if (luma) { pixels.set([22, 56, 90], 4); pixels.set([22, 56, 90], 8); }
    const input = Buffer.from(`716f69660000000400000002${channels === 4 ? "04" : "03"}00fe123456${luma ? "a488" : "7f"}c0${channels === 4 ? "ffabcdef80" : "feabcdef"}09${channels === 4 ? "ffabcdef00ff808080ff" : "00fe808080"}fe0000000000000000000001`, "hex");
    const files = new Map([["/in.qoi", input as Uint8Array]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.qoi", input);
    const args = ["/in.qoi", "/out.png"];
    if (mode === "sync") expect(runConvertCliSync(args, files)).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    else if (mode === "buffered" || mode === "retained") expect(await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files)).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    else {
      const argumentValues = createCommandArguments(args);
      let stderr = "";
      const result = await createMagickCommand().execute({ command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs, signal: new AbortController().signal, stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
      expect({ exitCode: result.exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
    }
    const output = mode === "sync" || mode === "buffered" ? files.get("/out.png")! : await fs.readFile("/out.png");
    expect(decodeImage(output).data).toEqual(new Uint8Array(pixels));
  });
}
