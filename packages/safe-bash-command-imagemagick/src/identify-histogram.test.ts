import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { encodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runIdentifyCli, runIdentifyCliSync } from "./index.js";

it.each(["sync", "sdk", "command"])("reports verbose color counts (%s)", async route => {
    const pixels = new Uint8Array(7 * 6 * 3);
    for (let y = 2; y <= 4; y++) for (let x = 1; x <= 4; x++) pixels.fill(255, (y * 7 + x) * 3, (y * 7 + x + 1) * 3);
    const bytes = await sharp(pixels, { raw: { width: 7, height: 6, channels: 3 } }).png().toBuffer();
    const filesystem = new MemoryFileSystem(), files = new Map([["/shape.png", bytes]]);
    await filesystem.writeFile("/shape.png", bytes);
    const args = ["-verbose", "/shape.png"];
    let result;
    if (route === "command") {
        const argumentValues = createCommandArguments(["identify", ...args]);
        let stdout = "", stderr = "";
        const status = await createMagickCommand().execute({ command: "magick", args: argumentValues.args, argumentValues,
            fs: filesystem, cwd: "/", env: {}, signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
        result = { ...status, stdout, stderr };
    } else result = route === "sync" ? runIdentifyCliSync(args, files) : await runIdentifyCli(args, { filesystem, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    expect(result.stdout).toContain("  Colors: 2\n  Histogram:\n");
    expect(result.stdout.split("\n").map(line => line.trim())).toEqual(expect.arrayContaining([
        "30: (0,0,0) #000000 black", "12: (255,255,255) #FFFFFF white"
    ]));
    expect((await runIdentifyCli(["/shape.png"], { filesystem, cwd: "/" })).stdout).not.toContain("Histogram:");
    expect((await runIdentifyCli(["-verbose", "-format", "%k", "/shape.png"], { filesystem, cwd: "/" })).stdout).toBe("2");
    expect((await filesystem.readdir("/")).map(entry => entry.name)).toEqual(["shape.png"]);
});

it.each([false, true])("preserves distinct 16-bit colors and alpha (alpha=%s)", async hasAlpha => {
    const samples = [0x1234, 0x5678, 0x9abc, hasAlpha ? 0x1234 : 65535,
        0x1234, 0x5678, 0x9abc, hasAlpha ? 0x1234 : 65535,
        hasAlpha ? 0x1234 : 0x1235, 0x5678, 0x9abc, hasAlpha ? 0x1235 : 65535];
    const bytes = encodeImage({ width: 3, height: 1, depth: "ushort", density: 72, hasAlpha, channels: hasAlpha ? 4 : 3, space: "srgb", format: "png",
        data16: Uint16Array.from(samples), data: Uint8Array.from(samples, value => Math.round(value / 257)) }, { format: "png" }).data;
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/q.png", bytes);
    for (const result of [runIdentifyCliSync(["-verbose", "/q.png"], new Map([["/q.png", bytes]])), await runIdentifyCli(["-verbose", "/q.png"], { filesystem, cwd: "/" })]) {
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        expect(result.stdout).toContain("  Colors: 2\n");
        const bins = result.stdout.split("\n").filter(line => line.includes("#")).map(line => {
            const [count, rest] = line.trim().split(": ");
            return [Number(count), rest!.split(" ").find(part => part.startsWith("#"))];
        });
        expect(bins).toEqual(expect.arrayContaining(hasAlpha ? [[2, "#123456789ABC1234"], [1, "#123456789ABC1235"]] : [[2, "#123456789ABC"], [1, "#123556789ABC"]]));
    }
});
