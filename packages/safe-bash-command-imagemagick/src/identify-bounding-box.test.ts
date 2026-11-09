import { expect, it } from "vitest";
import sharp, { encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createIdentifyCommand, createMagickCommand, runIdentifyCli, runIdentifyCliSync } from "./index.js";

it.each(["striped", "transparent", "offset", "16-bit"] as const)("reports bounding-box coordinates for %s pixels", async fixture => {
    let bytes: Uint8Array;
    let expected: string;
    if (fixture === "striped") {
        bytes = new Uint8Array([
            ...new TextEncoder().encode("P6\n3 2\n255\n"),
            ...[255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 0, 0, 0, 255, 0, 0, 0, 255]
        ]);
        expected = "1,0 2,2";
    } else if (fixture === "transparent") {
        bytes = await sharp({ create: { width: 3, height: 2, channels: 4, background: "transparent" } }).png().toBuffer();
        expected = "3,2 3,2";
    } else {
        const data16 = new Uint16Array(7 * 6 * 4);
        for (let y = 0; y < 6; y++) for (let x = 0; x < 7; x++) {
            const value = x >= 1 && x <= 4 && y >= 2 && y <= 4 ? (fixture === "16-bit" ? 0x4020 : 65535) : 0x4000;
            data16.set([value, value, value, 65535], (y * 7 + x) * 4);
        }
        bytes = encodeImage({ width: 7, height: 6, data16,
            data: Uint8Array.from(data16, value => Math.round(value / 257)),
            format: "png", space: "srgb", channels: 3, depth: "ushort", density: 72, hasAlpha: false,
            virtualCanvas: { width: 20, height: 30, x: -2, y: 5 }
        }, { format: "png" }).data;
        expected = "1,2 5,5";
    }
    const fs = new MemoryFileSystem();
    await fs.writeFile("/image", bytes);
    const files = new Map([["/image", bytes]]);
    const args = ["-format", "%[bounding-box]|%[BOUNDING-BOX]|%%[bounding-box]", "/image"];
    const output = `${expected}|${expected}|%[bounding-box]`;
    const warning = fixture === "transparent" ? "magick: geometry does not contain image\n" : "";
    const results = [runIdentifyCliSync(args, files), await runIdentifyCli(args, files), await runIdentifyCli(args, { filesystem: fs, cwd: "/" })];
    for (const command of [createIdentifyCommand(), createMagickCommand()]) {
        const argumentValues = createCommandArguments(command.name === "magick" ? ["identify", ...args] : args);
        let stdout = "", stderr = "";
        const result = await command.execute({
            command: command.name, args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
            stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
        });
        results.push({ ...result, stdout, stderr });
    }
    for (const result of results) expect(result).toMatchObject({ exitCode: 0, stdout: output, stderr: warning });
    expect(await fs.readFile("/image")).toEqual(bytes);
});
