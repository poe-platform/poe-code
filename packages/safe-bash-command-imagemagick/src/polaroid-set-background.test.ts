import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = Buffer.concat([Buffer.from("P6\n12 8\n255\n"), Uint8Array.from({ length: 288 }, (_, i) => (i * 13 + 7) % 256)]);

// Native ImageMagick 7.1.2-35 Q16-HDRI, 8-bit RGBA output.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { name: "default", options: [], hash: "528bf55864c1e4ae2f9b9c95256fde30722ebc3d350e1ca895e67f7433129749" },
        { name: "explicit", options: ["-background", "lime"], hash: "137ba5e81f6c313ab2eebf94922f458bfeaaa888ec0858cc4cfd3190204eadca" },
        { name: "image property", options: ["-set", "background", "lime"], hash: "137ba5e81f6c313ab2eebf94922f458bfeaaa888ec0858cc4cfd3190204eadca" },
        { name: "option property", options: ["-set", "option:background", "lime"], hash: "137ba5e81f6c313ab2eebf94922f458bfeaaa888ec0858cc4cfd3190204eadca" }
    ])(`renders polaroids with native $name background pixels (${mode})`, async ({ options, hash }) => {
        const files = new Map([["/in.ppm", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.ppm", input);
        const args = ["/in.ppm", ...options, "-polaroid", "0", "-depth", "8", "rgba:-"];
        const argumentValues = createCommandArguments(args);
        const chunks: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(chunks);
        expect(output.length).toBe(5760);
        expect(createHash("sha256").update(output).digest("hex")).toBe(hash);
    });
}
