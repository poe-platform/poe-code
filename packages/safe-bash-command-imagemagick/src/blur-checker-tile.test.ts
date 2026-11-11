import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// RGB8 output from ImageMagick 7.1.2-35 Q16-HDRI.
const cases = [
    { operator: "-gaussian-blur", geometry: "1x1", method: "checker-tile", expected: "7e7e7e" },
    { operator: "-gaussian-blur", geometry: "0x1", method: "checker-tile", expected: "7f7f7f" },
    { operator: "-gaussian-blur", geometry: "1x1", method: "background", expected: "cbcbcb" },
    { operator: "-gaussian-blur", geometry: "1x1", method: "tile", expected: "000000" },
    { operator: "-gaussian-blur", geometry: "1x1", method: "edge", expected: "000000" },
    { operator: "-blur", geometry: "1x1", method: "checker-tile", expected: "cdcdcd" },
    { operator: "-gaussian-blur", geometry: "0x1", method: "checker-tile", size: "2x3", expected: "717171717171636363636363717171717171" },
];

for (const mode of ["command", "sync", "buffered", "retained"] as const)
it.each(cases)(`${mode}: $operator $geometry with $method matches native`, async ({ operator, geometry, method, expected, size = "1x1" }) => {
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const args = ["-size", size, "xc:black", "-background", "white", "-virtual-pixel", method,
        operator, geometry, "-depth", "8", "rgb:/out.rgb"];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result, stderr).toMatchObject({ exitCode: 0 });
    const output = mode === "sync" || mode === "buffered" ? files.get("/out.rgb")! : await fs.readFile("/out.rgb");
    expect(Buffer.from(output).toString("hex")).toBe(expected);
});
