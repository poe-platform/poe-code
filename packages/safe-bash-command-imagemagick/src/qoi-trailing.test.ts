import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
  it.each(["", "0a", "716f696600000001000000010300feffffff0000000000000001"])(
    `reads only the first complete QOI (${mode}, suffix=%s)`, async suffix => {
    // Native ImageMagick returns 804020ff for each input, including concatenated images.
    const input = Buffer.from(`716f696600000001000000010300fe8040200000000000000001${suffix}`, "hex");
    const files = new Map([["/input.qoi", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/input.qoi", input);
    const args = ["/input.qoi", "-depth", "8", mode === "command" ? "rgba:-" : "rgba:/pixel.raw"];
    const chunks: Uint8Array[] = [];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
      stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { write: async chunk => { chunks.push(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk); } },
      stderr: { write: async chunk => { stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } }
    }) : mode === "sync" ? runConvertCliSync(args, files)
      : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(mode === "command" ? stderr : "stderr" in result ? result.stderr : "").toBe("");
    expect(result.exitCode).toBe(0);
    const output = mode === "command" ? Buffer.concat(chunks)
      : mode === "retained" ? await fs.readFile("/pixel.raw") : files.get("/pixel.raw")!;
    expect(Array.from(output)).toEqual([128, 64, 32, 255]);
  });
}
