import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, raw row-major RGBA8.
for (const backend of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        ["SrcIn", "#3876b4", "#d29153", "01469cc363dc92e7d94c773654eb2a3967a06d9af08abfc20272e932de815d8e"],
        ["In", "#3876b4", "#d29153", "01469cc363dc92e7d94c773654eb2a3967a06d9af08abfc20272e932de815d8e"],
        ["DstOut", "#3876b4", "#d29153", "69430271ea8b850cb56298875fe360abbb9cbe14dc9cb0e44a0cce178d80bcfc"],
        ["DestOut", "#3876b4", "#d29153", "69430271ea8b850cb56298875fe360abbb9cbe14dc9cb0e44a0cce178d80bcfc"],
        ["DstOut", "#3876b480", "#d2915340", "bedd91d103c9cb312385a2d635545613da4382912cf2e68b16d9ad1d1ec6469c"],
        ["Src", "#3876b4", "#d29153", "2f96bb3e34c7f12359c1938eabdce954830e283479b05d351c6f08f9ef20071c"],
        ["Dst", "#3876b4", "#d29153", "0c37a1c7b71f1b97438d5360233e9137693407ccaf2f13bbd700bd29ffe38209"]
    ] as const)(`matches native vignette %s for %s on %s (${backend})`, async (compose, source, background, expected) => {
        const sentinel = new TextEncoder().encode("KEEP");
        const files = new Map([["/out", sentinel]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/out", sentinel);
        const args = ["-size", "6x4", `xc:${source}`, "-background", background,
            "-compose", compose, "-vignette", "0x0+1+1", "-depth", "8", "rgba:/out"];
        let stderr = "";
        const result = backend === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : backend === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, backend === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, "stderr" in result ? String(result.stderr) : stderr).toBe(0);
        const pixels = backend === "retained" || backend === "command" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(pixels).toHaveLength(6 * 4 * 4);
        expect(createHash("sha256").update(pixels).digest("hex")).toBe(expected);
    });
}
