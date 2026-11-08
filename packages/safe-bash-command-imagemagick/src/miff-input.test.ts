import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCliSync } from "./index.js";

// Independent ImageMagick 7 fixtures: magick xc:<color> xc:<color> +append -depth <8|16> -compress None miff:-
const fixtures = [
  {
    "depth": 8,
    "alpha": false,
    "bytes": "aWQ9SW1hZ2VNYWdpY2sgdmVyc2lvbj0xLjAKY2xhc3M9RGlyZWN0Q2xhc3MgY29sb3JzPTAgYWxwaGEtdHJhaXQ9VW5kZWZpbmVkCm51bWJlci1jaGFubmVscz0zIG51bWJlci1tZXRhLWNoYW5uZWxzPTAgY2hhbm5lbC1tYXNrPTB4MDAwMDAwMDAwN2ZmZmZmZgpjb2x1bW5zPTIgcm93cz0xIGRlcHRoPTgKY29sb3JzcGFjZT1zUkdCCmNvbXByZXNzaW9uPU5vbmUgIHF1YWxpdHk9MApwYWdlPTF4MSswKzAKcmVuZGVyaW5nLWludGVudD1QZXJjZXB0dWFsCmdhbW1hPTAuNDU0NTQ1CnJlZC1wcmltYXJ5PTAuNjQsMC4zMyBncmVlbi1wcmltYXJ5PTAuMywwLjYgYmx1ZS1wcmltYXJ5PTAuMTUsMC4wNgp3aGl0ZS1wb2ludD0wLjMxMjcsMC4zMjkKZGF0ZTpjcmVhdGU9MjAyNi0xMS0wOFQxOTozOTo1MCswMDowMApkYXRlOm1vZGlmeT0yMDI2LTExLTA4VDE5OjM5OjUwKzAwOjAwCmRhdGU6dGltZXN0YW1wPTIwMjYtMTEtMDhUMTk6Mzk6NTArMDA6MDAKDAo6GhI0VqvN7w=="
  },
  {
    "depth": 8,
    "alpha": true,
    "bytes": "aWQ9SW1hZ2VNYWdpY2sgdmVyc2lvbj0xLjAKY2xhc3M9RGlyZWN0Q2xhc3MgY29sb3JzPTAgYWxwaGEtdHJhaXQ9QmxlbmQKbnVtYmVyLWNoYW5uZWxzPTQgbnVtYmVyLW1ldGEtY2hhbm5lbHM9MCBjaGFubmVsLW1hc2s9MHgwMDAwMDAwMDA3ZmZmZmZmCm1hdHRlPVRydWUKY29sdW1ucz0yIHJvd3M9MSBkZXB0aD04CmNvbG9yc3BhY2U9c1JHQgpjb21wcmVzc2lvbj1Ob25lICBxdWFsaXR5PTAKcGFnZT0xeDErMCswCnJlbmRlcmluZy1pbnRlbnQ9UGVyY2VwdHVhbApnYW1tYT0wLjQ1NDU0NQpyZWQtcHJpbWFyeT0wLjY0LDAuMzMgZ3JlZW4tcHJpbWFyeT0wLjMsMC42IGJsdWUtcHJpbWFyeT0wLjE1LDAuMDYKd2hpdGUtcG9pbnQ9MC4zMTI3LDAuMzI5CmRhdGU6Y3JlYXRlPTIwMjYtMTEtMDhUMTk6Mzk6NTArMDA6MDAKZGF0ZTptb2RpZnk9MjAyNi0xMS0wOFQxOTozOTo1MCswMDowMApkYXRlOnRpbWVzdGFtcD0yMDI2LTExLTA4VDE5OjM5OjUwKzAwOjAwCgwKOhoSNFaAq83vAA=="
  },
  {
    "depth": 16,
    "alpha": false,
    "bytes": "aWQ9SW1hZ2VNYWdpY2sgdmVyc2lvbj0xLjAKY2xhc3M9RGlyZWN0Q2xhc3MgY29sb3JzPTAgYWxwaGEtdHJhaXQ9VW5kZWZpbmVkCm51bWJlci1jaGFubmVscz0zIG51bWJlci1tZXRhLWNoYW5uZWxzPTAgY2hhbm5lbC1tYXNrPTB4MDAwMDAwMDAwN2ZmZmZmZgpjb2x1bW5zPTIgcm93cz0xIGRlcHRoPTE2CmNvbG9yc3BhY2U9c1JHQgpjb21wcmVzc2lvbj1Ob25lICBxdWFsaXR5PTAKcGFnZT0xeDErMCswCnJlbmRlcmluZy1pbnRlbnQ9UGVyY2VwdHVhbApnYW1tYT0wLjQ1NDU0NQpyZWQtcHJpbWFyeT0wLjY0LDAuMzMgZ3JlZW4tcHJpbWFyeT0wLjMsMC42IGJsdWUtcHJpbWFyeT0wLjE1LDAuMDYKd2hpdGUtcG9pbnQ9MC4zMTI3LDAuMzI5CmRhdGU6Y3JlYXRlPTIwMjYtMTEtMDhUMTk6Mzk6NTArMDA6MDAKZGF0ZTptb2RpZnk9MjAyNi0xMS0wOFQxOTozOTo1MCswMDowMApkYXRlOnRpbWVzdGFtcD0yMDI2LTExLTA4VDE5OjM5OjUwKzAwOjAwCgwKOhoSEjQ0Vlarq83N7+8="
  },
  {
    "depth": 16,
    "alpha": true,
    "bytes": "aWQ9SW1hZ2VNYWdpY2sgdmVyc2lvbj0xLjAKY2xhc3M9RGlyZWN0Q2xhc3MgY29sb3JzPTAgYWxwaGEtdHJhaXQ9QmxlbmQKbnVtYmVyLWNoYW5uZWxzPTQgbnVtYmVyLW1ldGEtY2hhbm5lbHM9MCBjaGFubmVsLW1hc2s9MHgwMDAwMDAwMDA3ZmZmZmZmCm1hdHRlPVRydWUKY29sdW1ucz0yIHJvd3M9MSBkZXB0aD0xNgpjb2xvcnNwYWNlPXNSR0IKY29tcHJlc3Npb249Tm9uZSAgcXVhbGl0eT0wCnBhZ2U9MXgxKzArMApyZW5kZXJpbmctaW50ZW50PVBlcmNlcHR1YWwKZ2FtbWE9MC40NTQ1NDUKcmVkLXByaW1hcnk9MC42NCwwLjMzIGdyZWVuLXByaW1hcnk9MC4zLDAuNiBibHVlLXByaW1hcnk9MC4xNSwwLjA2CndoaXRlLXBvaW50PTAuMzEyNywwLjMyOQpkYXRlOmNyZWF0ZT0yMDI2LTExLTA4VDE5OjM5OjUwKzAwOjAwCmRhdGU6bW9kaWZ5PTIwMjYtMTEtMDhUMTk6Mzk6NTArMDA6MDAKZGF0ZTp0aW1lc3RhbXA9MjAyNi0xMS0wOFQxOTozOTo1MCswMDowMAoMCjoaEhI0NFZWgICrq83N7+8AAA=="
  }
] as const;
for (const fixture of fixtures) for (const mode of ["sync", "command"] as const) {
    it(`reads native MIFF in ${mode}, depth=${fixture.depth}, alpha=${fixture.alpha}`, async () => {
        const bytes = new Uint8Array(Buffer.from(fixture.bytes, "base64"));
        const filesystem = new MemoryFileSystem(), files = new Map([["in.miff", bytes]]);
        await filesystem.writeFile("/in.miff", bytes);
        let stderr = "";
        const args = ["in.miff", "out.png"];
        const result = mode === "sync" ? runMagickCliSync(args, files) : await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        });
        expect({ ...result, stderr: "stderr" in result ? result.stderr : stderr }).toMatchObject({ exitCode: 0, stderr: "" });
        const image = decodeImage(mode === "sync" ? files.get("out.png")! : await filesystem.readFile("/out.png"));
        expect([...image.data]).toEqual([18, 52, 86, fixture.alpha ? 128 : 255, 171, 205, 239, fixture.alpha ? 0 : 255]);
        if (fixture.depth === 16) expect([...image.data16!]).toEqual([18, 52, 86, fixture.alpha ? 128 : 255, 171, 205, 239, fixture.alpha ? 0 : 255].map(value => value * 257));
    });
}
