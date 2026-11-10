import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = new TextEncoder().encode(`P3
4 2
255
19 61 200 91 125 39 120 85 65 198 183 17
213 210 98 220 90 179 67 85 190 141 184 70
`);
const keep = new TextEncoder().encode("KEEP");

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const operation of ["-contrast-stretch", "-linear-stretch"]) {
        for (const placement of ["before input", "empty group", "after input"]) {
            it(`${mode}: ${operation} ${placement} matches native status and destination`, async () => {
                const files = new Map([["a.ppm", input], ["out", keep]]);
                const fs = new MemoryFileSystem();
                await fs.writeFile("/a.ppm", input);
                await fs.writeFile("/out", keep);
                const argv = [
                    ...(placement === "before input" ? [operation, "1", "a.ppm"]
                        : placement === "empty group" ? ["a.ppm", "(", operation, "1", ")"]
                            : ["a.ppm", operation, "1"]),
                    "-endian", "MSB", "-depth", "8", "rgb:out"
                ];
                const args = createCommandArguments(argv);
                let stderr = "";
                const result = mode === "command" ? await createMagickCommand().execute({
                    command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
                }) : mode === "sync" ? runConvertCliSync(argv, files)
                    : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
                const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
                if (placement === "after input") {
                    // ImageMagick 7.1.2-35 Q16-HDRI reference output.
                    expect(result.exitCode).toBe(0);
                    expect(Buffer.from(output).toString("hex")).toBe(operation === "-contrast-stretch"
                        ? "0000ff076c005d0000ffff00ffff1cff04ff0000ff9cff00"
                        : "0000ffffff00ffdb1cffff00ffffffffffff2fdbffffff4c");
                } else {
                    expect(result.exitCode).toBe(1);
                    expect("stderr" in result ? result.stderr : stderr).toContain(`no images found for operation '${operation}'`);
                    expect(output).toEqual(keep);
                }
            });
        }
    }
}
