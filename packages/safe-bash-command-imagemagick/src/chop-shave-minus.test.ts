import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI warns and preserves the image for both geometries.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    for (const operation of ["-chop", "-shave"]) {
        for (const format of ["info", "rgba"]) {
            it.each(["-", "3x2", "+"])(`handles ${operation} %s writing ${format} (${mode})`, async geometry => {
                const files = new Map([["/out", new TextEncoder().encode("KEEP")]]);
                const filesystem = new MemoryFileSystem();
                await filesystem.writeFile("/out", files.get("/out")!);
                const argv = ["-size", "3x2", "xc:red", operation, geometry,
                    "-format", "%wx%h", "-depth", "8", `${format}:/out`];
                const args = createCommandArguments(argv);
                let stderr = "";
                const result = mode === "command" ? await createMagickCommand().execute({
                    command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs: filesystem,
                    stdin: (async function* () {})(), signal: new AbortController().signal,
                    stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
                }) : mode === "sync" ? runMagickCliSync(argv, files)
                    : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
                const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out") : files.get("/out")!;
                const diagnostic = "stderr" in result ? result.stderr : stderr;
                if (geometry === "+") {
                    expect(result.exitCode).toBe(1);
                    expect(diagnostic).toContain(`invalid argument for option '${operation}': +`);
                    expect(new TextDecoder().decode(output)).toBe("KEEP");
                } else {
                    expect(result.exitCode).toBe(0);
                    expect(diagnostic).toBe(`magick: geometry does not contain image '${operation === "-shave" ? "red" : geometry}'\n`);
                    expect(output).toEqual(format === "info"
                        ? new TextEncoder().encode("3x2")
                        : Uint8Array.from({ length: 24 }, (_, index) => index % 4 === 0 || index % 4 === 3 ? 255 : 0));
                }
            });
        }
    }
}
