import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const option of ["-sigmoidal-contrast", "+sigmoidal-contrast"]) {
        it.each(["5+30+2", "5+30", "5-30-2", "+30+2", "5%+30", "5!+30", "5+30%", "5+30!"])(`${mode}: ${option} rejects %s without changing output`, async geometry => {
            const original = new TextEncoder().encode("KEEP");
            const files = new Map([["out", original]]);
            const filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/out", original);
            const argv = ["xc:#345caa", option, geometry, "-depth", "8", "rgb:out"];
            const args = createCommandArguments(argv);
            let stdout = "", stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs: filesystem,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }) : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode).toBe(1);
            expect("stderr" in result ? result.stderr : stderr).toContain(`invalid argument for option '${option}'`);
            expect("stdout" in result ? result.stdout : stdout).toBe("");
            expect(mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("out")).toEqual(original);
        });

        it.each([
            ["5x40+30+2", "79b9f1", "152651"],
            ["5x40%+30+2", "2f66ce", "38568b"],
            ["5", "214dbb", "47679d"],
            ["+5", "214dbb", "47679d"],
            ["5e+0", "214dbb", "47679d"]
        ])(`${mode}: ${option} preserves valid geometry %s`, async (geometry, forward, inverse) => {
            // Native ImageMagick 7.1.2-35 Q16-HDRI with this color and depth.
            const argv = ["xc:#345caa", option, geometry, "-depth", "8", "rgb:out"];
            const files = new Map<string, Uint8Array>();
            const filesystem = new MemoryFileSystem();
            const args = createCommandArguments(argv);
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs: filesystem,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write() {} }
            }) : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("out")!;
            expect(Buffer.from(output).toString("hex")).toBe(option === "-sigmoidal-contrast" ? forward : inverse);
        });
    }
}
