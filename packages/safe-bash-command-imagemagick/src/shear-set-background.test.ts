import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = Buffer.concat([Buffer.from("P6\n8 6\n255\n"), Uint8Array.from({ length: 144 }, (_, i) => i)]);

// Native ImageMagick 7.1.2-35 Q16-HDRI, 16-bit big-endian RGBA output.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { name: "default", options: [], hash: "286cfc047dfc2e8430ccb65225e1ebc953aee0f3f32094e1b64bb5b1b2dd7e0f" },
        { name: "explicit", options: ["-background", "lime"], hash: "5931cb8ee56474c9e0f66286600773d0b3f355b883742d2d7b68a9d3560db3b5" },
        { name: "image property", options: ["-set", "background", "lime"], hash: "5931cb8ee56474c9e0f66286600773d0b3f355b883742d2d7b68a9d3560db3b5" },
        { name: "option property", options: ["-set", "option:background", "lime"], hash: "5931cb8ee56474c9e0f66286600773d0b3f355b883742d2d7b68a9d3560db3b5" }
    ])(`shears with native $name background pixels (${mode})`, async ({ options, hash }) => {
        const files = new Map([["/in.ppm", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.ppm", input);
        const args = ["/in.ppm", ...options, "-shear", "18x-7", "-depth", "16", "-endian", "MSB", "rgba:-"];
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
        expect(output.length).toBe(560);
        expect(createHash("sha256").update(output).digest("hex")).toBe(hash);
    });
}
