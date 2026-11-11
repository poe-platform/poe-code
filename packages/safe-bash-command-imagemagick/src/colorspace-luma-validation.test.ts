import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const option of ["-colorspace", "-quantize"]) {
        it.each(["Rec601Luma", "Rec709Luma", "rec601luma", "REC709LUMA"])(`${mode}: rejects ${option} %s without publishing pixels`, async space => {
            for (const destination of ["rgb:-", "rgb:/out"]) {
                const sentinel = Buffer.from("KEEP");
                const files = new Map<string, Uint8Array>([["/out", sentinel]]);
                const fs = new MemoryFileSystem();
                await fs.writeFile("/out", sentinel);
                const args = ["xc:red", option, space, ...(option === "-quantize" ? ["-colors", "2"] : []), "-depth", "8", destination];
                let stdout = "", stderr = "";
                const result = mode === "command" ? await createMagickCommand().execute({
                    command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
                    stdin: (async function* () {})(), signal: new AbortController().signal,
                    stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
                    stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
                }) : mode === "sync" ? runMagickCliSync(args, files)
                    : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
                expect(result.exitCode).toBe(1);
                expect("stderr" in result ? result.stderr : stderr).toContain("unrecognized colorspace");
                expect("stderr" in result ? result.stderr : stderr).toContain(space);
                expect("stdout" in result ? result.stdout : stdout).toBe("");
                const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
                expect(Buffer.from(output)).toEqual(sentinel);
            }
        });
    }
}

it.each([
    ["-intensity", "Rec601Luma", "-colorspace", "Gray"],
    ["-intensity", "Rec709Luma", "-colorspace", "Gray"],
    ["-grayscale", "Rec601Luma"],
    ["-grayscale", "Rec709Luma"],
    ["-colorspace", "Rec601YCbCr"],
    ["-colorspace", "Rec709YCbCr"],
    ["-quantize", "Rec601YCbCr", "-colors", "2"],
    ["-quantize", "Rec709YCbCr", "-colors", "2"],
].map(options => ({ options })))("accepts valid intensity methods and colorspaces: $options", async ({ options }) => {
    const fs = new MemoryFileSystem();
    const args = ["xc:red", ...options, "-depth", "8", "rgb:/out"];
    let stderr = "";
    const result = await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
    });
    expect(result.exitCode, stderr).toBe(0);
    expect(stderr).toBe("");
    const output = await fs.readFile("/out");
    expect(output).toHaveLength(3);
    if (options[1]!.endsWith("Luma")) {
        expect([...output]).toEqual(Array(3).fill(options[0] === "-grayscale" && options[1] === "Rec601Luma" ? 76 : 54));
    }
});
