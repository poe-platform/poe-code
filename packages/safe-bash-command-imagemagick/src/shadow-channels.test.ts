import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, raw RGBA8.
for (const backend of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        { options: ["-channel", "RGB"], pixel: "d0402000" },
        { options: ["-channel", "R"], pixel: "d0402000" },
        { options: [], pixel: "d0402066" },
        { options: ["-channel", "A"], pixel: "d0402066" },
    ])(`honors shadow channels $options (${backend})`, async ({ options, pixel }) => {
        const sentinel = new TextEncoder().encode("KEEP");
        const files = new Map([["/out", sentinel]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/out", sentinel);
        const args = ["-size", "3x2", "xc:#5080c080", ...options, "-background", "#d04020",
            "-shadow", "80x0+1+2", "-depth", "8", "rgba:/out"];
        let stderr = "";
        const result = backend === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : backend === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, backend === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, "stderr" in result ? String(result.stderr) : stderr).toBe(0);
        const data = backend === "retained" || backend === "command" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(data).toString("hex")).toBe(pixel.repeat(6));
    });
}
