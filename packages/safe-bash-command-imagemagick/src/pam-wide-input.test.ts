import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2 Q16-HDRI accepts four-byte PAM samples above MAXVAL 65535.
for (const sync of [false, true]) for (const [maxval, raster] of [
    [65535, "8000"],
    [65536, "00008000"],
    [4294967295, "80000000"]
] as const) it(`decodes grayscale PAM MAXVAL ${maxval}, sync=${sync}`, async () => {
    const input = Buffer.concat([Buffer.from(`P7\nWIDTH 1\nHEIGHT 1\nDEPTH 1\nMAXVAL ${maxval}\nTUPLTYPE GRAYSCALE\nENDHDR\n`), Buffer.from(raster, "hex")]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.pnm", input);
    const args = ["/in.pnm", "-depth", "16", "-endian", "MSB", "gray:-"];
    const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
    const result = sync ? runMagickCliSync(args, new Map([["/in.pnm", input]])) : await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr.push(bytes.slice()); } }
    });
    expect(sync && "stderr" in result ? result.stderr : Buffer.concat(stderr).toString()).toBe("");
    expect(result.exitCode).toBe(0);
    const output = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(stdout);
    expect(Buffer.from(output).toString("hex")).toBe("8000");
});
