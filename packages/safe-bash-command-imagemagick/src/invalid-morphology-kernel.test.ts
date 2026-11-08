import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli } from "./index.js";

for (const mode of ["command", "buffered", "retained"] as const)
for (const existing of [false, true])
it(`rejects an unknown morphology kernel without writing output (${mode}, existing=${existing})`, async () => {
    const input = await sharp({ create: { width: 9, height: 9, channels: 4, background: "black" } }).png().toBuffer();
    const original = await sharp({ create: { width: 9, height: 9, channels: 4, background: "white" } }).png().toBuffer();
    const fs = new MemoryFileSystem(), files = new Map([["/in.png", input]]);
    await fs.writeFile("/in.png", input);
    if (existing) {
        files.set("/out.png", original);
        await fs.writeFile("/out.png", original);
    }
    const args = ["/in.png", "-morphology", "Dilate", "BogusKernel", "/out.png"];
    const stderr: string[] = [];
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} }, stderr: { write: async chunk => { stderr.push(new TextDecoder().decode(chunk)); } },
    }) : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(1);
    expect(mode === "command" ? stderr.join("") : ("stderr" in result ? result.stderr : "")).toContain("morphology kernel 'BogusKernel'");
    if (mode === "buffered") expect(files.get("/out.png")).toEqual(existing ? original : undefined);
    else if (existing) expect(await fs.readFile("/out.png")).toEqual(original);
    else await expect(fs.readFile("/out.png")).rejects.toThrow();
});
