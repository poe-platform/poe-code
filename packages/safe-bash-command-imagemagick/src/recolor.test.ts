import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(["-recolor", "-color-matrix"])(`${mode}: handles %s without silently replacing output`, async option => {
        const input = await sharp(Uint8Array.from([200, 21, 62, 128, 15, 99, 51, 255, 0, 0, 0, 200]),
            { raw: { width: 3, height: 1, channels: 4 } }).png().toBuffer();
        const original = new TextEncoder().encode("KEEP");
        const files = new Map([["/in.png", input], ["/out.png", original]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", input);
        await fs.writeFile("/out.png", original);
        const argv = ["/in.png", option, "0,0,1 1,0,0 0,1,0", "PNG32:/out.png"];
        let exitCode: number, stdout = "", stderr = "";
        if (mode === "command") {
            const args = createCommandArguments(argv);
            ({ exitCode } = await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }));
        } else {
            ({ exitCode, stdout, stderr } = mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files));
        }
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("/out.png")!;
        expect(stdout).toBe("");
        if (option === "-recolor") {
            expect(exitCode).toBe(1);
            expect(stderr).toContain('option has been replaced \'-recolor\', use "-color-matrix"');
            expect(output).toEqual(original);
        } else {
            expect(exitCode).toBe(0);
            expect(stderr).toBe("");
            expect([...decodeImage(output).data]).toEqual([62, 200, 21, 128, 51, 15, 99, 255, 0, 0, 0, 200]);
        }
    });
}
