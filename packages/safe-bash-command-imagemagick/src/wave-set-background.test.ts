import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = Buffer.concat([Buffer.from("P6\n8 6\n255\n"), Uint8Array.from({ length: 144 }, (_, i) => i)]);

// Native ImageMagick 7.1.2-35 Q16-HDRI, 8-bit RGB output.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { name: "default", options: [], hash: "5bf129a9ba57e19e2e5d9c958054c38091a64a580cabdbb89242452871e636f4" },
        { name: "explicit", options: ["-background", "lime"], hash: "178212d1ba95dfd8408f9ed19d0135cb3f89a1a338d7dcd704c412af76ea31b6" },
        { name: "image property", options: ["-set", "background", "lime"], hash: "178212d1ba95dfd8408f9ed19d0135cb3f89a1a338d7dcd704c412af76ea31b6" },
        { name: "option property", options: ["-set", "option:background", "lime"], hash: "178212d1ba95dfd8408f9ed19d0135cb3f89a1a338d7dcd704c412af76ea31b6" }
    ])(`waves with native $name background pixels (${mode})`, async ({ options, hash }) => {
        const files = new Map([["/in.ppm", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.ppm", input);
        const args = ["/in.ppm", ...options, "-wave", "2x5", "-depth", "8", "rgb:-"];
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
        expect(output.length).toBe(240);
        expect(createHash("sha256").update(output).digest("hex")).toBe(hash);
    });
}
