import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = new TextEncoder().encode("P3\n3 1\n255\n15 80 145 17 152 231 195 208 65\n");

for (const mode of ["buffered", "sync", "command"] as const) {
    for (const operator of ["-level", "+level"] as const) {
        it.each(["%w", "%[fx:w]", "3"])(`expands ${operator} %s to native Q16 pixels via ${mode}`, async geometry => {
            const files = new Map([["/a.ppm", input], ["/out", new TextEncoder().encode("KEEP")]]);
            const fs = new MemoryFileSystem();
            for (const [path, bytes] of files) await fs.writeFile(path, bytes);
            const argv = ["/a.ppm", operator, geometry, "-endian", "MSB", "-depth", "16", "rgb:/out"];
            const args = createCommandArguments(argv);
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({ command: "magick", args: args.args,
                argumentValues: args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
                stdin: (async function* () {})(), stdout: { async write() {} },
                stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } } })
                : mode === "sync" ? runConvertCliSync(argv, files) : await runConvertCli(argv, files);
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const output = mode === "command" ? await fs.readFile("/out") : files.get("/out")!;
            // ImageMagick 7.1.2-35 Q16-HDRI reference, including the literal and FX controls.
            expect(Buffer.from(output).toString("hex")).toBe(operator === "-level"
                ? "0f0c504f9191110e9899e7e9c3c5d0d24140"
                : "0f125051919111149897e7e5c3c1d0ce4142");
        });
    }
}
