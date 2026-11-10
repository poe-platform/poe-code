import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync, runMogrifyCli } from "./index.js";

// Opaque 4x3 RGB fixture; ImageMagick mirrors the whole raster and its selection.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAFklEQVR4nGNk4AoQYfwPQSwBLH+wcwDgmQy4H07nKQAAAABJRU5ErkJggg==", "base64");
const cases = [
    { operations: ["-region", "2x2+1+0", "-flip", "+region"], rgba: "a01248ffb41347ffc81446ffdc1545ff500e4cff640f4bff78104aff8c1149ff000a50ff140b4fff280c4eff3c0d4dff" },
    { operations: ["-region", "2x2+1+0", "-flop", "+region"], rgba: "3c0d4dff280c4eff140b4fff000a50ff8c1149ff78104aff640f4bff500e4cffdc1545ffc81446ffb41347ffa01248ff" },
    { operations: ["-region", "2x2+1+0", "-flip", "-negate", "+region"], rgba: "a01248ffb41347ffc81446ffdc1545ff500e4cff9bf0b4ff87efb5ff8c1149ff000a50ffebf4b0ffd7f3b1ff3c0d4dff" },
    { operations: ["-region", "2x2+1+0", "-flop", "-negate", "+region"], rgba: "3c0d4dffd7f3b1ffebf4b0ff000a50ff8c1149ff87efb5ff9bf0b4ff500e4cffdc1545ffc81446ffb41347ffa01248ff" },
    { operations: ["-flip"], rgba: "a01248ffb41347ffc81446ffdc1545ff500e4cff640f4bff78104aff8c1149ff000a50ff140b4fff280c4eff3c0d4dff" },
    { operations: ["-flop"], rgba: "3c0d4dff280c4eff140b4fff000a50ff8c1149ff78104aff640f4bff500e4cffdc1545ffc81446ffb41347ffa01248ff" },
    { operations: ["-region", "2x2+1+0", "-negate", "+region"], rgba: "000a50ffebf4b0ffd7f3b1ff3c0d4dff500e4cff9bf0b4ff87efb5ff8c1149ffa01248ffb41347ffc81446ffdc1545ff" },
    { operations: ["-region", "1x2+0+0", "-flop", "-negate", "+region"], rgba: "3c0d4dff280c4eff140b4ffffff5afff8c1149ff78104aff640f4bffaff1b3ffdc1545ffc81446ffb41347ffa01248ff" },
    { operations: ["-region", "2x2+1+0", "-flip", "-flip", "-negate", "+region"], rgba: "000a50ffebf4b0ffd7f3b1ff3c0d4dff500e4cff9bf0b4ff87efb5ff8c1149ffa01248ffb41347ffc81446ffdc1545ff" },
    { operations: ["-region", "1x2+0+0", "-flip", "-flop", "-negate", "+region"], rgba: "dc1545ffc81446ffb41347ffa01248ff8c1149ff78104aff640f4bffaff1b3ff3c0d4dff280c4eff140b4ffffff5afff" },
];

for (const mode of ["buffered", "retained", "sync", "command", "mogrify"] as const) {
    it.each(cases)(`mirrors pixels and the active region in ${mode}: $operations`, async ({ operations, rgba }) => {
        const files = new Map<string, Uint8Array>([["/input.png", input], ["/out.png", new TextEncoder().encode("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
        const args = ["/input.png", ...operations, "/out.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : mode === "mogrify" ? await runMogrifyCli([...operations, "/input.png"], { filesystem, cwd: "/" })
            : await runConvertCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
        expect(result).toMatchObject({ exitCode: 0 });
        if (mode === "command") expect(stderr).toBe("");
        else expect(result).toMatchObject({ stderr: "" });
        const bytes = mode === "buffered" || mode === "sync" ? files.get("/out.png")!
            : await filesystem.readFile(mode === "mogrify" ? "/input.png" : "/out.png");
        const output = decodeImage(bytes);
        expect(output).toMatchObject({ width: 4, height: 3 });
        expect(Buffer.from(output.data).toString("hex")).toBe(rgba);
    });
}
