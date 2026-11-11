import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { width: "2", pixels: "000102030405000102030405" },
        { width: "%[fx:n]", pixels: "000102030405000102030405" },
        { width: "%[fx:u[1].w/3]", pixels: "000102030405000102030405" },
        { width: "%[fx:t+1]", pixels: "000102000102030405" },
    ])(`${mode} crops cloned images using list width $width`, async ({ width, pixels }) => {
        const input = Uint8Array.from([
            ...new TextEncoder().encode("P6\n6 4\n255\n"),
            ...Array.from({ length: 72 }, (_, i) => i),
        ]);
        const files = new Map([["/in.ppm", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.ppm", input);
        const args = ["/in.ppm", "+clone", "-crop", `${width}x1+0+0`, "-depth", "8", "rgb:-"];
        const chunks: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect(result.exitCode).toBe(0);
        const output = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? Buffer.from(result.stdoutBytes) : Buffer.concat(chunks);
        // ImageMagick 7.1.2-35 Q16-HDRI: both expressions match the literal width 2.
        expect(output.toString("hex")).toBe(pixels);
    });
}
