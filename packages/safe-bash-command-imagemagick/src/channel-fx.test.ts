import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync, runMogrifyCli } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "mogrify"] as const) {
    it.each([
        { expression: "red<=>blue", expected: [0, 0, 255, 255, 255, 0, 0, 255] },
        { expression: "R <=> G", expected: [0, 255, 0, 255, 0, 0, 255, 255] },
        { expression: "red<=>red", expected: [255, 0, 0, 255, 0, 0, 255, 255] },
        { expression: "0=>2", expected: [255, 0, 255, 255, 0, 0, 0, 255] },
        { expression: "cyan=>magenta", expected: [255, 255, 0, 255, 0, 0, 255, 255] },
        { expression: " C <=> Y, 1 => 0 ", expected: [0, 0, 255, 255, 0, 0, 0, 255] },
        { expression: "yellow=>cyan", expected: [0, 0, 0, 255, 255, 0, 255, 255] },
        { expression: "gray=>M", expected: [255, 255, 0, 255, 0, 0, 255, 255] },
        { expression: "4=>0", expected: [255, 0, 0, 255, 255, 0, 255, 255] },
        { expression: "2=>4", expected: [255, 0, 0, 0, 0, 0, 255, 255] },
        { expression: "O=>G", expected: [255, 255, 0, 255, 0, 255, 255, 255] },
        { expression: "red=>blue", expected: [255, 0, 255, 255, 0, 0, 0, 255] },
        { expression: "R => G, G => B", expected: [255, 255, 0, 255, 0, 0, 0, 255] },
        { expression: "blue=>alpha", expected: [255, 0, 0, 0, 0, 0, 255, 255] },
        { expression: "alpha=>green", expected: [255, 255, 0, 255, 0, 255, 255, 255] },
    ])(`copies original channel samples in ${mode}: $expression`, async ({ expression, expected }) => {
        // Native: magick xc:red xc:blue +append -strip PNG24:-
        const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAD0lEQVQI12P4z8DAwPAfAAcAAf921adgAAAAAElFTkSuQmCC", "base64");
        const files = new Map([["/input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const options = ["-alpha", "set", "-channel-fx", expression];
        const args = ["/input.png", ...options, "/out.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : mode === "mogrify" ? await runMogrifyCli([...options, "/input.png"], { filesystem, cwd: "/" })
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        const output = mode === "mogrify" ? await filesystem.readFile("/input.png") : mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!;
        expect([...decodeImage(output).data]).toEqual(expected);
    });
}

for (const retained of [false, true]) {
    it.each(["unknown", "red;", "red,", "red=>", "red=>unknown", "red=>blue=>green", "red=>blue,", "red<=>", "red<=>unknown", "red<=>blue<=>green"])(`rejects invalid assignment %s without overwriting output, retained=${retained}`, async expression => {
        const original = new Uint8Array([1, 2, 3]), files = new Map([["/out.png", original]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/out.png", original);
        const result = await runConvertCli(["xc:red", "-channel-fx", expression, "/out.png"], retained ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("channel-fx");
        expect(retained ? await filesystem.readFile("/out.png") : files.get("/out.png")).toEqual(original);
    });
}

for (const retained of [false, true]) {
    it.each(["red=>blue", "0=>2", "cyan=>yellow"])(`preserves 16-bit samples for %s, retained=${retained}`, async expression => {
        // Native: magick 'xc:#123456789abc' -depth 16 -strip PNG48:-
        const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABEAIAAADA54+dAAAAD0lEQVQI12MQMgmrmLUHAAYnAmsGA8PKAAAAAElFTkSuQmCC", "base64");
        const files = new Map([["/input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const result = await runConvertCli(["/input.png", "-channel-fx", expression, "-depth", "16", "/out.png"], retained ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        const output = decodeImage(retained ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        expect([...output.data16!]).toEqual([0x1234, 0x5678, 0x1234, 65535]);
    });
}

it("copies across retained chunk boundaries", async () => {
    const filesystem = new MemoryFileSystem();
    expect(await runConvertCli(["-size", "4097x1", "xc:red", "-channel-fx", "red=>blue", "-depth", "8", "rgba:/out.rgba"], { filesystem, cwd: "/" })).toMatchObject({ exitCode: 0, stderr: "" });
    const output = await filesystem.readFile("/out.rgba");
    expect(output.length).toBe(4097 * 4);
    for (let offset = 0; offset < output.length; offset += 4) expect([...output.subarray(offset, offset + 4)]).toEqual([255, 0, 255, 255]);
});

for (const retained of [false, true]) {
    for (const depth of [8, 16]) {
        it.each([
            { expression: "red<=>blue", hex8: "7845128056eeabbf", samples16: [0x789a, 0x4567, 0x1234, 0x8001, 0x5678, 0xef01, 0xabcd, 0xc003] },
            { expression: "alpha<=>green", hex8: "12807845abbf56ee", samples16: [0x1234, 0x8001, 0x789a, 0x4567, 0xabcd, 0xc003, 0x5678, 0xef01] },
            { expression: "R <=> B, G => R", hex8: "45451280eeeeabbf", samples16: [0x4567, 0x4567, 0x1234, 0x8001, 0xef01, 0xef01, 0xabcd, 0xc003] },
        ])(`exchanges original RGBA${depth} samples, retained=${retained}: $expression`, async ({ expression, hex8, samples16 }) => {
            // Native PNG32/PNG64 from MSB RGBA16 12344567789a8001abcdef015678c003.
            const input = Buffer.from(depth === 8
                ? "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVQI12MQcq1oWP0ubD8ADq0D/sUFYD4AAAAASUVORK5CYII="
                : "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABEAYAAACksqPJAAAAGUlEQVQI12MQMnFNr5jVwLj67HvGsIoDzAAzWgZ/WP2H5AAAAABJRU5ErkJggg==", "base64");
            const files = new Map([["/input.png", input]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/input.png", input);
            const result = await runConvertCli(["/input.png", "-channel-fx", expression, "+append", "-depth", String(depth), "/out.png"], retained ? { filesystem, cwd: "/" } : files);
            expect(result).toMatchObject({ exitCode: 0, stderr: "" });
            const output = decodeImage(retained ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
            expect([output.width, output.height]).toEqual([2, 1]);
            expect([...(depth === 16 ? output.data16! : output.data)]).toEqual(depth === 16 ? samples16 : [...Buffer.from(hex8, "hex")]);
        });
    }
}

for (const mode of ["buffered", "retained", "sync", "public"] as const) {
    it.each([
        { expression: undefined, expected: "12345678abcdefee9a76ba3221436587", width: 4 },
        { expression: "red=>blue", expected: "12341278abcdabee", width: 2 },
        { expression: "|red=>blue", expected: "12349a78abcd21ee", width: 2 },
        { expression: "|red<=>blue", expected: "ba349a7865cd21ee", width: 2 },
        { expression: "|red=>blue,green=>red", expected: "76349a7843cd21ee", width: 2 },
    ])(`uses the input list as channel sources in ${mode}: $expression`, async ({ expression, expected, width }) => {
        const filesystem = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const args = ["(", "xc:#12345678", "xc:#abcdefee", "+append", ")", "(", "xc:#9a76ba32", "xc:#21436587", "+append", ")", ...(expression ? ["-channel-fx", expression] : []), "+append", "PNG32:/out.png"];
        const argumentValues = createCommandArguments(args);
        const context = {
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }, registerCleanup() {}
        } as unknown as CommandContext;
        const result = mode === "public" ? await createMagickCommand().execute(context)
            : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = decodeImage(mode === "public" || mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        expect([output.width, output.height]).toEqual([width, 1]);
        expect(Buffer.from(output.data).toString("hex")).toBe(expected);
    });
}

for (const retained of [false, true]) {
    it(`copies a 16-bit second source across chunks, retained=${retained}`, async () => {
        const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABEAIAAADA54+dAAAAD0lEQVQI12MQMgmrmLUHAAYnAmsGA8PKAAAAAElFTkSuQmCC", "base64");
        const files = new Map([["/input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const args = ["-size", "4097x1", "xc:red", "(", "/input.png", "-resize", "4097x1!", ")", "-channel-fx", "|red=>blue", "+append", "-depth", "16", "PNG64:/out.png"];
        expect(await runConvertCli(args, retained ? { filesystem, cwd: "/" } : files)).toMatchObject({ exitCode: 0, stderr: "" });
        const output = decodeImage(retained ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        expect([output.width, output.height]).toEqual([4097, 1]);
        expect([...output.data16!]).toEqual(Array.from({ length: 4097 }, () => [65535, 0, 0x1234, 65535]).flat());
    });
}

// Native ImageMagick 7.1.2-35 Q16-HDRI, 2x1 RGBA8 input 12345678 abcdefee.
it.each([
    { expression: "0=>2", expected: "12341278abcdabee" },
    { expression: "cyan=>magenta", expected: "12125678ababefee" },
    { expression: "0<=>2", expected: "56341278efcdabee" },
    { expression: "4=>0", expected: "78345678eecdefee" },
    { expression: "0=>4", expected: "12345612abcdefab" },
    { expression: "red=>unknown", expected: undefined },
    { expression: "3=>0", expected: undefined },
])("resolves channel IDs and aliases through the command: $expression", async ({ expression, expected }) => {
    const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDhUMDI6MjI6NTUrMDA6MDCZ5uVXAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA4VDAyOjIyOjU1KzAwOjAw6Ltd6wAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wOFQwMjoyMjo1NSswMDowML+ufDQAAAARSURBVAjXYxAyCatYffb9OwAOQARqQ6nkkgAAAABJRU5ErkJggg==", "base64");
    const fs = new MemoryFileSystem(), original = new Uint8Array([1, 2, 3]);
    await fs.writeFile("/input.png", input);
    await fs.writeFile("/out.png", original);
    let stderr = "";
    const result = await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(["input.png", "-channel-fx", expression, "+append", "PNG32:out.png"]).args,
        cwd: "/", env: {}, fs, signal: new AbortController().signal,
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    });
    expect(result.exitCode, stderr).toBe(expected === undefined ? 1 : 0);
    const output = await fs.readFile("/out.png");
    if (expected === undefined) {
        expect(stderr).toContain("channel");
        expect(output).toEqual(original);
    } else {
        expect(stderr).toBe("");
        const image = decodeImage(output);
        expect([image.width, image.height]).toEqual([2, 1]);
        expect(Buffer.from(image.data).toString("hex")).toBe(expected);
    }
});
