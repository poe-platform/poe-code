import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = Buffer.concat([
    Buffer.from("P6\n7 5\n255\n"),
    Buffer.from(Array.from({ length: 105 }, (_, i) => (13 * i + 9) % 256))
]);

// Native ImageMagick 7.1.2-35 Q16-HDRI raw RGB output for both spellings.
for (const mode of ["sync", "buffered", "retained", "magick", "convert"] as const)
for (const [option, size, hash] of [
    ["-wave", 189, "850ba917f6027ac518b08bb44b5823590c45b027ab1354e4acd717bb025eb771"],
    ["-swirl", 105, "9d0f00d388d9977a0b60b0b32bee447bef2c6d2357aed60e4f1b5dd53efa053a"],
    ["-implode", 105, "91eeb35375c5af1d011f0f3d26064b446a496040a7f809d84f27e266d684d317"]
] as const) {
    it.each(["2", "2:", "%[fx:2]:"])(`${mode}: ${option} %s matches native RGB bytes`, async geometry => {
        const files = new Map<string, Uint8Array>([["/in.ppm", input]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.ppm", input);
        const argv = ["/in.ppm", option, geometry, "-depth", "8", "rgb:/out.raw"];
        let stdout = "", stderr = "";
        const result = mode === "magick" || mode === "convert" ? {
            ...await (mode === "magick" ? createMagickCommand() : createConvertCommand()).execute({
                command: mode, args: createCommandArguments(argv).args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }), stdout, stderr
        } : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const output = mode === "sync" || mode === "buffered" ? files.get("/out.raw")! : await fs.readFile("/out.raw");
        expect(output.byteLength).toBe(size);
        expect(createHash("sha256").update(output).digest("hex")).toBe(hash);
    });
}
