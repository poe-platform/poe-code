import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = Buffer.concat([Buffer.from("P6\n4 3\n255\n"),
    Uint8Array.from({ length: 36 }, (_, i) => (17 * i + 3) % 256)]);

// ImageMagick 7.1.2-35 Q16-HDRI: an empty ratio denominator retains amplitude 1.
for (const mode of ["sync", "buffered", "retained", "magick", "convert"] as const) {
    it.each(["1:", "1:x", "1:x2", "1:2"])(`${mode}: preserves wave ratio %s`, async geometry => {
        const files = new Map<string, Uint8Array>([["/in.ppm", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.ppm", input);
        const command = mode === "magick" || mode === "convert";
        const argv = ["/in.ppm", "-wave", geometry, "-depth", "8", command ? "rgb:-" : "rgb:/out.raw"];
        const chunks: Uint8Array[] = [];
        let stderr = "";
        const result = command ? await (mode === "magick" ? createMagickCommand() : createConvertCommand()).execute({
            command: mode, args: createCommandArguments(argv).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = command ? Buffer.concat(chunks) : mode === "retained" ? await filesystem.readFile("/out.raw") : files.get("/out.raw")!;
        expect(output).toHaveLength(geometry === "1:2" ? 48 : 60);
        if (geometry === "1:2") {
            expect(runConvertCliSync(["/in.ppm", "-wave", "0.5x1", "-depth", "8", "rgb:/expected.raw"], files).exitCode).toBe(0);
            expect(Buffer.from(output)).toEqual(Buffer.from(files.get("/expected.raw")!));
        } else {
            expect(createHash("sha256").update(output).digest("hex"))
                .toBe("f6e9a72bc45807bdbd550ab57ae57c82b79bc776eabd92f508d4602acc306019");
        }
    });
}
