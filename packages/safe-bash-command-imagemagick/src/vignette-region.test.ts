import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, raw row-major RGBA8.
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        ["#3876b4", true, false, "3d9677520060f5f65fc596783ae04d62f52f4a0304794051aaee4c9ff66fa1c1"],
        ["#3876b480", true, false, "31afc5c3752e46e1988abe9c705389cc4f5aabbb17e082249cbc507ecb667bf7"],
        ["#3876b4", false, false, "27e57b059415ca01478c819165f90ede7cd67ede4c99864c7ce1ca266a08a58b"],
        ["#3876b480", false, false, "27e57b059415ca01478c819165f90ede7cd67ede4c99864c7ce1ca266a08a58b"],
        ["#3876b4", true, true, "f0f104b60ce34385347a331f85f2a789aff99a7c4fcb5bc7cb9636f10c07b86c"],
        ["#3876b480", true, true, "726a12962867c7e96834b36ce3a1a9f35116db4da98f86f0f2ca5b001a939978"],
    ] as const)(`matches native vignette on %s with region=%s, negate=%s (${mode})`, async (color, region, negate, digest) => {
        const sentinel = new TextEncoder().encode("KEEP");
        const files = new Map([["/out", sentinel]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/out", sentinel);
        const args = ["-size", "6x4", `xc:${color}`, ...(region ? ["-region", "2x2+2+1"] : []),
            "-background", "#d29153", "-compose", "Over", "-vignette", "0x0+1+1", ...(negate ? ["-negate"] : []), "+region", "-depth", "8", "rgba:/out"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, "stderr" in result ? String(result.stderr) : stderr).toBe(0);
        const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(output.length).toBe(6 * 4 * 4);
        expect(createHash("sha256").update(output).digest("hex")).toBe(digest);
    });
}
