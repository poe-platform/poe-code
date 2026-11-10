import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Complete stdout from ImageMagick 7.1.2-35 Q16-HDRI, including controls.
const cases = [
    { color: "#123456", operators: ["-alpha", "Disassociate"], hex: "ffffffffffffffff", channels: "srgb  4.0" },
    { color: "#000100010001", operators: ["-alpha", "Disassociate"], hex: "ffffffffffffffff", channels: "srgb  4.0" },
    { color: "#123456ff", operators: ["-alpha", "Disassociate"], hex: "121234345656ffff", channels: "srgb  4.0" },
    { color: "#123456", operators: [], hex: "121234345656ffff", channels: "srgb  3.0" },
    { color: "#000100010001", operators: [], hex: "000100010001ffff", channels: "srgb  3.0" },
];

for (const execution of ["command", "retained", "buffered", "sync"] as const) {
    for (const output of ["rgba", "info"] as const) {
        it.each(cases)(`${execution}: ${output} for $color $operators`, async ({ color, operators, hex, channels }) => {
            const argv = [`xc:${color}`, ...operators, ...(output === "rgba"
                ? ["-depth", "16", "-endian", "MSB", `rgba:${execution === "command" ? "-" : "/out"}`]
                : ["-format", "%[channels]", "info:-"])];
            const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
            const args = createCommandArguments(argv);
            let stdout = "", stderr = "";
            const result = execution === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: { MAGICK_THREAD_LIMIT: "1" }, fs,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString(output === "rgba" ? "hex" : "utf8"); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : execution === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, execution === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const actual = execution === "command" ? stdout : output === "info" && "stdout" in result ? result.stdout
                : Buffer.from(execution === "retained" ? await fs.readFile("/out") : files.get("/out")!).toString("hex");
            expect(actual).toBe(output === "rgba" ? hex : channels);
        });
    }
}
