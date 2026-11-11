import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, raw row-major RGBA8.
for (const backend of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        ["Overlay", "#3169af80", "#b4502060", "50123520490f30d315f626b4f5d2d7405812e790fdc69045f2d7793611afea23"],
        ["HardLight", "#3169af80", "#b4502060", "413de47072e25e329421f77285a0597e28417ab355dec07eb571abd1ea6d6886"],
        ["Over", "#3169af80", "#b4502060", "8afa5d6cceff8ef337955287c79b91c44bc9557c40fd782c7b8559265091b121"],
    ] as const)(`matches native vignette %s with %s on %s (${backend})`, async (compose, source, background, digest) => {
        const sentinel = new TextEncoder().encode("KEEP");
        const files = new Map([["/out", sentinel]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/out", sentinel);
        const args = ["-size", "7x5", `xc:${source}`, "-background", background,
            "-compose", compose, "-vignette", "0x1+1+1", "-depth", "8", "rgba:/out"];
        let stderr = "";
        const result = backend === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : backend === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, backend === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, "stderr" in result ? String(result.stderr) : stderr).toBe(0);
        const output = backend === "retained" || backend === "command" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(output).toHaveLength(7 * 5 * 4);
        expect(createHash("sha256").update(output).digest("hex")).toBe(digest);
    });
}
