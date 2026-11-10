import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, raw row-major RGBA8.
for (const backend of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        ["#3876b4", "#d29153", "Plus", "e9ed3032a5bad673b092f74f92b246c8482ad83483b501932dfb2bd431fccdd3"],
        ["#3876b480", "#d2915340", "Plus", "3fce6d2261bf94d63c19e313dacdbf338dd1194782ba5bd4867b169d92dab543"],
        ["#3876b4", "#d29153", "Src", "2f96bb3e34c7f12359c1938eabdce954830e283479b05d351c6f08f9ef20071c"],
        ["#3876b4", "#d29153", "Over", "27e57b059415ca01478c819165f90ede7cd67ede4c99864c7ce1ca266a08a58b"]
    ] as const)(`matches native RGBA8 vignette %s on %s with %s (${backend})`, async (foreground, background, compose, expected) => {
        const sentinel = new TextEncoder().encode("KEEP");
        const files = new Map([["/out", sentinel]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/out", sentinel);
        const args = ["-size", "6x4", `xc:${foreground}`, "-background", background,
            "-compose", compose, "-vignette", "0x0+1+1", "-depth", "8", "rgba:/out"];
        let stderr = "";
        const result = backend === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : backend === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, backend === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, "stderr" in result ? String(result.stderr) : stderr).toBe(0);
        const data = backend === "retained" || backend === "command" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(data).toHaveLength(6 * 4 * 4);
        expect(createHash("sha256").update(data).digest("hex")).toBe(expected);
    });
}
