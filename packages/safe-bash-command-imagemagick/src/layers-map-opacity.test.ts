import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI. A one-pixel destination isolates map opacity
// from coordinate sampling; 16-bit output also checks fractional working alpha.
const cases = [
    { destination: "red", map: "#80808080", alpha: [], depth: "8", expected: "ff000080" },
    { destination: "#ff000080", map: "#80808080", alpha: [], depth: "8", expected: "ff000040" },
    { destination: "red", map: "#80808000", alpha: [], depth: "8", expected: "ff000000" },
    { destination: "red", map: "#808080ff", alpha: [], depth: "8", expected: "ff0000ff" },
    { destination: "red", map: "#80808080", alpha: ["-alpha", "off"], depth: "8", expected: "ff0000ff" },
    { destination: "#ff000080", map: "#80808080", alpha: [], depth: "16", expected: "ffff000000004081" },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const compose of ["Displace", "Distort"]) {
        for (const operation of [["-flatten"], ["-layers", "merge"]]) {
            it.each(cases)(`${mode} ${compose} ${operation.join(" ")} $destination $map $alpha depth=$depth`, async ({ destination, map, alpha, depth, expected }) => {
                const argv = ["-respect-parentheses", `xc:${destination}`, "(", `xc:${map}`, ...alpha,
                    "-compose", compose, ")", "-background", "none", ...operation,
                    "-depth", depth, "-endian", "MSB", mode === "command" ? "rgba:-" : "rgba:/out"];
                const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
                const args = createCommandArguments(argv);
                let stdout = "", stderr = "";
                const result = mode === "command" ? await createMagickCommand().execute({
                    command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString("hex"); } },
                    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
                }) : mode === "sync" ? runMagickCliSync(argv, files)
                    : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
                expect(result.exitCode).toBe(0);
                expect("stderr" in result ? result.stderr : stderr).toBe("");
                const output = mode === "command" ? stdout
                    : Buffer.from(mode === "retained" ? await fs.readFile("/out") : files.get("/out")!).toString("hex");
                expect(output).toBe(expected);
            });
        }
    }
}
