import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI ordering for the 4x3 RGB input.
// Pixel i is (20*i, 10+i, 80-i); expected bytes include all RGBA channels.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAFklEQVR4nGNk4AoQYfwPQSwBLH+wcwDgmQy4H07nKQAAAABJRU5ErkJggg==", "base64");
const cases = [
    { geometry: "2x2+1+0", operations: ["-transpose", "-negate"], width: 3, height: 4, rgba: "000a50ff500e4cffa01248ffebf4b0ff9bf0b4ffb41347ffd7f3b1ff87efb5ffc81446ff3c0d4dff8c1149ffdc1545ff" },
    { geometry: "2x2+1+0", operations: ["-transpose"], width: 3, height: 4, rgba: "000a50ff500e4cffa01248ff140b4fff640f4bffb41347ff280c4eff78104affc81446ff3c0d4dff8c1149ffdc1545ff" },
    { geometry: "2x2+1+0", operations: ["-transverse", "-negate"], width: 3, height: 4, rgba: "dc1545ff8c1149ff3c0d4dffc81446ff87efb5ffd7f3b1ffb41347ff9bf0b4ffebf4b0ffa01248ff500e4cff000a50ff" },
    { geometry: "2x2+1+0", operations: ["-transverse"], width: 3, height: 4, rgba: "dc1545ff8c1149ff3c0d4dffc81446ff78104aff280c4effb41347ff640f4bff140b4fffa01248ff500e4cff000a50ff" },
    { geometry: "2x2+1+0", operations: ["-negate"], width: 4, height: 3, rgba: "000a50ffebf4b0ffd7f3b1ff3c0d4dff500e4cff9bf0b4ff87efb5ff8c1149ffa01248ffb41347ffc81446ffdc1545ff" },
    // A non-square selection also checks that region width and height swap.
    { geometry: "1x2+2+0", operations: ["-transpose", "-negate"], width: 3, height: 4, rgba: "000a50ff500e4cffa01248ff140b4fff640f4bffb41347ffd7f3b1ff87efb5ffc81446ff3c0d4dff8c1149ffdc1545ff" },
    { geometry: "1x2+2+0", operations: ["-transverse", "-negate"], width: 3, height: 4, rgba: "dc1545ff8c1149ff3c0d4dffc81446ff87efb5ffd7f3b1ffb41347ff640f4bff140b4fffa01248ff500e4cff000a50ff" },
];

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each(cases)(`moves the active $geometry region with $operations (${mode})`, async ({ geometry, operations, width, height, rgba }) => {
        const keep = new TextEncoder().encode("KEEP");
        const files = new Map<string, Uint8Array>([["/input.png", input], ["/out.png", keep]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/input.png", input);
        await fs.writeFile("/out.png", keep);
        const args = ["/input.png", "-region", geometry, ...operations, "+region", "/out.png"];
        let stderr = "";
        const argumentValues = createCommandArguments(args);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result).toMatchObject({ exitCode: 0 });
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = decodeImage(mode === "buffered" || mode === "sync" ? files.get("/out.png")! : await fs.readFile("/out.png"));
        expect(output).toMatchObject({ width, height });
        expect(Buffer.from(output.data).toString("hex")).toBe(rgba);
    });
}
