import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["buffered", "sync", "retained", "command"] as const) {
    it.each([
        { origin: "+3+2", valid: false },
        { origin: "+2+3", valid: false },
        { origin: "-1+1", valid: false },
        { origin: "+1-1", valid: false },
        { origin: "+9+9", valid: false },
        { origin: "+0+0", valid: true },
        { origin: "+2+2", valid: true },
        { origin: "", valid: true },
    ])(`validates color-matrix origin $origin before replacing output (${mode})`, async ({ origin, valid }) => {
        const input = await sharp(new Uint8Array([32, 95, 163, 128, 200, 72, 13, 225]), { raw: { width: 2, height: 1, channels: 4 } }).png().toBuffer();
        const destination = new TextEncoder().encode("KEEP");
        const files = new Map([["/in.png", input], ["/out.png", destination]]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const argv = ["/in.png", "-color-matrix", `3x3${origin}:0,1,0,0,0,1,1,0,0`, "PNG32:/out.png"];
        let stderr = "";
        const args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        const output = mode === "retained" || mode === "command" ? await fs.readFile("/out.png") : files.get("/out.png")!;
        if (valid) {
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            expect([...decodeImage(output).data]).toEqual([95, 163, 32, 128, 72, 13, 200, 225]);
        } else {
            expect(result.exitCode).toBe(1);
            expect("stderr" in result ? result.stderr : stderr).toContain("Invalid color matrix");
            expect(output).toEqual(destination);
        }
    });
}
