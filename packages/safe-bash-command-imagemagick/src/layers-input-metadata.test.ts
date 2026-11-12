import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = Buffer.from("50360a3220310a3235350a0a141e5a6e82", "hex");

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const operation of [["-flatten"], ["-mosaic"], ["-layers", "merge"], ["-layers", "flatten"], ["-layers", "mosaic"], []]) {
        for (const output of ["-", "ppm:-", "info:"]) {
            it(`${mode}: ${operation.join(" ") || "input control"} preserves input metadata for ${output}`, async () => {
                const args = ["/in.ppm", ...(operation.length ? ["-repage", "3x1+1+0", "(", "xc:red", "-repage", "3x1+2+0", ")", ...operation] : []),
                    ...(output === "info:" ? ["-format", "%f|%m|%G|%b"] : []), output];
                const files = new Map<string, Uint8Array>([["/in.ppm", input]]);
                const fs = new MemoryFileSystem();
                await fs.writeFile("/in.ppm", input);
                const argumentValues = createCommandArguments(args);
                const chunks: Uint8Array[] = [];
                let stderr = "";
                const result = mode === "command" ? await createMagickCommand().execute({
                    command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                    stdin: (async function* () {})(), signal: new AbortController().signal,
                    stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
                    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
                }) : mode === "sync" ? runConvertCliSync(args, files)
                    : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
                expect(result.exitCode).toBe(0);
                expect(mode === "command" ? stderr : ("stderr" in result ? result.stderr : "")).toBe("");
                const expected = output === "info:" ? "in.ppm|PPM|2x1|17B"
                    : operation.includes("merge") ? "50360a3220310a3235350a0a141eff0000"
                    : operation.length ? "50360a3320310a3235350affffff0a141eff0000" : input.toString("hex");
                const actual = mode === "command" ? Buffer.concat(chunks)
                    : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? Buffer.from(result.stdoutBytes)
                    : Buffer.from("stdout" in result && typeof result.stdout === "string" ? result.stdout : "");
                expect(output === "info:" ? actual.toString() : actual.toString("hex")).toBe(expected);
            });
        }
    }
}
