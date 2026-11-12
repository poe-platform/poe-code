import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: channel selection limits writes, not region matching.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const method of ["floodfill", "filltoborder"] as const) it.each([
        { channels: ["-channel", "R"], floodfill: "ff406080000000ff20406080", filltoborder: "ff406080ff0000ffff406080" },
        { channels: ["-channel", "Alpha"], floodfill: "20406040000000ff20406080", filltoborder: "204060400000004020406040" },
        { channels: [], floodfill: "ff003040000000ff20406080", filltoborder: "ff003040ff003040ff003040" },
        { channels: ["-channel", "R", "+channel"], floodfill: "ff003040000000ff20406080", filltoborder: "ff003040ff003040ff003040" }
    ])(`${mode}: color ${method} preserves unselected channels ($channels)`, async ({ channels, ...expected }) => {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const argv = ["xc:#20406080", "xc:#000000ff", "xc:#20406080", "+append", ...channels,
            "-fill", "#ff003040", "-draw", `color 0,0 ${method}`, "-depth", "8", "rgba:out"];
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "sync" ? runMagickCliSync(argv, files)
            : mode === "buffered" ? await runMagickCli(argv, files)
            : mode === "retained" ? await runMagickCli(argv, { filesystem: fs, cwd: "/" })
            : await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
        expect(Buffer.from(bytes).toString("hex")).toBe(expected[method]);
    });
}
