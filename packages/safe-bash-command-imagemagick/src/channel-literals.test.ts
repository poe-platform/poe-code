import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync, runMogrifyCli } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI input: RGBA8 12345678 abcdefee.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDhUMDI6MjI6NTUrMDA6MDCZ5uVXAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA4VDAyOjIyOjU1KzAwOjAw6Ltd6wAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wOFQwMjoyMjo1NSswMDowML+ufDQAAAARSURBVAjXYxAyCatYffb9OwAOQARqQ6nkkgAAAABJRU5ErkJggg==", "base64");

for (const mode of ["buffered", "retained", "sync", "command", "mogrify"] as const) {
    it.each([
        { expression: "red=50%", expected: "8034567880cdefee" },
        { expression: "blue=65535", expected: "1234ff78abcdffee" },
        { expression: " G = 25% ", expected: "12405678ab40efee" },
        { expression: "alpha=50%", expected: "12345680abcdef80" },
        { expression: "R=0,G=65535,B=100%,A=0", expected: "00ffff0000ffff00" },
        { expression: "red=50%,red=>blue", expected: "8034127880cdabee" },
        { expression: "red=>blue", expected: "12341278abcdabee" },
    ])(`sets channel literals and preserves other channels in ${mode}: $expression`, async ({ expression, expected }) => {
        const files = new Map([["/input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const options = ["-channel-fx", expression];
        const args = ["/input.png", ...options, "+append", "PNG32:/out.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : mode === "mogrify" ? await runMogrifyCli([...options, "/input.png"], { filesystem, cwd: "/" })
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
        const output = mode === "buffered" || mode === "sync" ? files.get("/out.png")!
            : await filesystem.readFile(mode === "mogrify" ? "/input.png" : "/out.png");
        const decoded = decodeImage(output);
        expect([decoded.width, decoded.height]).toEqual([2, 1]);
        expect(Buffer.from(decoded.data).toString("hex")).toBe(expected);
    });
}

for (const retained of [false, true]) {
    it("preserves Q16 assignments and untouched 16-bit alpha, retained=" + retained, async () => {
        // RGBA16: 1234 4567 789a 8001.
        const input16 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABEAYAAABPhRjKAAAAEUlEQVQI12MQMnFNr5jVwAgAClUChnqUAgUAAAAASUVORK5CYII=", "base64");
        const files = new Map([["/input.png", input16]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input16);
        const result = await runConvertCli(["/input.png", "-channel-fx", "red=50%,blue=12345", "PNG64:/out.png"], retained ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        const output = decodeImage(retained ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        expect([...output.data16!]).toEqual([32768, 0x4567, 12345, 0x8001]);
    });

    it.each(["red=", "red=bogus", "red=50%junk", "red=Infinity", "red=NaN", "red=50%=10", "unknown=50%", "red=50%,"])(`rejects malformed literal %s without replacing output, retained=${retained}`, async expression => {
        const original = new Uint8Array([1, 2, 3]), files = new Map([["/out.png", original]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/out.png", original);
        const result = await runConvertCli(["xc:red", "-channel-fx", expression, "/out.png"], retained ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("channel-fx");
        expect(retained ? await filesystem.readFile("/out.png") : files.get("/out.png")).toEqual(original);
    });
}

for (const retained of [false, true]) {
    it.each([
        { expression: "red=12345", following: [], expected: 12345 },
        { expression: "red=0.5", following: ["-channel", "R", "-evaluate", "Multiply", "2"], expected: 1 },
        { expression: "red=-65535", following: ["-channel", "R", "-evaluate", "Add", "65535"], expected: 0 },
    ])(`retains literal precision from 8-bit input, retained=${retained}: $expression`, async ({ expression, following, expected }) => {
        const files = new Map([["/input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const result = await runConvertCli(["/input.png", "-channel-fx", expression, ...following, "PNG64:/out.png"], retained ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        const output = decodeImage(retained ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        expect([...output.data16!]).toEqual([expected, 0x3434, 0x5656, 0x7878, expected, 0xcdcd, 0xefef, 0xeeee]);
    });
}

it("sets literals and existing alpha across retained chunk boundaries", async () => {
    const filesystem = new MemoryFileSystem();
    expect(await runConvertCli(["-size", "4097x1", "xc:red", "-alpha", "set", "-channel-fx", "green=50%,alpha=25%", "-depth", "8", "rgba:/out.rgba"], { filesystem, cwd: "/" })).toMatchObject({ exitCode: 0, stderr: "" });
    const output = await filesystem.readFile("/out.rgba");
    expect(output.length).toBe(4097 * 4);
    for (let offset = 0; offset < output.length; offset += 4) expect([...output.subarray(offset, offset + 4)]).toEqual([255, 128, 0, 64]);
});
