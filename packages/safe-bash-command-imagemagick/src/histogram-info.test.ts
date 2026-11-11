import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import sharp from "@poe-code/image-ast";
import { runConvertCli } from "./index.js";

it.each(["memory", "retained", "streamed"])("reports every image histogram in input order (%s)", async mode => {
    const rgb = await sharp(new Uint8Array([255, 0, 0, 255, 0, 0, 255, 0, 0, 0, 255, 0, 0, 255, 0, 0, 0, 255]), { raw: { width: 6, height: 1, channels: 3 } }).png().toBuffer();
    const rgba = await sharp(new Uint8Array([255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 255, 0, 255, 0, 0, 0, 0, 255, 0, 255, 0, 0, 128]), { raw: { width: 6, height: 1, channels: 4 } }).png().toBuffer();
    const files = new Map([["rgb.png", rgb], ["rgba.png", rgba]]);
    const filesystem = new MemoryFileSystem(), chunks: Uint8Array[] = [];
    for (const [name, bytes] of files) await filesystem.writeFile(`/${name}`, bytes);
    const input = mode === "memory" ? files : { filesystem, cwd: "/" };
    const reports: string[] = [];
    for (const name of files.keys()) {
        const report = await runConvertCli([name, "-format", "%c", "histogram:info:-"], input);
        expect(report).toMatchObject({ exitCode: 0, stderr: "" });
        reports.push(report.stdout);
    }
    expect(reports.map(report => report.trim().split("\n").length)).toEqual([3, 5]);
    const expected = reports.join("");
    const outputInput = mode === "streamed" ? { filesystem, cwd: "/", stdout: { async write(bytes: Uint8Array) { chunks.push(bytes.slice()); } } } : input;
    const args = ["rgb.png", "rgba.png", "-format", "%c"];
    expect(await runConvertCli([...args, "histogram:info:-"], outputInput)).toEqual({ exitCode: 0, stdout: mode === "streamed" ? "" : expected, stderr: "" });
    if (mode === "streamed") expect(new TextDecoder().decode(Buffer.concat(chunks))).toBe(expected);
    expect([...files.keys()]).toEqual(["rgb.png", "rgba.png"]);
    expect((await filesystem.readdir("/")).map(entry => entry.name).sort()).toEqual(["rgb.png", "rgba.png"]);
    expect(await runConvertCli([...args, "histogram:info:out.txt"], outputInput)).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(new TextDecoder().decode(mode === "memory" ? files.get("out.txt") : await filesystem.readFile("/out.txt"))).toBe(expected);
});

for (const retained of [false, true]) {
    it.each([
        ["%wx%h", "256x200"],
        ["", ""],
        ["%wx%h:%c", "comment"],
        [undefined, "256x200 sRGB 8-bit\n"],
        ["%c", "comment"],
    ])(`formats histogram INFO (retained=${retained}, format=%s)`, async (format, expected) => {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const input = retained ? { filesystem, cwd: "/" } : files;
        if (expected === "comment") {
            const comment = await runConvertCli(["xc:red", "-format", "%c", "histogram:info:-"], input);
            expect(comment.stdout).toContain("1:");
            expect(comment.stdout).toContain("#FFFF00000000");
            expected = (format === "%c" ? "" : "256x200:") + comment.stdout;
        }
        const args = ["xc:red", ...(format === undefined ? [] : ["-format", format])];
        const stdout = await runConvertCli([...args, "histogram:info:-"], input);
        expect(stdout).toEqual({ exitCode: 0, stdout: expected, stderr: "" });
        const file = await runConvertCli([...args, "histogram:info:out.txt"], input);
        expect(file).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        expect(new TextDecoder().decode(retained ? await filesystem.readFile("/out.txt") : files.get("out.txt"))).toBe(expected);
    });
}

it("streams formatted histogram INFO to the supplied sink", async () => {
    const filesystem = new MemoryFileSystem(), chunks: Uint8Array[] = [];
    expect(await runConvertCli(["xc:red", "-format", "%wx%h", "histogram:info:-"], {
        filesystem, cwd: "/", stdout: { async write(bytes) { chunks.push(bytes.slice()); } }
    })).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(new TextDecoder().decode(Buffer.concat(chunks))).toBe("256x200");
    expect(await filesystem.readdir("/")).toEqual([]);
});
