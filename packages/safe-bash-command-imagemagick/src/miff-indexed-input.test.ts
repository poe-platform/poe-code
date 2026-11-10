import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, without converting the GIF palette to TrueColor:
// magick -delay 16 -size 2x1 xc:red a.gif
// magick -delay 36 -size 2x1 xc:blue b.gif
// magick -delay 1x24 a.gif -delay 7x1000 b.gif source.miff
const sequence = Buffer.from("aWQ9SW1hZ2VNYWdpY2sgdmVyc2lvbj0xLjAKY2xhc3M9UHNldWRvQ2xhc3MgY29sb3JzPTIgYWxwaGEtdHJhaXQ9VW5kZWZpbmVkCm51bWJlci1jaGFubmVscz00IG51bWJlci1tZXRhLWNoYW5uZWxzPTAgY2hhbm5lbC1tYXNrPTB4MDAwMDAwMDAwN2ZmZmZmZgpjb2x1bW5zPTIgcm93cz0xIGRlcHRoPTgKY29sb3JzcGFjZT1zUkdCCnBhZ2U9MngxKzArMAppdGVyYXRpb25zPTEgZGVsYXk9MSB0aWNrcy1wZXItc2Vjb25kPTI0CnJlbmRlcmluZy1pbnRlbnQ9UGVyY2VwdHVhbApnYW1tYT0wLjQ1NDU0NQpyZWQtcHJpbWFyeT0wLjY0LDAuMzMgZ3JlZW4tcHJpbWFyeT0wLjMsMC42IGJsdWUtcHJpbWFyeT0wLjE1LDAuMDYKd2hpdGUtcG9pbnQ9MC4zMTI3LDAuMzI5CmRhdGU6Y3JlYXRlPTIwMjYtMTEtMTBUMDM6NTQ6MjArMDA6MDAKZGF0ZTptb2RpZnk9MjAyNi0xMS0xMFQwMzo1NDoyMCswMDowMApkYXRlOnRpbWVzdGFtcD0yMDI2LTExLTEwVDAzOjU0OjIwKzAwOjAwCgwKOhr/AAAAAAAAAGlkPUltYWdlTWFnaWNrIHZlcnNpb249MS4wCmNsYXNzPVBzZXVkb0NsYXNzIGNvbG9ycz0yIGFscGhhLXRyYWl0PVVuZGVmaW5lZApudW1iZXItY2hhbm5lbHM9NCBudW1iZXItbWV0YS1jaGFubmVscz0wIGNoYW5uZWwtbWFzaz0weDAwMDAwMDAwMDdmZmZmZmYKY29sdW1ucz0yIHJvd3M9MSBkZXB0aD04CmNvbG9yc3BhY2U9c1JHQgpwYWdlPTJ4MSswKzAKc2NlbmU9MSAgaXRlcmF0aW9ucz0xIGRlbGF5PTcgdGlja3MtcGVyLXNlY29uZD0xMDAwCnJlbmRlcmluZy1pbnRlbnQ9UGVyY2VwdHVhbApnYW1tYT0wLjQ1NDU0NQpyZWQtcHJpbWFyeT0wLjY0LDAuMzMgZ3JlZW4tcHJpbWFyeT0wLjMsMC42IGJsdWUtcHJpbWFyeT0wLjE1LDAuMDYKd2hpdGUtcG9pbnQ9MC4zMTI3LDAuMzI5CmRhdGU6Y3JlYXRlPTIwMjYtMTEtMTBUMDM6NTQ6MjArMDA6MDAKZGF0ZTptb2RpZnk9MjAyNi0xMS0xMFQwMzo1NDoyMCswMDowMApkYXRlOnRpbWVzdGFtcD0yMDI2LTExLTEwVDAzOjU0OjIwKzAwOjAwCgwKOhoAAP8AAAAAAA==", "base64");
const red = Buffer.from("R0lGODlhAgABAPAAAP8AAAAAACH5BAAQAAAALAAAAAACAAEAAAICBAoAOw==", "base64");

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        ["source.miff", "%T|", "1|7|"],
        ["source.miff", "%[pixel:p{0,0}]|", "srgb(255,0,0)|srgb(0,0,255)|"],
        ["source.miff[1,0]", "%[pixel:p{0,0}]|", "srgb(0,0,255)|srgb(255,0,0)|"],
        ["a.gif", "%[pixel:p{0,0}]|", "srgb(255,0,0)|"],
        ["out.gif", "%T|%[pixel:p{0,0}]|", "4|srgb(255,0,0)|0|srgb(0,0,255)|"]
    ])(`${mode}: reads indexed MIFF and GIF control %s %s`, async (input, format, expected) => {
        const files = new Map<string, Uint8Array>([["source.miff", sequence], ["a.gif", red], ["out.gif", new TextEncoder().encode("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile("/" + path, bytes);
        async function run(args: string[]) {
            if (mode === "sync") return runMagickCliSync(args, files);
            if (mode !== "command") return runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            let stdout = "", stderr = "";
            const result = await createMagickCommand().execute({
                command: "magick", args, cwd: "/", env: {}, fs: filesystem,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
            return { ...result, stdout, stderr };
        }
        if (input === "out.gif") expect(await run(["source.miff", "out.gif"])).toMatchObject({ exitCode: 0, stderr: "" });
        expect(await run([input, "-format", format, "info:"])).toMatchObject({ exitCode: 0, stdout: expected, stderr: "" });
    });
}

it("rejects an invalid palette index without replacing the destination", async () => {
    const invalid = new Uint8Array(sequence);
    invalid[sequence.indexOf(Buffer.from([12, 10, 58, 26])) + 4 + 6] = 2;
    const fs = new MemoryFileSystem();
    await fs.writeFile("/bad.miff", invalid);
    await fs.writeFile("/out.gif", new TextEncoder().encode("KEEP"));
    let stderr = "";
    const result = await createMagickCommand().execute({
        command: "magick", args: ["bad.miff", "out.gif"], cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    });
    expect(result.exitCode).toBe(1);
    expect(stderr).toContain("Invalid MIFF palette index");
    expect(new TextDecoder().decode(await fs.readFile("/out.gif"))).toBe("KEEP");
});
