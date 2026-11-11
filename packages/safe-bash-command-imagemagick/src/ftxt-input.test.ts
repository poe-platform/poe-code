import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { decodeImage } from "@poe-code/image-ast/portable";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained"] as const) {
    it.each([
        { operand: "ftxt:/rgb.dat", format: undefined },
        { operand: "ftxt:-", format: undefined },
        { operand: "ftxt:/rgb.dat", format: "\\x/\\y=\\c\\n" },
        { operand: "ftxt:-", format: "\\x/\\y=\\c\\n" },
        { operand: "ftxt:/rgb.dat", format: "pixel(\\y;\\x)\\t[\\c]\\r\\n" }
    ])(`decodes Q16 FTXT pixels via ${mode}: $operand $format`, async ({ operand, format }) => {
        const text = format?.startsWith("pixel") ? "pixel(0;0)\t[65535,0,0]\r\n pixel(0;1)\t[0,32768,65535]\r\n" : format ? "0/0=65535,0,0\n1/0=0,32768,65535\n" : "0,0:65535,0,0\n1,0:0,32768,65535\n";
        const bytes = new TextEncoder().encode(text);
        const files = new Map([["/rgb.dat", bytes]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/rgb.dat", bytes);
        const args = ["-size", "2x1", ...(format ? ["-define", `ftxt:format=${format}`] : []), operand, "/out.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files, bytes) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files, bytes);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        const image = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        expect([image.width, image.height]).toEqual([2, 1]);
        expect(Array.from(image.data)).toEqual([255, 0, 0, 255, 0, 128, 255, 255]);
        expect(Array.from(image.data16!)).toEqual([65535, 0, 0, 65535, 0, 32768, 65535, 65535]);
    });
}

for (const retained of [false, true]) {
    it(`reads FTXT across chunk boundaries (${retained})`, async () => {
        const width = 2000;
        const bytes = new TextEncoder().encode(Array.from({ length: width }, (_, x) => `${x}/0=${x},32768,65535`).join("\n"));
        const files = new Map([["/in", bytes]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in", bytes);
        const result = await runConvertCli(["-size", `${width}x1`, "-define", "ftxt:format=\\x/\\y=\\c\\n", "ftxt:/in", "/out.png"], retained ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        const image = decodeImage(retained ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        expect(Array.from(image.data16!)).toEqual(Array.from({ length: width }, (_, x) => [x, 32768, 65535, 65535]).flat());
    });

    it.each([
        { size: ["-size", "1x1", "-define", "ftxt:format=\\x/\\y=\\c\\n"], text: "0/0=0,,0\n", error: "invalid FTXT pixel" },
        { size: ["-size", "1x1", "-define", "ftxt:format=\\x/\\y=\\c\\n"], text: "0,0:65535,0,0\n", error: "invalid FTXT pixel" },
        { size: [], text: "0,0:65535,0,0\n", error: "must specify image size" },
        { size: ["-size", "2x1"], text: "0,0:65535,0,0\n", error: "truncated FTXT" },
        { size: ["-size", "1x1"], text: "0,0:65536,0,0\n", error: "invalid FTXT pixel" },
        { size: ["-size", "1x1"], text: "0,0:0,,0\n", error: "invalid FTXT pixel" },
        { size: ["-size", "1x1"], text: "1,0:65535,0,0\n", error: "invalid FTXT pixel" }
    ])(`preserves output on invalid FTXT (${retained}): $error`, async ({ size, text, error }) => {
        const bytes = new TextEncoder().encode(text), original = Uint8Array.of(42);
        const files = new Map([["/in", bytes], ["/out.png", original]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in", bytes);
        await filesystem.writeFile("/out.png", original);
        const result = await runConvertCli([...size, "ftxt:/in", "/out.png"], retained ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain(error);
        expect(retained ? await filesystem.readFile("/out.png") : files.get("/out.png")).toEqual(original);
    });
}

it.each([false, true])("reads the writer's RGB rows through the public command (custom: %s)", async custom => {
    const filesystem = new MemoryFileSystem();
    const format = custom ? ["-define", "ftxt:format=\\x/\\y=\\c\\n"] : [];
    let stdout: number[] = [], stderr = "";
    const context = {
        command: "magick", cwd: "/", env: {}, fs: filesystem,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(bytes: Uint8Array) { stdout.push(...bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    };
    const writer = await createMagickCommand().execute({ ...context,
        args: createCommandArguments(["xc:red", "xc:blue", "+append", ...format, "ftxt:/pixels.dat"]).args
    });
    expect(writer.exitCode, stderr).toBe(0);
    expect(new TextDecoder().decode(await filesystem.readFile("/pixels.dat"))).toBe(custom ? "0/0=65535,0,0\n1/0=0,0,65535\n" : "0,0:65535,0,0\n1,0:0,0,65535\n");
    stdout = [];
    const reader = await createMagickCommand().execute({ ...context,
        args: createCommandArguments(["-size", "2x1", ...format, "ftxt:/pixels.dat", "-depth", "8", "rgba:-"]).args
    });
    expect(reader.exitCode, stderr).toBe(0);
    expect(stderr).toBe("");
    expect(Buffer.from(stdout).toString("hex")).toBe("ff0000ff0000ffff");
});
