import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli } from "./index.js";

// Native ImageMagick retains disabled alpha for translucent splice fills,
// except for Off. Disassociate also discards alpha when the fill is opaque.
for (const execution of ["buffered", "retained", "command"]) {
    for (const depth of [8, 16]) {
        for (const background of ["#11223370", "black"]) {
            it.each(["deactivate", "discrete", "associate", "disassociate", "off", "on"])(
                `preserves splice source alpha (${execution}, ${depth}-bit, ${background}, %s)`,
                async alpha => {
                    const input = Buffer.from(depth === 8 ? "2020204040404080808080ff" : "202020202020401240404040404080ab808080808080ffff", "hex");
                    const files = new Map<string, Uint8Array>([["in.raw", input]]);
                    const filesystem = new MemoryFileSystem();
                    await filesystem.writeFile("/in.raw", input);
                    const args = ["-size", "3x1", "-depth", String(depth), "-endian", "MSB", "rgba:in.raw",
                        "-alpha", alpha, "-background", background, "-splice", "1x0+1+0",
                        "-alpha", "extract", "-depth", String(depth), "gray:out"];
                    if (execution === "command") {
                        const command = createMagickCommand(), argumentValues = createCommandArguments(args);
                        let stderr = "";
                        const result = await command.execute({ command: command.name, args: argumentValues.args, argumentValues,
                            cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
                            stdin: (async function* () {})(), stdout: { async write() {} },
                            stderr: { async write(data) { stderr += new TextDecoder().decode(data); } } });
                        expect(result.exitCode).toBe(0);
                        expect(stderr).toBe("");
                    } else {
                        const result = await runMagickCli(args, execution === "buffered" ? files : { filesystem, cwd: "/" });
                        expect(result.exitCode).toBe(0);
                        expect(result.stderr).toBe("");
                    }
                    const output = execution === "buffered" ? files.get("out")! : await filesystem.readFile("/out");
                    const opaque = alpha === "off" || alpha === "disassociate" && background === "black";
                    const fill = background === "black" ? "ff" : "70";
                    const expected = depth === 8
                        ? `${opaque ? "ff" : "40"}${fill}${opaque ? "ff" : "80"}ff`
                        : `${opaque ? "ffff" : "4012"}${fill.repeat(2)}${opaque ? "ffff" : "80ab"}ffff`;
                    expect(Buffer.from(output).toString("hex")).toBe(expected);
                }
            );
        }
    }
}
