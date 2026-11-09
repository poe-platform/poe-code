import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2 Q16-HDRI, including RGB hidden by zero alpha.
for (const backend of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        ["#20304080", [32, 48, 64, 128]],
        ["#203040", [32, 48, 64, 255]],
        ["none", [0, 0, 0, 0]]
    ] as const)(`honors vignette Src and Dst on %s (${backend})`, async (background, rgba) => {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        for (const compose of ["Src", "Dst", "Over"]) {
            const args = ["-size", "9x9", "xc:#b4326480", "-background", background,
                "-compose", compose, "-vignette", "0x0+2+2", "PNG32:/output.png"];
            let stderr = "";
            const result = backend === "command" ? await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : backend === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, backend === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode, "stderr" in result ? String(result.stderr) : stderr).toBe(0);
            const { data } = decodeImage(backend === "retained" || backend === "command" ? await filesystem.readFile("/output.png") : files.get("/output.png")!);
            expect(Array.from(data.slice(0, 4))).toEqual(compose === "Src" ? [180, 50, 100, 0] : rgba);
            expect(Array.from(data.slice(160, 164))).toEqual(compose === "Dst" ? rgba : [180, 50, 100, 255]);
            for (let i = 0; i < data.length; i += 4) {
                if (compose === "Dst") expect(Array.from(data.slice(i, i + 4))).toEqual(rgba);
                if (compose === "Src") expect(Array.from(data.slice(i, i + 3))).toEqual([180, 50, 100]);
            }
        }
    });
}
