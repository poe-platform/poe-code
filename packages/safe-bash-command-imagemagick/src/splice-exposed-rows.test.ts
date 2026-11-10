import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, raw RGBA8 bytes.
const cases = [
    { name: "exposed row with edge", geometry: "0x1+0-1", method: "edge", hex: "ff0000ffff0000ff" },
    { name: "exposed row with transparent", geometry: "0x1+0-1", method: "transparent", hex: "00000000ff0000ff" },
    { name: "exposed row with background", geometry: "0x1+0-1", method: "background", hex: "0000ffffff0000ff" },
    { name: "inserted band covers row", geometry: "0x1+0+0", method: "edge", hex: "0000ffffff0000ff" },
    { name: "horizontal edge extension", geometry: "1x0-1+0", method: "edge", hex: "ff0000ffff0000ff" },
    { name: "partially clipped band with edge", geometry: "0x2+0-1", method: "edge", hex: "0000ffffff0000ffff0000ff" },
    { name: "partially clipped band with transparent", geometry: "0x2+0-1", method: "transparent", hex: "0000ffff00000000ff0000ff" },
    { name: "partially clipped band with background", geometry: "0x2+0-1", method: "background", hex: "0000ffff0000ffffff0000ff" },
];

for (const mode of ["buffered", "retained", "sync", "command"]) {
    it.each(cases)(`uses native splice virtual pixels: $name (${mode})`, async ({ geometry, method, hex }) => {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const args = ["xc:red", "-background", "blue", "-virtual-pixel", method, "-splice", geometry, "-depth", "8", "rgba:/out"];
        const argumentValues = createCommandArguments(args);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect({ exitCode: result.exitCode, stderr: "stderr" in result ? result.stderr : stderr }).toEqual({ exitCode: 0, stderr: "" });
        const bytes = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(bytes).toString("hex")).toBe(hex);
    });
}
