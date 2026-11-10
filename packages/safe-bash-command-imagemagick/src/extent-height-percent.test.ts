import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 treats an omitted percentage width as 100%.
for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it.each([
        ["x50%", "4x2 4,2,+0,+0"],
        ["100x50%", "4x2 4,2,+0,+0"],
        ["0x50%", "4x2 4,2,+0,+0"],
        ["50%", "2x2 2,2,+0,+0"],
        ["x25%", "4x1 4,1,+0,+0"],
        ["100x25%", "4x1 4,1,+0,+0"],
    ])(`preserves extent percentage axes for %s (${mode})`, async (geometry, expected) => {
        const files = new Map([["out", new TextEncoder().encode("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/out", files.get("out")!);
        const argv = ["-size", "4x3", "xc:#4080c080", "-extent", geometry,
            "-format", "%wx%h %W,%H,%X,%Y", "info:out"];
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "retained" || mode === "command"
            ? await filesystem.readFile("/out") : files.get("out")!;
        expect(new TextDecoder().decode(output)).toBe(expected);
    });
}
