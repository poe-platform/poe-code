import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { decodeImage } from "@poe-code/image-ast";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCliSync } from "./index.js";

// Pixel expectations independently verified with native ImageMagick.
for (const sync of [false, true]) for (const [tuple, depth, samples, expected] of [
    ["FANCY", 3, "4180c0", "4180c0ff"],
    ["FOO", 4, "4180c000", "4180c0ff"],
    ["RGB", 3, "4180c0", "4180c0ff"],
    ["RGB_ALPHA", 4, "4180c000", "4180c000"]
] as const) it(`writes MIFF from PAM ${tuple}, sync=${sync}`, async () => {
    const input = Buffer.concat([Buffer.from(`P7\nWIDTH 1\nHEIGHT 1\nDEPTH ${depth}\nMAXVAL 255\nTUPLTYPE ${tuple}\nENDHDR\n`), Buffer.from(samples, "hex")]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.pam", input);
    await fs.writeFile("/out.miff", Buffer.from("keep"));
    const files = new Map<string, Uint8Array>([["/in.pam", input], ["/out.miff", Buffer.from("keep")]]);
    const args = ["/in.pam", "/out.miff"];
    const result = sync ? runMagickCliSync(args, files) : await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} }, stderr: { write: async () => {} }
    });
    expect(result.exitCode).toBe(0);
    const output = sync ? files.get("/out.miff")! : await fs.readFile("/out.miff");
    expect(Buffer.from(decodeImage(output).data).toString("hex")).toBe(expected);
});
