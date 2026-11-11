import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createCompositeCommand, createMagickCommand, runCompositeCli, runCompositeCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI reports these option errors and retains KEEP.
for (const route of ["magick", "composite", "retained", "buffered", "sync"])
for (const position of ["before", "after"])
for (const { options, diagnostic, output } of [
    { options: ["-flip"], diagnostic: "unrecognized option '-flip'", output: "4b454550" },
    { options: ["-flop"], diagnostic: "unrecognized option '-flop'", output: "4b454550" },
    { options: [], diagnostic: "", output: "0a6f79288d9746abb5" },
    { options: ["-rotate", "180"], diagnostic: "", output: "46abb5288d970a6f79" },
])
it(`${route}: ${position} inputs, composite ${options.join(" ") || "control"} preserves native diagnostics and output`, async () => {
    const files = new Map([
        ["/left.ppm", new TextEncoder().encode("P3\n3 1\n255\n10 20 30  40 50 60  70 80 90\n")],
        ["/right.ppm", new TextEncoder().encode("P3\n3 1\n255\n101 111 121  131 141 151  161 171 181\n")],
        ["/out.raw", new TextEncoder().encode("KEEP")],
        ["/side.raw", new TextEncoder().encode("KEEP")],
    ]);
    const fs = new MemoryFileSystem();
    for (const [path, bytes] of files) await fs.writeFile(path, bytes);
    const args = ["-compose", "CopyRed", ...(position === "before" ? options : []), "/left.ppm", "/right.ppm", ...(position === "after" ? options : []), "rgb:/out.raw"];
    let stdout = "", stderr = "";
    let exitCode: number;
    if (route === "magick" || route === "composite") {
        const command = route === "magick" ? createMagickCommand() : createCompositeCommand();
        ({ exitCode } = await command.execute({
            command: command.name, args: createCommandArguments(route === "magick" ? ["composite", ...args] : args).args,
            cwd: "/", env: {}, fs, signal: new AbortController().signal,
            stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }));
    } else {
        ({ exitCode, stdout, stderr } = route === "sync" ? runCompositeCliSync(args, files)
            : await runCompositeCli(args, route === "retained" ? { filesystem: fs, cwd: "/" } : files));
    }
    expect(exitCode).toBe(diagnostic ? 1 : 0);
    expect(stdout).toBe("");
    expect(stderr).toBe(diagnostic ? `composite: ${diagnostic}\n` : "");
    const bytes = route === "buffered" || route === "sync" ? files.get("/out.raw")! : await fs.readFile("/out.raw");
    expect(Buffer.from(bytes).toString("hex")).toBe(output);
    const side = route === "buffered" || route === "sync" ? files.get("/side.raw")! : await fs.readFile("/side.raw");
    expect(Buffer.from(side).toString("hex")).toBe("4b454550");
});
