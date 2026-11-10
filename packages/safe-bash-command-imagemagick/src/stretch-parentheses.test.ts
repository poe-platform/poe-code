import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI RGB output for the issue's PPM fixture.
const input = new TextEncoder().encode(`P3
4 2
255
19 61 200 91 125 39 120 85 65 198 183 17
213 210 98 220 90 179 67 85 190 141 184 70
`);
const cases = [
    ["-contrast-stretch", "2", "0000ff007300620000ffff00ffff18ff00ff0000ffa9ff00"],
    ["-contrast-stretch", "2x1", "0000ff006800590000ffff00ffff15ff00ff0000ff99ff00"],
    ["-linear-stretch", "2", "0000ffffff00ff0000ffff00ffffffff8eff0000ffffff00"],
    ["-linear-stretch", "2x1", "0000f9055100460000f5d300ffff15ff03ca0000e375d500"],
] as const;

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const parenthesized of [false, true]) {
        it.each(cases)(`${mode}, parentheses=${parenthesized}: %s %s matches native pixels`, async (operation, cutoff, expected) => {
            const keep = new TextEncoder().encode("KEEP");
            const files = new Map([["/a.ppm", input], ["/out", keep]]);
            const filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/a.ppm", input);
            await filesystem.writeFile("/out", keep);
            const argv = ["/a.ppm", operation, parenthesized ? `(${cutoff})` : cutoff,
                "-endian", "MSB", "-depth", "8", "rgb:/out"];
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
            const output = mode === "command" || mode === "retained"
                ? await filesystem.readFile("/out") : files.get("/out")!;
            expect(Buffer.from(output).toString("hex")).toBe(expected);
        });
    }
}
