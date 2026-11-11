import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, complete row-major RGBA8 output.
for (const backend of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        ["DstIn", "2757cd92ea506854368031cb92fcc1d4cf14c46c6fef694de36055f30dca4d92", "b4502005"],
        ["DestIn", "2757cd92ea506854368031cb92fcc1d4cf14c46c6fef694de36055f30dca4d92", "b4502005"],
        ["SrcOut", "1739d64bd52008a5977fe6fbe366bc0b75a15e6c4cc3bec2b658e0ea139f4ffa", "02030608"],
        ["Out", "1739d64bd52008a5977fe6fbe366bc0b75a15e6c4cc3bec2b658e0ea139f4ffa", "02030608"],
        ["SrcIn", "cec30b4417ff7e6f765de46ceab6a27c301e3e711206fa99cba638b3e6dd3deb", "01020305"],
        ["DstOut", "1221fa29ed28ca20d8a009c9ca2ca6e57a1172c013efd937aabba7af7e13b4a7", "b450205b"],
        ["Over", "8afa5d6cceff8ef337955287c79b91c44bc9557c40fd782c7b8559265091b121", "a4533268"],
    ] as const)(`matches native vignette %s (${backend})`, async (compose, digest, rgba) => {
        const files = new Map<string, Uint8Array>();
        const filesystem = new MemoryFileSystem();
        const args = ["-size", "7x5", "xc:#3169af80", "-background", "#b4502060", "-compose", compose,
            "-vignette", "0x1+1+1", "-depth", "8", "rgba:/out"];
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
        expect.soft(Buffer.from(output.subarray(0, 4)).toString("hex")).toBe(rgba);
        expect(createHash("sha256").update(output).digest("hex")).toBe(digest);
    });
}
