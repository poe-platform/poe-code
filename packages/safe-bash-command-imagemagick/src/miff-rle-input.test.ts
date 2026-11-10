import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCliSync } from "./index.js";

// Native ImageMagick: -size 4x2 -depth <depth> -endian MSB rgba:- -compress <compression> miff:-
const fixtures = [
    {
        "depth": 8,
        "compression": "None",
        "bytes": "aWQ9SW1hZ2VNYWdpY2sgdmVyc2lvbj0xLjAKY2xhc3M9RGlyZWN0Q2xhc3MgY29sb3JzPTAgYWxwaGEtdHJhaXQ9QmxlbmQKbnVtYmVyLWNoYW5uZWxzPTQgbnVtYmVyLW1ldGEtY2hhbm5lbHM9MCBjaGFubmVsLW1hc2s9MHgwMDAwMDAwMDA3ZmZmZmZmCm1hdHRlPVRydWUKY29sdW1ucz00IHJvd3M9MiBkZXB0aD04CnR5cGU9VHJ1ZUNvbG9yCmNvbG9yc3BhY2U9c1JHQgpjb21wcmVzc2lvbj1Ob25lICBxdWFsaXR5PTAKcGFnZT00eDIrMCswCnJlbmRlcmluZy1pbnRlbnQ9UGVyY2VwdHVhbApnYW1tYT0wLjQ1NDU0NQpyZWQtcHJpbWFyeT0wLjY0LDAuMzMgZ3JlZW4tcHJpbWFyeT0wLjMsMC42IGJsdWUtcHJpbWFyeT0wLjE1LDAuMDYKd2hpdGUtcG9pbnQ9MC4zMTI3LDAuMzI5CmRhdGU6Y3JlYXRlPTIwMjYtMTEtMTBUMDM6NTc6MzErMDA6MDAKZGF0ZTptb2RpZnk9MjAyNi0xMS0xMFQwMzo1NzozMSswMDowMApkYXRlOnRpbWVzdGFtcD0yMDI2LTExLTEwVDAzOjU3OjMxKzAwOjAwCgwKOhoSNKvN/wCA/xI0q81VZgCAEjSrzf8AgP8SNKvNVWYAgA==",
        "raw": "1234abcdff0080ff1234abcd556600801234abcdff0080ff1234abcd55660080"
    },
    {
        "depth": 8,
        "compression": "RLE",
        "bytes": "aWQ9SW1hZ2VNYWdpY2sgdmVyc2lvbj0xLjAKY2xhc3M9RGlyZWN0Q2xhc3MgY29sb3JzPTAgYWxwaGEtdHJhaXQ9QmxlbmQKbnVtYmVyLWNoYW5uZWxzPTQgbnVtYmVyLW1ldGEtY2hhbm5lbHM9MCBjaGFubmVsLW1hc2s9MHgwMDAwMDAwMDA3ZmZmZmZmCm1hdHRlPVRydWUKY29sdW1ucz00IHJvd3M9MiBkZXB0aD04CnR5cGU9VHJ1ZUNvbG9yCmNvbG9yc3BhY2U9c1JHQgpjb21wcmVzc2lvbj1STEUgIHF1YWxpdHk9MApwYWdlPTR4MiswKzAKcmVuZGVyaW5nLWludGVudD1QZXJjZXB0dWFsCmdhbW1hPTAuNDU0NTQ1CnJlZC1wcmltYXJ5PTAuNjQsMC4zMyBncmVlbi1wcmltYXJ5PTAuMywwLjYgYmx1ZS1wcmltYXJ5PTAuMTUsMC4wNgp3aGl0ZS1wb2ludD0wLjMxMjcsMC4zMjkKZGF0ZTpjcmVhdGU9MjAyNi0xMS0xMFQwMzo1NzozMSswMDowMApkYXRlOm1vZGlmeT0yMDI2LTExLTEwVDAzOjU3OjMxKzAwOjAwCmRhdGU6dGltZXN0YW1wPTIwMjYtMTEtMTBUMDM6NTc6MzErMDA6MDAKDAo6GhI0q80A/wCA/wASNKvNAFVmAIAAEjSrzQD/AID/ABI0q80AVWYAgAA=",
        "raw": "1234abcdff0080ff1234abcd556600801234abcdff0080ff1234abcd55660080"
    },
    {
        "depth": 16,
        "compression": "None",
        "bytes": "aWQ9SW1hZ2VNYWdpY2sgdmVyc2lvbj0xLjAKY2xhc3M9RGlyZWN0Q2xhc3MgY29sb3JzPTAgYWxwaGEtdHJhaXQ9QmxlbmQKbnVtYmVyLWNoYW5uZWxzPTQgbnVtYmVyLW1ldGEtY2hhbm5lbHM9MCBjaGFubmVsLW1hc2s9MHgwMDAwMDAwMDA3ZmZmZmZmCm1hdHRlPVRydWUKY29sdW1ucz00IHJvd3M9MiBkZXB0aD0xNgp0eXBlPVRydWVDb2xvcgpjb2xvcnNwYWNlPXNSR0IKY29tcHJlc3Npb249Tm9uZSAgcXVhbGl0eT0wCnBhZ2U9NHgyKzArMApyZW5kZXJpbmctaW50ZW50PVBlcmNlcHR1YWwKZ2FtbWE9MC40NTQ1NDUKcmVkLXByaW1hcnk9MC42NCwwLjMzIGdyZWVuLXByaW1hcnk9MC4zLDAuNiBibHVlLXByaW1hcnk9MC4xNSwwLjA2CndoaXRlLXBvaW50PTAuMzEyNywwLjMyOQpkYXRlOmNyZWF0ZT0yMDI2LTExLTEwVDAzOjU3OjMxKzAwOjAwCmRhdGU6bW9kaWZ5PTIwMjYtMTEtMTBUMDM6NTc6MzErMDA6MDAKZGF0ZTp0aW1lc3RhbXA9MjAyNi0xMS0xMFQwMzo1NzozMSswMDowMAoMCjoaAQEEAYAB//8BAQQBgAH//wEBBAGAAf//AAD//gK8dTAREh7dU17ZAxESHt1TXtkDERIe3VNe2QMREh7dU17ZAw==",
        "raw": "010104018001ffff010104018001ffff010104018001ffff0000fffe02bc753011121edd535ed90311121edd535ed90311121edd535ed90311121edd535ed903"
    },
    {
        "depth": 16,
        "compression": "RLE",
        "bytes": "aWQ9SW1hZ2VNYWdpY2sgdmVyc2lvbj0xLjAKY2xhc3M9RGlyZWN0Q2xhc3MgY29sb3JzPTAgYWxwaGEtdHJhaXQ9QmxlbmQKbnVtYmVyLWNoYW5uZWxzPTQgbnVtYmVyLW1ldGEtY2hhbm5lbHM9MCBjaGFubmVsLW1hc2s9MHgwMDAwMDAwMDA3ZmZmZmZmCm1hdHRlPVRydWUKY29sdW1ucz00IHJvd3M9MiBkZXB0aD0xNgp0eXBlPVRydWVDb2xvcgpjb2xvcnNwYWNlPXNSR0IKY29tcHJlc3Npb249UkxFICBxdWFsaXR5PTAKcGFnZT00eDIrMCswCnJlbmRlcmluZy1pbnRlbnQ9UGVyY2VwdHVhbApnYW1tYT0wLjQ1NDU0NQpyZWQtcHJpbWFyeT0wLjY0LDAuMzMgZ3JlZW4tcHJpbWFyeT0wLjMsMC42IGJsdWUtcHJpbWFyeT0wLjE1LDAuMDYKd2hpdGUtcG9pbnQ9MC4zMTI3LDAuMzI5CmRhdGU6Y3JlYXRlPTIwMjYtMTEtMTBUMDM6NTc6MzErMDA6MDAKZGF0ZTptb2RpZnk9MjAyNi0xMS0xMFQwMzo1NzozMSswMDowMApkYXRlOnRpbWVzdGFtcD0yMDI2LTExLTEwVDAzOjU3OjMxKzAwOjAwCgwKOhoBAQQBgAH//wIAAP/+Arx1MAAREh7dU17ZAwM=",
        "raw": "010104018001ffff010104018001ffff010104018001ffff0000fffe02bc753011121edd535ed90311121edd535ed90311121edd535ed90311121edd535ed903"
    }
] as const;

for (const fixture of fixtures) for (const mode of ["command", "sync"] as const) for (const flop of [false, true]) {
    it(`reads native ${fixture.compression} RGBA${fixture.depth} in ${mode}, flop=${flop}`, async () => {
        const bytes = new Uint8Array(Buffer.from(fixture.bytes, "base64"));
        const fs = new MemoryFileSystem(), files = new Map([["in.miff", bytes]]);
        await fs.writeFile("/in.miff", bytes);
        await fs.writeFile("/out", new TextEncoder().encode("KEEP"));
        const args = ["in.miff", ...(flop ? ["-flop"] : []), ...(fixture.depth === 16 ? ["PNG64:out"] : ["-depth", "8", "rgba:out"])];
        let stderr = "";
        const result = mode === "sync" ? runMagickCliSync(args, files) : await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
            stdin: (async function* () {})(), stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        });
        expect({ ...result, stderr: "stderr" in result ? result.stderr : stderr }).toMatchObject({ exitCode: 0, stderr: "" });
        const output = mode === "sync" ? files.get("out")! : await fs.readFile("/out");
        const raw = Buffer.from(fixture.raw, "hex"), pixelBytes = fixture.depth / 8 * 4;
        const expected = Array.from({ length: 8 }, (_, pixel) => {
            const source = flop ? Math.floor(pixel / 4) * 4 + 3 - pixel % 4 : pixel;
            return raw.subarray(source * pixelBytes, (source + 1) * pixelBytes);
        });
        if (fixture.depth === 8) expect(output).toEqual(new Uint8Array(Buffer.concat(expected)));
        else {
            const image = decodeImage(output);
            const samples = Buffer.concat(expected);
            expect([...image.data16!]).toEqual(Array.from({ length: 32 }, (_, index) => samples.readUInt16BE(index * 2)));
        }
    });
}

it("leaves the destination intact when RLE input is truncated", async () => {
    const fs = new MemoryFileSystem();
    const fixture = fixtures.find(fixture => fixture.compression === "RLE" && fixture.depth === 16)!;
    const bytes = Buffer.from(fixture.bytes, "base64");
    await fs.writeFile("/in.miff", bytes.subarray(0, bytes.length - 1));
    await fs.writeFile("/out.png", new TextEncoder().encode("KEEP"));
    let stderr = "";
    const result = await createMagickCommand().execute({
        command: "magick", args: ["in.miff", "PNG64:out.png"], cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    });
    expect(result.exitCode).toBe(1);
    expect(stderr).toContain("Truncated MIFF raster");
    expect(new TextDecoder().decode(await fs.readFile("/out.png"))).toBe("KEEP");
});
