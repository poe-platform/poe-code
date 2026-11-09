import { expect, it } from "vitest";
import { decodeImage, readImageMetadata } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI grayscale+alpha PNG, with gAMA=1.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAQAAABuBnYAAAAABGdBTUEAAYagMeiWXwAAAAJiS0dEAP+Hj8y/AAAAB3RJTUUH6gsHFwg5H7ksGQAAACV0RVh0ZGF0ZTpjcmVhdGUAMjAyNi0xMS0wN1QyMzowNzo1NyswMDowMAIu/OkAAAAldEVYdGRhdGU6bW9kaWZ5ADIwMjYtMTEtMDdUMjM6MDc6NTcrMDA6MDBzc0RVAAAAKHRFWHRkYXRlOnRpbWVzdGFtcAAyMDI2LTExLTA3VDIzOjA4OjU3KzAwOjAw1W0+BwAAAJNJREFUCNcBiAB3/wAuHpmHRfBZWSXCOSuvlBn9AGlmLM9GOMehIAp6czXcU0UAG64pF42AP+ljUiG7MySjjQBL9mBfKMg/MbmaHANwbDDVAEw+GackEIN5OeJaSx60LR0CS0grSDNIoUj/SFNI+kg6SAAszkU3xaAgCXlyNNtSRButACgWjH8+6GJRIboyI6GMSvWc4DLzwesuTwAAAABJRU5ErkJggg==", "base64");
// magick linear.png -colorspace sRGB PNG32:out.png, decoded to RGBA bytes.
const expected = Buffer.from("dnZ2HsvLy4eOjo7wn5+fWWpqasKCgoIr2NjYlFhYWP2srKxmc3Nzz4+Pjzjl5eWhY2NjCri4uHN+fn7cm5ubRVxcXK5wcHAXxMTEgIiIiOmnp6dSZWVlu3x8fCTR0dGNlJSU9qWlpV9ubm7IiIiIMd3d3ZpdXV0DsbGxbHh4eNWUlJQ+WFhYp2lpaRC+vr55goKC4qCgoEtgYGC0dXV1HcrKyoaNjY3vnp6eWGlpacGBgYEq19fXk1ZWVvyqqqplc3Nzzo6Ojjfk5OSgY2NjCbe3t3J9fX3bmpqaRFxcXK1ubm4WxMTEf4eHh+inp6dRZWVlunp6eiPQ0NCMk5OT9Q==", "base64");

for (const mode of ["command", "buffered", "sync"] as const) {
    it(`${mode}: reads linear grayscale PNG state and converts every pixel to sRGB`, async () => {
        const files = new Map<string, Uint8Array>([["linear.png", input]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/linear.png", input);
        const run = async (argv: string[]) => {
            if (mode === "sync") return runMagickCliSync(argv, files);
            if (mode === "buffered") return runMagickCli(argv, files);
            const args = createCommandArguments(argv);
            let stdout = "", stderr = "";
            const result = await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
            return { ...result, stdout, stderr };
        };
        const metadata = await run(["linear.png", "-format", "%[colorspace]|%[gamma]", "info:"]);
        expect(metadata).toMatchObject({ exitCode: 0, stderr: "" });
        expect.soft(metadata.stdout.trimEnd()).toBe("LinearGray|1");
        const result = await run(["linear.png", "-colorspace", "sRGB", "PNG32:out.png"]);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        const output = mode === "command" ? await fs.readFile("/out.png") : files.get("out.png")!;
        expect([...decodeImage(output).data]).toEqual([...expected]);
        expect(readImageMetadata(output).gamma).toBe(0.45455);
    });
}
