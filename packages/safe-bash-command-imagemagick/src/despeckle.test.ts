import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync, runMogrifyCli } from "./index.js";

// Decoded RGBA reference pixels from ImageMagick 7.1.2-35 Q16-HDRI.
const fixtures = [
    {
        "name": "noise.png",
        "input": "iVBORw0KGgoAAAANSUhEUgAAAAkAAAAJCAIAAABv85FHAAAASUlEQVR4nL2PIQ7AAAgD+ykcAsMjcQgMT8SNpAmZmJ5rerkSoKpmJiLunplVFRHdvRlbHWZ1GDSIzyDGDS5+D24GjZn59d7nfw+nrHFlAU7e4QAAAABJRU5ErkJggg==",
        "width": 9,
        "height": 9,
        "rgba": "383838ff3c3c3cff393939ff404040ff9c9c9cffa0a0a0ff9d9d9dffa0a0a0ff9c9c9cff3c3c3cff3b3b3bff404040ff404040ffa0a0a0ff9f9f9fffa2a2a2ff9e9e9effa0a0a0ff393939ff3f3f3fff404040ff434343ff9d9d9dffa2a2a2ffa3a3a3ffa2a2a2ff9d9d9dff3d3d3dff3f3f3fff424242ff484848ffa0a0a0ffa3a3a3ffa3a3a3ffa3a3a3ffa1a1a1ff3d3d3dff404040ffe9e9e9ff454545ffa1a1a1ffa3a3a3ffa3a3a3ffa3a3a3ffa1a1a1ff3e3e3eff404040ff414141ff414141ffa2a2a2ffa2a2a2ffa3a3a3ffa2a2a2ffa0a0a0ff393939ff3f3f3fff3f3f3fff414141ff9d9d9dffa2a2a2ffa1a1a1ffa1a1a1ff9d9d9dff3a3a3aff3a3a3aff3f3f3fff414141ff9e9e9eff9e9e9effa1a1a1ff9e9e9eff9f9f9fff363636ff3a3a3aff393939ff3f3f3fff9a9a9aff9e9e9eff9d9d9dff9f9f9fff9c9c9cff"
    },
    {
        "name": "uniform.png",
        "input": "iVBORw0KGgoAAAANSUhEUgAAAAkAAAAJCAIAAABv85FHAAAAD0lEQVR4nGMIxQ0YhrkcALlnULC3tzwGAAAAAElFTkSuQmCC",
        "width": 9,
        "height": 9,
        "rgba": "4f4f4fff515151ff535353ff535353ff535353ff535353ff535353ff525252ff4f4f4fff515151ff545454ff555555ff555555ff555555ff555555ff545454ff535353ff525252ff535353ff555555ff555555ff555555ff555555ff555555ff555555ff545454ff535353ff535353ff555555ff555555ff555555ff555555ff555555ff555555ff555555ff535353ff535353ff555555ff555555ff555555ff555555ff555555ff555555ff555555ff535353ff535353ff555555ff555555ff555555ff555555ff555555ff555555ff555555ff535353ff535353ff545454ff555555ff555555ff555555ff555555ff555555ff555555ff535353ff525252ff535353ff545454ff555555ff555555ff555555ff555555ff545454ff515151ff4f4f4fff525252ff535353ff535353ff535353ff535353ff535353ff515151ff4f4f4fff"
    },
    {
        "name": "hidden.png",
        "input": "iVBORw0KGgoAAAANSUhEUgAAAAQAAAABCAYAAAD5PA/NAAAAEUlEQVR4nGP4zwAEUOI/EAAAKuYG+pKVjWoAAAAASUVORK5CYII=",
        "width": 4,
        "height": 1,
        "rgba": "ef01000001ef01000101f101efeff1ef"
    }
];

for (const route of ["command", "buffered", "sync", "retained"] as const) {
    it.each(fixtures)(`despeckles $name with native border and alpha behavior (${route})`, async fixture => {
        const input = Buffer.from(fixture.input, "base64");
        const fs = new MemoryFileSystem(), files = new Map([["/in.png", input]]);
        await fs.writeFile("/in.png", input);
        const args = ["/in.png", "-despeckle", "PNG32:/out.png"];
        const stderr: string[] = [];
        const arguments_ = createCommandArguments(args);
        const result = route === "command" ? await createMagickCommand().execute({
            command: "magick", args: arguments_.args, argumentValues: arguments_, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(chunk) { stderr.push(String(chunk)); } },
        }) : route === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, route === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0 });
        expect(stderr).toEqual([]);
        const output = decodeImage(route === "buffered" || route === "sync" ? files.get("/out.png")! : await fs.readFile("/out.png"));
        expect([output.width, output.height]).toEqual([fixture.width, fixture.height]);
        expect(Buffer.from(output.data).toString("hex")).toBe(fixture.rgba);
    });
}

for (const retained of [false, true]) {
    it(`despeckles images in place with mogrify (retained=${retained})`, async () => {
        const fixture = fixtures[0]!;
        const input = Buffer.from(fixture.input, "base64"), files = new Map([["/in.png", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.png", input);
        const result = await runMogrifyCli(["-despeckle", "/in.png"], retained ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        const output = decodeImage(retained ? await filesystem.readFile("/in.png") : files.get("/in.png")!);
        expect(Buffer.from(output.data).toString("hex")).toBe(fixture.rgba);
    });

    it.each([
        [["-channel", "R", "-despeckle", "+channel"], "ef00000001ff00000100ff00efffffff"],
        [["-despeckle", "-despeckle"], "df01000001df01000101e301dfdfe3df"],
    ])(`captures channel selection and applies repeated filters (retained=${retained}, %j)`, async (options, expected) => {
        const input = Buffer.from(fixtures[2]!.input, "base64"), files = new Map([["/in.png", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.png", input);
        const result = await runConvertCli(["/in.png", ...options, "PNG32:/out.png"], retained ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        const output = decodeImage(retained ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        expect(Buffer.from(output.data).toString("hex")).toBe(expected);
    });

    it(`preserves 16-bit samples and unselected channels (retained=${retained})`, async () => {
        const samples = [1000, 2000, 3000, 60000, 30000, 25000, 4000, 5000, 6000, 7000, 8000, 9000, 10000, 11000, 12000, 13000, 14000, 15000];
        const pixels = Buffer.alloc(samples.length * 2);
        samples.forEach((sample, i) => pixels.writeUInt16BE(sample, i * 2));
        const input = Buffer.concat([Buffer.from("P6\n3 2\n65535\n"), pixels]);
        const files = new Map([["/in.ppm", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.ppm", input);
        const result = await runConvertCli(["/in.ppm", "-channel", "R", "-despeckle", "+channel", "/out.png"], retained ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        const output = decodeImage(retained ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        const expected = Buffer.from("01e607d00bb8ffffda50753061a8ffff0b9c13881770ffff13501f402328ffff1f082af82ee0ffff26bc36b03a98ffff", "hex");
        expect(Array.from(output.data16!)).toEqual(Array.from({ length: expected.length / 2 }, (_, i) => expected.readUInt16BE(i * 2)));
    });
}
