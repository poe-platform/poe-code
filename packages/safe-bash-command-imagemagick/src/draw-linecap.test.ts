import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, entire 15x10 8-bit gray raster.
const fixtures = [
    { cap: "", hash: "3db23ebf0955c123c3ee2ab4d847bc24b721da16044f1bfc52c696b5aaf9a7aa" },
    { cap: "butt", hash: "3db23ebf0955c123c3ee2ab4d847bc24b721da16044f1bfc52c696b5aaf9a7aa" },
    { cap: "square", hash: "e0856efbd7275fc5a9e853e34c6e107fdceaa25280694c868b00a0f03afde77b" },
    { cap: "round", hash: "d5ff2a98ce59457fe54efb3ed61ab34918ea61ae709fd1daf1512f69ae236fd7" },
];
for (const mode of ["map", "filesystem", "command"]) {
    it.each([...fixtures.map(({ cap, hash }) => ({ draw: `${cap ? `stroke-linecap ${cap} ` : ""}line 4,4 10,4`, hash })),
        { draw: "stroke-linecap butt line 7,2 7,7", hash: "8db7c48c0e013fdc8363b01a9c7d63c4259444bc242af50e9b0177bb69e51288" },
        { draw: "stroke-linecap butt line 3,2 10,7", hash: "b3f52885006f22808af0e98887ba8c4267a3c1ecd4602948eadba9650c80f5d2" },
        { draw: "stroke-linecap butt line 10,4 4,4", hash: "3db23ebf0955c123c3ee2ab4d847bc24b721da16044f1bfc52c696b5aaf9a7aa" },
        { draw: "stroke-linecap butt line 4,4 5,4", hash: "d70b6d475035545b09bccc605461273831675fcd6da8a0fdc690715cd94def12" },
        { draw: "stroke-linecap butt line 7,4 7,4", hash: "66dc4dc98f917d9ad02fd1b41cb0f5d78484d9435cf544605aea61b42c81c93b" },
        { draw: "stroke-linecap square line 7,2 7,7", hash: "2bb3f1e9d85d4c97045d2deb1e77893402a12c3036844f28d129f5c6a18f96ec" },
        { draw: "stroke-linecap square line 3,2 10,7", hash: "4bea417408d9b8e946c153eb484bca73353b8de3218292dde5778a72bc55a19a" },
        { draw: "stroke-linecap square line 10,4 4,4", hash: "e0856efbd7275fc5a9e853e34c6e107fdceaa25280694c868b00a0f03afde77b" },
        { draw: "stroke-linecap square line 4,4 5,4", hash: "15fb8babe691d6b9c7b032fffa3d8001cf8074b17a76a07bbca0b670e257ecf1" },
        { draw: "stroke-linecap square line 7,4 7,4", hash: "66dc4dc98f917d9ad02fd1b41cb0f5d78484d9435cf544605aea61b42c81c93b" },
        { draw: "stroke-linecap round line 7,2 7,7", hash: "daf2178d2ffe925a6bf09ddb151bd256bd87e69a792fe12b831ff9b3c5f7970f" },
        { draw: "stroke-linecap round line 3,2 10,7", hash: "f4e67c1e9165c2fb66da54289eef3ef34a7f2ab4d4e3621094e05cab0a17feed" },
        { draw: "stroke-linecap round line 10,4 4,4", hash: "d5ff2a98ce59457fe54efb3ed61ab34918ea61ae709fd1daf1512f69ae236fd7" },
        { draw: "stroke-linecap round line 4,4 5,4", hash: "c1920b3d3ab897d88cf0ed673267f2e25fc199f667c017585511750f815235a0" },
        { draw: "stroke-linecap round line 7,4 7,4", hash: "73868ef02f1c02ebdbdc308539b13786f056417e02f321694bc7076f00d8b0f9" },
        { draw: "stroke-linecap square push graphic-context stroke-linecap round pop graphic-context line 4,4 10,4", hash: "e0856efbd7275fc5a9e853e34c6e107fdceaa25280694c868b00a0f03afde77b" },
        { draw: "push graphic-context stroke-linecap square pop graphic-context line 4,4 10,4", hash: "3db23ebf0955c123c3ee2ab4d847bc24b721da16044f1bfc52c696b5aaf9a7aa" },
        { draw: "stroke-linecap ROUND line 4,4 10,4", hash: "d5ff2a98ce59457fe54efb3ed61ab34918ea61ae709fd1daf1512f69ae236fd7" },
        { draw: "stroke-linecap butt translate 1,1 line 3,3 9,3", hash: "3db23ebf0955c123c3ee2ab4d847bc24b721da16044f1bfc52c696b5aaf9a7aa" },
        { draw: "stroke-linecap square translate 1,1 line 3,3 9,3", hash: "e0856efbd7275fc5a9e853e34c6e107fdceaa25280694c868b00a0f03afde77b" },
        { draw: "stroke-linecap round translate 1,1 line 3,3 9,3", hash: "d5ff2a98ce59457fe54efb3ed61ab34918ea61ae709fd1daf1512f69ae236fd7" },
        { draw: "stroke-linecap butt scale 0.5,0.5 line 4,8 20,8", hash: "e5970902c7d4bcac0dede88f62cc2d2781676f77c60a487d08db6e92ff9b36ab" },
        { draw: "stroke-linecap square scale 0.5,0.5 line 4,8 20,8", hash: "e5970902c7d4bcac0dede88f62cc2d2781676f77c60a487d08db6e92ff9b36ab" },
        { draw: "stroke-linecap round scale 0.5,0.5 line 4,8 20,8", hash: "e5970902c7d4bcac0dede88f62cc2d2781676f77c60a487d08db6e92ff9b36ab" },
    ])(`${mode}: matches native $draw`, async ({ draw, hash }) => {
        const args = ["-size", "15x10", "xc:white", "-fill", "none", "-stroke", "black", "-strokewidth", "4", "-draw", draw, "-depth", "8", mode === "command" ? "gray:-" : "out.gray"];
        const filesystem = new MemoryFileSystem(), files = new Map<string, Uint8Array>(), chunks: Uint8Array[] = [];
        const argumentValues = createCommandArguments(args);
        const context: CommandContext = {
            command: "magick", args: argumentValues.args, cwd: "/", env: {}, signal: new AbortController().signal,
            stdin: (async function* () {})(), stdout: { async write(bytes: Uint8Array) { chunks.push(bytes.slice()); } }, stderr: { async write() {} }, fs: filesystem,
        };
        const result = mode === "command" ? await createMagickCommand().execute(context) : await runConvertCli(args, mode === "filesystem" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const pixels = mode === "command" ? Buffer.concat(chunks) : Buffer.from(mode === "map" ? files.get("out.gray")! : await filesystem.readFile("/out.gray"));
        expect(pixels.length).toBe(150);
        expect(createHash("sha256").update(pixels).digest("hex")).toBe(hash);
    });
}

for (const mode of ["map", "filesystem"]) {
    it.each(["stroke-linecap", "stroke-linecap triangle", "stroke-linecap round line 4,4 10,4 stroke-linecap invalid"])(`${mode}: rejects invalid cap without replacing output: %s`, async draw => {
        const original = new TextEncoder().encode("keep"), files = new Map([["out.gray", original]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/out.gray", original);
        const result = await runConvertCli(["-size", "15x10", "xc:white", "-stroke", "black", "-strokewidth", "4", "-draw", draw, "out.gray"], mode === "map" ? files : { filesystem, cwd: "/" });
        expect(result.exitCode).toBe(1);
        expect(mode === "map" ? files.get("out.gray") : await filesystem.readFile("/out.gray")).toEqual(original);
    });
}
