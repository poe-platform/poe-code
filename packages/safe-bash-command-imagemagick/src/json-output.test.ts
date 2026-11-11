import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

for (const retained of [false, true]) {
    it.each(["json:report.json", "JSON:report.json", "report.json", "json:-", "json:"])(`writes JSON image descriptions (retained=${retained}, %s)`, async destination => {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const result = await runConvertCli(["-size", "3x2", "xc:red", "-format", "%wx%h", "-depth", "8", destination], retained ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect(result.stderr).toBe("");
        const stdout = destination === "json:-" || destination === "json:";
        const text = stdout ? result.stdout : new TextDecoder().decode(retained ? await fs.readFile("/report.json") : files.get("report.json"));
        expect(JSON.parse(text)).toMatchObject([{ version: "1.0", image: { format: "XC", geometry: { width: 3, height: 2, x: 0, y: 0 } } }]);
        expect(retained ? (await fs.readdir("/")).map(entry => entry.name) : [...files.keys()]).toEqual(stdout ? [] : ["report.json"]);
        if (!stdout) expect(result.stdout).toBe("");
        expect(result.stdoutBytes).toBeUndefined();
    });

    it.each(["-write", "+write"])(`keeps pixels unchanged by intermediate JSON output (retained=${retained}, %s)`, async write => {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const result = await runConvertCli(["-size", "3x2", "xc:red", "-format", "%wx%h", "-depth", "8", write, "json:report.json", "-negate", "rgb:end.raw"], retained ? { filesystem: fs, cwd: "/" } : files);
        expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const report = retained ? await fs.readFile("/report.json") : files.get("report.json");
        expect(JSON.parse(new TextDecoder().decode(report))).toMatchObject([{ version: "1.0", image: { format: "XC", geometry: { width: 3, height: 2, x: 0, y: 0 } } }]);
        expect(retained ? await fs.readFile("/end.raw") : files.get("end.raw")).toEqual(Uint8Array.from({ length: 18 }, (_, index) => index % 3 === 0 ? 0 : 255));
        expect((retained ? (await fs.readdir("/")).map(entry => entry.name) : [...files.keys()]).sort()).toEqual(["end.raw", "report.json"]);
    });
}

for (const retained of [false, true]) {
    it(`describes each source frame and safely escapes properties (retained=${retained})`, async () => {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const input = retained ? { filesystem: fs, cwd: "/" } : files;
        expect((await runConvertCli(["-size", "2x1", "xc:blue", "source.png"], input)).exitCode).toBe(0);
        const comment = 'a "quote", a slash \\ and a newline\n雪';
        const result = await runConvertCli(["source.png", "-size", "3x2", "xc:red", "-set", "comment", comment.replaceAll("\\", "\\\\"), "-depth", "8", "-write", "json:report.json", "-negate", "json:-"], input);
        expect(result.exitCode).toBe(0);
        expect(result.stderr).toBe("");
        const report = JSON.parse(new TextDecoder().decode(retained ? await fs.readFile("/report.json") : files.get("report.json")));
        const expected = [
            { version: "1.0", image: { name: "source.png", format: "PNG", baseDepth: 8, geometry: { width: 2, height: 1, x: 0, y: 0 }, properties: { comment } } },
            { version: "1.0", image: { format: "XC", baseDepth: 8, geometry: { width: 3, height: 2, x: 0, y: 0 }, properties: { comment } } }
        ];
        expect(report).toMatchObject(expected);
        expect(JSON.parse(result.stdout)).toMatchObject(expected);
    });

    it(`keeps INFO and TXT destinations working (retained=${retained})`, async () => {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const input = retained ? { filesystem: fs, cwd: "/" } : files;
        for (const destination of ["info:report.info", "txt:report.txt"]) {
            expect(await runConvertCli(["-size", "3x2", "xc:red", "-format", "%wx%h", destination], input)).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        }
        const info = new TextDecoder().decode(retained ? await fs.readFile("/report.info") : files.get("report.info"));
        const txt = new TextDecoder().decode(retained ? await fs.readFile("/report.txt") : files.get("report.txt"));
        expect(info).toBe("3x2");
        expect(txt).toContain("# ImageMagick pixel enumeration: 3,2,");
    });
}

it("streams intermediate and final JSON to the supplied output sink", async () => {
    const fs = new MemoryFileSystem(), chunks: Uint8Array[] = [];
    const result = await runConvertCli(["-size", "3x2", "xc:red", "-write", "json:-", "-negate", "json:-"], {
        filesystem: fs, cwd: "/", stdout: { async write(bytes) { expect(bytes.length).toBeLessThanOrEqual(4096); chunks.push(bytes); } }
    });
    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    const text = chunks.map(chunk => new TextDecoder().decode(chunk)).join("");
    const end = text.indexOf("\n]\n") + 3;
    expect(JSON.parse(text.slice(0, end))).toMatchObject([{ version: "1.0", image: { format: "XC" } }]);
    expect(JSON.parse(text.slice(end))).toMatchObject([{ version: "1.0", image: { format: "XC" } }]);
    expect(await fs.readdir("/")).toEqual([]);
});
