import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: the complete raw RGBA8 raster.
const native = {
    edge: "2c234b6fad8a98d1",
    tile: "0f0c3965b4909cdb",
    mirror: "251d466caf8c99d4",
    transparent: "4a3b5ccda38292ff",
    black: "ffffff29ffffff9d",
    white: "0000002942001f9d",
    gray: "00000029c785a49d",
    background: "6a3b4c7bd29b9bee",
    "horizontal-tile": "59314775cd999cec",
    "vertical-tile": "472b4873c1949ae1",
    "checker-tile": "4e2c4572c9989ce9",
    "horizontal-tile-edge": "0f0c3965b4909cdb",
    "vertical-tile-edge": "2c234b6fad8a98d1",
};

const input = ["xc:#50406080", "xc:#a08090c0", "+append"];
const cases = [...Object.keys(native), "unset", "reset"].map(method => ({
    name: method,
    args: [...input, "-background", "#193b7580",
        ...(method === "unset" ? [] : ["-virtual-pixel", method === "reset" ? "tile" : method]),
        ...(method === "reset" ? ["+virtual-pixel"] : []), "-sharpen", "0x1"],
    expected: native[method === "unset" ? "edge" : method === "reset" ? "tile" : method as keyof typeof native],
}));
cases.push(
    { name: "background before input", args: ["-background", "#193b7580", "-virtual-pixel", "background", ...input, "-sharpen", "0x1"], expected: native.background },
    { name: "default background", args: [...input, "-virtual-pixel", "background", "-sharpen", "0x1"], expected: native.white },
    { name: "vertical tile", args: ["xc:#50406080", "xc:#a08090c0", "-append", "-virtual-pixel", "tile", "-sharpen", "0x1"], expected: native.tile },
    { name: "opaque transparent", args: ["xc:#504060", "xc:#a08090", "+append", "-virtual-pixel", "transparent", "-sharpen", "0x1"], expected: "4c3d5effa48392ff" },
    { name: "2d mirror", args: ["-size", "3x2", "gradient:#50406080-#a08090c0", "-virtual-pixel", "mirror", "-sharpen", "0x1"], expected: "251d466c251d466c251d466caf8c99d4af8c99d4af8c99d4" },
    { name: "2d tile", args: ["-size", "3x2", "gradient:#50406080-#a08090c0", "-virtual-pixel", "tile", "-sharpen", "0x1"], expected: "0f0c39650f0c39650f0c3965b4909cdbb4909cdbb4909cdb" },
);

for (const [method, expected] of [
    ["tile", "3f1f4970c69099d0ffff00010f56a1ff"],
    ["mirror", "402e577bbd8c94c5ffa8001a15579eff"],
    ["background", "5735537cca9498d7ffff00121b5ca0ff"],
] as const) cases.push({
    name: `2d ${method} explicit radius`,
    args: ["(", ...input, ")", "(", "xc:#80701040", "xc:#235a98ff", "+append", ")", "-append",
        "-background", "#193b7580", "-virtual-pixel", method, "-sharpen", "2.3x0.7"],
    expected,
});

for (const mode of ["command", "sync", "buffered", "retained"] as const) {
    it.each(cases)(`${mode}: sharpens with $name virtual pixels`, async ({ args: operations, expected }) => {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const args = [...operations,
            // Later settings must not alter an earlier operation.
            "-virtual-pixel", "white", "-background", "red", "-depth", "8", "rgba:/out.rgba"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(), stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result, stderr).toMatchObject({ exitCode: 0 });
        const output = mode === "sync" || mode === "buffered" ? files.get("/out.rgba")! : await fs.readFile("/out.rgba");
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
