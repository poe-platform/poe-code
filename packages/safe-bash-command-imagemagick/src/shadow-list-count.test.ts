import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { offset: "%n", count: 2, x: 2 },
        { offset: "%[fx:n]", count: 2, x: 2 },
        { offset: "1", count: 2, x: 1 },
        { offset: "2", count: 2, x: 2 },
        { offset: "%n", count: 1, x: 1 },
        { offset: "%[fx:n]", count: 1, x: 1 },
        { offset: "%n", count: 3, x: 3 },
        { offset: "%[fx:n]", count: 3, x: 3 }
    ])(`expands shadow offset $offset with $count current images (${mode})`, async ({ offset, count, x }) => {
        const original = new TextEncoder().encode("KEEP");
        const files = new Map([["/out", original]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/out", original);
        const args = ["-size", "3x2", "xc:#5080c080", ...Array<string>(count - 1).fill("xc:blue"),
            "-background", "#d04020", "-shadow", `80x0+${offset}+1`, "-format", "%wx%h %g %[channels];", "info:/out"];
        const argumentValues = createCommandArguments(args);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
        expect(result.exitCode, "stderr" in result ? String(result.stderr) : stderr).toBe(0);
        const output = mode === "buffered" || mode === "sync" ? files.get("/out")! : await filesystem.readFile("/out");
        // Native ImageMagick 7.1.2-35 reports each frame with the same list-sized offset.
        expect(new TextDecoder().decode(output)).toBe(`3x2 ${3 + x}x3+${x}+1 srgba 4.0;`.repeat(count));
    });
}
