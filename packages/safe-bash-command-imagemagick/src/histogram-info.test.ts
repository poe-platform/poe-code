import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

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
            expect(comment.stdout).toContain("#FF0000");
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
