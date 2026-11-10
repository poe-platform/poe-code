import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const option of ["-sigmoidal-contrast", "+sigmoidal-contrast"]) {
        for (const geometry of ["5x40%", "0", "%[fx:0]"]) {
            it.each(["before input", "empty group", "active image"])(`${mode}: ${option} ${geometry} with %s`, async location => {
                const input = new TextEncoder().encode("P3\n3 1\n255\n15 80 145 17 152 231 195 208 65\n");
                const original = new TextEncoder().encode("KEEP");
                const files = new Map([["a.ppm", input], ["out", original]]);
                const filesystem = new MemoryFileSystem();
                await filesystem.writeFile("/a.ppm", input);
                await filesystem.writeFile("/out", original);
                const operation = [option, geometry];
                const args = [...(location === "before input" ? [...operation, "a.ppm"] : location === "empty group" ? ["a.ppm", "(", ...operation, ")"] : ["a.ppm", ...operation]), "-depth", "8", "rgb:out"];
                let stderr = "";
                const result = mode === "command" ? await createMagickCommand().execute({
                    command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
                    stdin: (async function* () {})(), signal: new AbortController().signal,
                    stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
                }) : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
                const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("out");
                if (location === "active image") {
                    expect(result.exitCode).toBe(0);
                    // Native ImageMagick:, depth 8 RGB.
                    expect(output).toEqual(Uint8Array.from(geometry !== "5x40%" ? [15, 80, 145, 17, 152, 231, 195, 208, 65] : option === "-sigmoidal-contrast" ? [11, 84, 177, 12, 186, 247, 227, 235, 63] : [20, 77, 121, 23, 126, 201, 160, 172, 66]));
                } else {
                    expect(result.exitCode).toBe(1);
                    expect("stderr" in result ? result.stderr : stderr).toContain(`no images found for operation '${option}'`);
                    expect(output).toEqual(original);
                }
            });
        }
    }
}
