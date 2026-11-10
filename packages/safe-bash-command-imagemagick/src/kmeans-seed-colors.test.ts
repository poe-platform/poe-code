import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli } from "./index.js";

// Native ImageMagick 7.1.2: raw RGBA bytes after one Lloyd iteration.
for (const retained of [false, true])
it.each([
    [["#202040", "#405080", "#808060", "#b0a040"], "black;white", "4b5060ff4b5060ff4b5060ffb0a040ff", "303860ff303860ff989050ff989050ff"],
    [["red", "lime", "blue"], "red;blue", "808000ff808000ff0000ffff", "808000ff808000ff0000ffff"],
    [["red", "lime", "blue"], "black", "808000ff808000ff0000ffff", "808000ff808000ff0000ffff"],
    [["#f0301020", "#10a04080", "#4050d0c0"], "#ff000080;#0000ff80", "f0301020287888a0287888a0", "f0301020287888a0287888a0"],
    [["red", "lime", "blue"], "black;white", "555555ff555555ff555555ff", "808000ff808000ff0000ffff"],
    [["#f0301020", "#10a04080", "#4050d0c0"], "red;blue", "f03010ff287888ff287888ff", "f0301020287888a0287888a0"],
])(`honors supplied kmeans centers %j (retained=${retained})`, async (input, centers, expected, control) => {
    for (const unset of [false, true]) {
        const files = new Map([["out", new TextEncoder().encode("KEEP")]]), fs = new MemoryFileSystem();
        await fs.writeFile("/out", new TextEncoder().encode("KEEP"));
        const argv = ["-seed", "7", ...input.map(color => `xc:${color}`), "+append", "-define", `kmeans:seed-colors=${centers}`,
            ...(unset ? ["+define", "kmeans:seed-colors"] : []), "-kmeans", "2x1", "-depth", "8", "rgba:out"];
        if (retained) {
            const args = createCommandArguments(argv);
            const result = await createMagickCommand().execute({ command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} } });
            expect(result.exitCode).toBe(0);
        } else {
            const result = await runMagickCli(argv, files);
            expect(result.exitCode, result.stderr).toBe(0);
        }
        expect(Buffer.from(retained ? await fs.readFile("/out") : files.get("out")!).toString("hex")).toBe(unset ? control : expected);
    }
});
