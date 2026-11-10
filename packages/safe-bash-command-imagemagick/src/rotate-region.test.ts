import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Full RGBA references from native ImageMagick 7.1.2-31 Q16-HDRI.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAFklEQVR4nGNk4AoQYfwPQSwBLH+wcwDgmQy4H07nKQAAAABJRU5ErkJggg==", "base64");
const fixtures = [
    { angle: 0, negate: false, width: 4, height: 3, expected: "000a50ff140b4fff280c4eff3c0d4dff500e4cff640f4bff78104aff8c1149ffa01248ffb41347ffc81446ffdc1545ff" },
    { angle: 0, negate: true, width: 4, height: 3, expected: "000a50ffebf4b0ffd7f3b1ff3c0d4dff500e4cff9bf0b4ff87efb5ff8c1149ffa01248ffb41347ffc81446ffdc1545ff" },
    { angle: 90, negate: false, width: 3, height: 4, expected: "a01248ff500e4cff000a50ffb41347ff640f4bff140b4fffc81446ff78104aff280c4effdc1545ff8c1149ff3c0d4dff" },
    { angle: 90, negate: true, width: 3, height: 4, expected: "a01248ff500e4cff000a50ffb41347ff9bf0b4ffebf4b0ffc81446ff87efb5ffd7f3b1ffdc1545ff8c1149ff3c0d4dff" },
    { angle: 180, negate: false, width: 4, height: 3, expected: "dc1545ffc81446ffb41347ffa01248ff8c1149ff78104aff640f4bff500e4cff3c0d4dff280c4eff140b4fff000a50ff" },
    { angle: 180, negate: true, width: 4, height: 3, expected: "dc1545ffc81446ffb41347ffa01248ff8c1149ff87efb5ff9bf0b4ff500e4cff3c0d4dffd7f3b1ffebf4b0ff000a50ff" },
    { angle: 270, negate: false, width: 3, height: 4, expected: "3c0d4dff8c1149ffdc1545ff280c4eff78104affc81446ff140b4fff640f4bffb41347ff000a50ff500e4cffa01248ff" },
    { angle: 270, negate: true, width: 3, height: 4, expected: "3c0d4dff8c1149ffdc1545ffd7f3b1ff87efb5ffc81446ffebf4b0ff9bf0b4ffb41347ff000a50ff500e4cffa01248ff" },
    { angle: -90, negate: false, width: 3, height: 4, expected: "3c0d4dff8c1149ffdc1545ff280c4eff78104affc81446ff140b4fff640f4bffb41347ff000a50ff500e4cffa01248ff" },
    { angle: -90, negate: true, width: 3, height: 4, expected: "3c0d4dff8c1149ffdc1545ffd7f3b1ff87efb5ffc81446ffebf4b0ff9bf0b4ffb41347ff000a50ff500e4cffa01248ff" },
    { angle: 450, negate: false, width: 3, height: 4, expected: "a01248ff500e4cff000a50ffb41347ff640f4bff140b4fffc81446ff78104aff280c4effdc1545ff8c1149ff3c0d4dff" },
    { angle: 450, negate: true, width: 3, height: 4, expected: "a01248ff500e4cff000a50ffb41347ff9bf0b4ffebf4b0ffc81446ff87efb5ffd7f3b1ffdc1545ff8c1149ff3c0d4dff" },
];
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each(fixtures)(`rotates the raster and active region: $angle degrees, negate=$negate (${mode})`, async fixture => {
        const keep = new TextEncoder().encode("KEEP");
        const files = new Map<string, Uint8Array>([["/input.png", input], ["/output.png", keep]]), fs = new MemoryFileSystem();
        await fs.writeFile("/input.png", input);
        await fs.writeFile("/output.png", keep);
        const args = ["/input.png", "-region", "2x2+1+0", "-rotate", String(fixture.angle), ...(fixture.negate ? ["-negate"] : []), "+region", "/output.png"];
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result).toMatchObject({ exitCode: 0 });
        const output = decodeImage(mode === "sync" || mode === "buffered" ? files.get("/output.png")! : await fs.readFile("/output.png"));
        expect(output).toMatchObject({ width: fixture.width, height: fixture.height });
        expect(Buffer.from(output.data).toString("hex")).toBe(fixture.expected);
    });
}
