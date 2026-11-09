import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli } from "./index.js";

// Native ImageMagick 7.1.2-31 Q16-HDRI, MAGICK_THREAD_LIMIT=1, depth 8 RGBA.
const references: Record<string, string> = {
    "fractal:123": "988c75ff2c7f68ff417895ff4d6894ff54758aff81b8a2ffa96015ff592b3bff230758ff5b1f56ff59564dff758659ff712903ff201f35ff662a45ff8c3929ff824927ff4b3d5eff774d18ff3a1e58ffa32f08ffad3d18ffae314dff7d3259ff54380eff2a2940ff9e0b0effb04111ffe36b23ffbc5849ff271a49ff002a20ff5b0b00ffac1300ffcb6100ffdc8c14ff",
    "fractal:124": "a689dfff48728fff6d4073ff6f5276ff6b4e86ff5137b8ff3b9479ff466173ff451c3dff3c1250ff604d54ff643f95ff02622fff24540aff6f84aaff3a909aff7684a7ff584c6fff102224ff234204ff60a96eff65bcbcff87b29eff9a85b6ff551924ff0d210bff57a47fff5c8db5ff59d9a0ff77b5b6ffa82f62ff590030ff314357ff249276ff46cc7bff84f9b0ff",
    "red-blue:123": "ce4727ff8c1c2affaa0c56ffb4005cffbd004dfffb2030fff0161affa90043ff730068ffad005cffa8065cffd02044ff9a0069ff4d00acff4f00b2ff690091ff4d009bff4d00abff912590ff6000e4ff77008dff65009aff6600cfff3500dbff4921a1ff3d15ffff5100caff5500cdff5100d9ff2a00ffff0010d0ff0027f7ff2400f3ff3e00cfff2600e5ff0000ffff",
    "red-blue:124": "ff0079ffb0004dffd90031ffdb0038ffe0003affe80023ff8c3278ff980d7bff95004dff8f0056ffaf0064ffc90074ff262f97ff522781ff7408e6ff3803c8ff6700d8ff700095ff1e00a1ff491c90ff5525b8ff491af0ff6b0fd2ff7e00eaff2c00c5ff200ed1ff3024f8ff2d00ffff090ce2ff2700f7ff1704ffff2900ffff1005ffff0015ffff0011f6ff0000ffff"
};

for (const execution of ["buffered", "retained", "command"]) {
    it.each(["fractal", "red-blue"])(`renders seeded plasma:%s (execution=${execution})`, async spec => {
        const render = async (seed: number) => {
            const files = new Map([["out.png", new TextEncoder().encode("keep")]]);
            const filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/out.png", new TextEncoder().encode("keep"));
            const argv = ["-seed", String(seed), "-size", "6x6", `plasma:${spec}`, "out.png"];
            if (execution === "command") {
                const args = createCommandArguments(argv);
                const result = await createMagickCommand().execute({
                    command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {},
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write() {} }, stderr: { async write() {} }, fs: filesystem
                });
                expect(result.exitCode).toBe(0);
            } else {
                expect(await runConvertCli(argv, execution === "retained" ? { filesystem, cwd: "/" } : files))
                    .toEqual({ exitCode: 0, stdout: "", stderr: "" });
            }
            const image = decodeImage(execution === "buffered" ? files.get("out.png")! : await filesystem.readFile("/out.png"));
            expect([image.width, image.height]).toEqual([6, 6]);
            const rgba = image.data16 ? Uint8Array.from(image.data16, value => Math.round(value / 257)) : image.data;
            const pixels = Array.from({ length: 36 }, (_, i) => Array.from(rgba.subarray(i * 4, i * 4 + 4)).join(","));
            expect(new Set(pixels).size).toBe(36);
            return Buffer.from(rgba).toString("hex");
        };
        expect(await render(123)).toBe(references[`${spec}:123`]);
        expect(await render(123)).toBe(references[`${spec}:123`]);
        expect(await render(124)).toBe(references[`${spec}:124`]);
    });
}

// Single rows/columns and a larger odd canvas exercise midpoint overlap and refinement.
it.each([
    {
        "size": "1x1",
        "spec": "fractal",
        "pixels": "dc8c14ff"
    },
    {
        "size": "1x1",
        "spec": "red-blue",
        "pixels": "ff0000ff"
    },
    {
        "size": "1x6",
        "spec": "fractal",
        "pixels": "66c10cff8cac00ff97ab23ff8c9217ffe1982cffffc40eff"
    },
    {
        "size": "1x6",
        "spec": "red-blue",
        "pixels": "a25c16ff874a2cff59419eff442699ff4f1ce2ff2638f8ff"
    },
    {
        "size": "6x1",
        "spec": "fractal",
        "pixels": "4aa83aff00e70aff4bff43ff69ff2dff6fd206ff409f00ff"
    },
    {
        "size": "6x1",
        "spec": "red-blue",
        "pixels": "ab6b25ff4f9c1dff0cf2bfff22c0afff0056bcff001396ff"
    },
    {
        "size": "9x7",
        "spec": "fractal",
        "pixels": "dd488effc3aca1ff71d16bff3dd860ff26bc44ff25c641ff24b469ff34bb6cff76d799ffa97988ffc1aa7cffacd4a5ff65bc65ff23d02cff00b728ff10bf50ff45bb5bff54ef79ff75b06affa8c75cff88dc8effa0ce96ff71ad66ff21a454ff49a154ff1ce438ff52e43fff40bc5eff90ab41ffaad342ff9ea758ff87af84ff93907aff9d9d4dff7f9b30ff289b44ff6a7062ff9fb445ffaebe2effc7a274ffa1888affcf8f4dffc49241ffae7b59ff667147ff5b4f76ff865f3fff9a811effd5a343ffd98850ffd64d5afff58031ffee9537ffb07741ff610ea0ff602f55ff72573dff906943ffe4542fffff4a1cffff3d00ffff7601ffdc8c14ff"
    },
    {
        "size": "9x7",
        "spec": "red-blue",
        "pixels": "ff0027ffe52a43ff9b4414ff852e26ffa40225ffaf113effbd0865ffbb0658fff52036fff00047ffee1030ffbd3c4fffa10d2bff890a0cff770025ffa50f6affca0555ffc93253ffd1004fffe90036ffae125effab065bff8a0065ff6e0052ffad006fff982770ffbd2057ff7c007dff910087ff8d1691ff5800acff3400bfff3400caff5900a0ff3f00aaff3a00bfff720097ff861d96ff74159bff7200d7ff3100e3ff6200acff5800a7ff5900dbff2900e7ff2e05bfff3903a5ff2c15a0ff4724e1ff300be5ff2e00f5ff4f00d3ff4b00dfff2300ffff0000ffff0010d0ff0025d4ff0027f7ff0000ffff2400f3ff3e00cfff2600e5ff0000ffff"
    }
])("matches native $size plasma:$spec", async ({ size, spec, pixels }) => {
    const files = new Map<string, Uint8Array>();
    expect(await runConvertCli(["-seed", "123", "-size", size, `plasma:${spec}`, "out.png"], files))
        .toEqual({ exitCode: 0, stdout: "", stderr: "" });
    const image = decodeImage(files.get("out.png")!);
    const rgba = image.data16 ? Uint8Array.from(image.data16, value => Math.round(value / 257)) : image.data;
    expect(Buffer.from(rgba).toString("hex")).toBe(pixels);
});
