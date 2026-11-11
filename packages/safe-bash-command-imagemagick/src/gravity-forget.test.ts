import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2 Q16-HDRI: Forget resets gravity to None.
const cases = [
    { operation: "-splice", geometry: ["1x0+0+0", "0x1+0+0"],
        origin: "000000ff2020204040404080808080ff", center: "20202040000000ff40404080808080ff" },
    { operation: "-chop", geometry: ["1x0+0+0", "0x1+0+0"],
        origin: "40404080808080ff", center: "20202040808080ff" },
    { operation: "-extent", geometry: ["5x1", "1x5"],
        origin: "080808ff202020ff808080ff000000ff000000ff", center: "000000ff080808ff202020ff808080ff000000ff" },
] as const;

for (const mode of ["sync", "buffered", "retained", "command"] as const)
for (const [axis, size] of ["3x1", "1x3"].entries())
for (const gravity of ["Forget", "fOrGeT", "None", "Center"])
it.each(cases)(`positions $operation with ${gravity} gravity on ${size} (${mode})`, async ({ operation, geometry, origin, center }) => {
    const input = Buffer.from("2020204040404080808080ff", "hex");
    const files = new Map([["/in.raw", input]]);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.raw", input);
    const argv = ["-size", size, "-depth", "8", "rgba:/in.raw",
        "-gravity", "Center", "-gravity", gravity, "-background", "black",
        operation, geometry[axis]!, "-depth", "8", "rgba:-"];
    let output: Uint8Array;
    if (mode === "command") {
        const argumentValues = createCommandArguments(argv);
        const stdout: Uint8Array[] = [];
        let stderr = "";
        const result = await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues,
            fs: filesystem, cwd: "/", env: {}, signal: new AbortController().signal,
            stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout.push(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        });
        expect({ exitCode: result.exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
        output = Buffer.concat(stdout);
    } else {
        const result = mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        output = result.stdoutBytes!;
    }
    expect(Buffer.from(output).toString("hex")).toBe(gravity === "Center" ? center : origin);
});
