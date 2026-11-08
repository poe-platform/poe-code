import { expect, it } from "vitest";
import { encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    for (const operator of ["-black-threshold", "-white-threshold"]) {
        it.each(["bogus", "50%junk", "50%"])(`${mode} ${operator} validates %s before replacing output`, async threshold => {
            const input = encodeImage({ width: 1, height: 1, data: Uint8Array.from([100, 150, 200, 160]), format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true }, { format: "png" }).data;
            const destination = encodeImage({ width: 1, height: 1, data: Uint8Array.from([255, 0, 0, 255]), format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true }, { format: "png" }).data;
            const files = new Map([["input.png", input], ["out.png", destination]]);
            const filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/input.png", input);
            await filesystem.writeFile("/out.png", destination);
            const argv = ["input.png", "-channel", "RGBA", operator, threshold, "out.png"];
            const args = createCommandArguments(argv);
            let stderr = "";
            const result = mode === "command"
                ? await createMagickCommand().execute({
                    command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, signal: new AbortController().signal,
                    stdin: (async function* () {})(), stdout: { async write() {} },
                    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } },
                    registerCleanup() {}, fs: filesystem,
                } as unknown as CommandContext)
                : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
            const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png");
            if (threshold === "50%") {
                expect(result.exitCode).toBe(0);
                expect(output).not.toEqual(destination);
            } else {
                expect(result.exitCode).toBe(1);
                expect("stderr" in result ? result.stderr : stderr).toContain(operator);
                expect(output).toEqual(destination);
            }
        });
    }
}
