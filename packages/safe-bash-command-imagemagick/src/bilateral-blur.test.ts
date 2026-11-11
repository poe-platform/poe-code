import { bilateralBlurPixelSteps } from "./bilateral-blur-kernel.js";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync, runMogrifyCli } from "./index.js";

// Noisy 15x11 RGB edge; full RGBA8 references from ImageMagick 7.1.2-35 Q16-HDRI.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAA8AAAALCAIAAAAvJUALAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAHdElNRQfqCwcMODJHXo/zAAAAJXRFWHRkYXRlOmNyZWF0ZQAyMDI2LTExLTA3VDEyOjU2OjUwKzAwOjAw+Ov5RQAAACV0RVh0ZGF0ZTptb2RpZnkAMjAyNi0xMS0wN1QxMjo1Njo1MCswMDowMIm2QfkAAAAodEVYdGRhdGU6dGltZXN0YW1wADIwMjYtMTEtMDdUMTI6NTY6NTArMDA6MDDeo2AmAAABLUlEQVQY052RS4vCMBSF71ySSBMrCjUUxIXgA3cy69nNP/M3dqEBKUURoT5JY6SW3tkIXTibmW/9cTiH8/H59Q1vLJdL+A2Ev8AAgDHWarXKsiQixhjnvCgKIur3+3VdSymJ6Ha7vezL5fJ8PrXW3vv7/V5VldZaSllVlTFmPB5ba5vsXq8XhqEQ4vF4IGKWZZzzJElGoxEibjYbItJav3pfr9f9fu+9N8YURSGldM5NJpM8z4fDoVJqOp02K4UQ3W7XGDOfzw+HQxAEYRgej8dOp4OI3nvOeWPXde2cWywWu91uMBg451arlbVWSrndbqMoWq/XjY2IjLEkSay1Sqnz+dxut4MgSNM0jmMims1mzUohBABEUQQAp9MpjmOlFAAopcqyBIA8z//zzg/ig46kj0PvLwAAAABJRU5ErkJggg==", "base64");
const fixtures = [
    {
        "geometry": "5x5+35+3",
        "expected": "323c43ff333d44ff333d44ff333d44ff333d44ff333d44ff343e45ffb3bdc4ffb3bdc4ffb4bec5ffb5bfc6ffb6c0c7ffb5bfc6ffb5bfc6ffb4bec5ff323c43ff323c43ff323c43ff323c43ff323c43ff323c43ff323c43ffb5bfc6ffb5bfc6ffb5bfc6ffb6c0c7ffb6c0c7ffb5bfc6ffb6c0c7ffb5bfc6ff323c43ff333d44ff343e45ff353f46ff343e45ff343e45ff343e45ffb4bec5ffb3bdc4ffb5bfc6ffb5bfc6ffb6c0c7ffb5bfc6ffb5bfc6ffb4bec5ff313b42ff323c43ff323c43ff343e45ff333d44ff323c43ff2f3940ffb8c2c9ffb7c1c8ffb7c1c8ffb1bbc2ffb6c0c7ffb4bec5ffb4bec5ffb4bec5ff313b42ff333d44ff353f46ff364047ff353f46ff353f46ff2f3940ffb9c3caffb2bcc3ffb6c0c7ffb0bac1ffb1bbc2ffb1bbc2ffb4bec5ffb5bfc6ff303a41ff313b42ff313b42ff343e45ff2e383fff333d44ff2f3940ffb7c1c8ffb7c1c8ffb1bbc2ffb3bdc4ffb1bbc2ffb3bdc4ffb3bdc4ffb4bec5ff313b42ff313b42ff323c43ff2e383fff353f46ff2d373eff313b42ffb4bec5ffb0bac1ffb0bac1ffb2bcc3ffb0bac1ffb5bfc6ffb3bdc4ffb5bfc6ff303a41ff303a41ff2f3940ff333d44ff2e383fff313b42ff2e383fffacb6bdffafb9c0ffb2bcc3ffb1bbc2ffb4bec5ffb3bdc4ffb4bec5ffb5bfc6ff313b42ff303a41ff303a41ff2e383fff2d373eff333d44ff2d373effaeb8bfffb0bac1ffafb9c0ffb3bdc4ffb4bec5ffb6c0c7ffb4bec5ffb5bfc6ff313b42ff313b42ff303a41ff313b42ff313b42ff313b42ff303a41ffafb9c0ffb0bac1ffb1bbc2ffb3bdc4ffb4bec5ffb4bec5ffb4bec5ffb4bec5ff323c43ff313b42ff313b42ff313b42ff313b42ff303a41ff313b42ffb2bcc3ffb2bcc3ffb3bdc4ffb4bec5ffb4bec5ffb5bfc6ffb5bfc6ffb5bfc6ff"
    },
    {
        "geometry": "5x5+5+3",
        "expected": "323c43ff323c43ff323c43ff323c43ff323c43ff323c43ff323c43ffb4bec5ffb4bec5ffb4bec5ffb4bec5ffb4bec5ffb4bec5ffb4bec5ffb4bec5ff323c43ff323c43ff333d44ff333d44ff333d44ff333d44ff323c43ffb4bec5ffb4bec5ffb4bec5ffb4bec5ffb4bec5ffb4bec5ffb4bec5ffb4bec5ff323c43ff333d44ff39434aff353f46ff343e45ff374148ff3e484fffa9b3baffa7b1b8ffbbc5ccffb8c2c9ffc2ccd3ffc2ccd3ffb4bec5ffb4bec5ff323c43ff263037ff222c33ff364047ff2f3940ff232d34ff212b32ffbec8cfffc4ced5ffc2ccd3ff9fa9b0ffc1cbd2ffb4bec5ffb4bec5ffb4bec5ff323c43ff343e45ff424c53ff454f56ff404a51ff424c53ff232d34ffc2ccd3ff9ea8afffbec8cfffa0aab1ffa0aab1ff9fa9b0ffb4bec5ffb4bec5ff323c43ff283239ff2a343bff404a51ff1d272eff374148ff2d373effbac4cbffc1cbd2ffa6b0b7ffbec8cfffa9b3baffc3cdd4ffb4bec5ffb4bec5ff323c43ff2e383fff374148ff1c262dff434d54ff1e282fff374148ffc2ccd3ffabb5bcffb7c1c8ffbfc9d0ffa1abb2ffc7d1d8ffb4bec5ffb4bec5ff313b42ff2d373eff2f3940ff475158ff2a343bff384249ff2e383fff9fa9b0ffa1abb2ffbec8cfffa2acb3ffb5bfc6ffa2acb3ffb4bec5ffb4bec5ff323c43ff303a41ff313b42ff1d272eff1c262dff454f56ff1b252cffaab4bbffaab4bbffa0aab1ffb7c1c8ffb4bec5ffc8d2d9ffb4bec5ffb4bec5ff323c43ff323c43ff323c43ff323c43ff323c43ff323c43ff323c43ffb4bec5ffb4bec5ffb4bec5ffb4bec5ffb4bec5ffb4bec5ffb4bec5ffb4bec5ff323c43ff323c43ff323c43ff323c43ff323c43ff323c43ff323c43ffb4bec5ffb4bec5ffb4bec5ffb4bec5ffb4bec5ffb4bec5ffb4bec5ffb4bec5ff"
    },
    {
        "geometry": "3x3+35+1",
        "expected": "323c43ff323c43ff323c43ff323c43ff323c43ff323c43ff323c43ffb4bec5ffb4bec5ffb4bec5ffb4bec5ffb4bec5ffb4bec5ffb4bec5ffb4bec5ff323c43ff333d44ff343e45ff343e45ff333d44ff343e45ff353f46ffb1bbc2ffb2bcc3ffb5bfc6ffb6c0c7ffb7c1c8ffb7c1c8ffb5bfc6ffb4bec5ff323c43ff323c43ff333d44ff343e45ff333d44ff333d44ff343e45ffb1bbc2ffb4bec5ffb7c1c8ffb9c3caffbbc5ccffbbc5ccffb6c0c7ffb4bec5ff313b42ff2f3940ff313b42ff374148ff353f46ff2e383fff2a343bffb9c3caffbcc6cdffb9c3caffaeb8bfffb6c0c7ffb5bfc6ffb4bec5ffb4bec5ff313b42ff303a41ff374148ff3c464dff3a444bff333d44ff2a343bffbdc7ceffb3bdc4ffb5bfc6ffabb5bcffa9b3baffadb7beffb3bdc4ffb4bec5ff303a41ff2f3940ff323c43ff39434aff2e383fff323c43ff303a41ffbac4cbffb7c1c8ffb2bcc3ffb2bcc3ffaeb8bfffb6c0c7ffb6c0c7ffb4bec5ff303a41ff2e383fff303a41ff2c363dff353f46ff2d373eff313b42ffb7c1c8ffb2bcc3ffb4bec5ffb4bec5ffafb9c0ffb8c2c9ffb6c0c7ffb4bec5ff303a41ff2f3940ff2f3940ff364047ff2e383fff323c43ff2e383fffa6b0b7ffa9b3baffb2bcc3ffb0bac1ffb2bcc3ffb1bbc2ffb5bfc6ffb4bec5ff313b42ff2f3940ff2f3940ff2a343bff2b353cff333d44ff2b353cffa9b3baffaab4bbffacb6bdffb2bcc3ffb5bfc6ffb8c2c9ffb5bfc6ffb4bec5ff323c43ff313b42ff303a41ff2e383fff303a41ff313b42ff303a41ffb1bbc2ffb1bbc2ffb1bbc2ffb3bdc4ffb6c0c7ffb6c0c7ffb5bfc6ffb4bec5ff323c43ff323c43ff323c43ff323c43ff323c43ff323c43ff323c43ffb4bec5ffb4bec5ffb4bec5ffb4bec5ffb4bec5ffb4bec5ffb4bec5ffb4bec5ff"
    }
];
for (const mode of ["command", "buffered", "retained"] as const)
for (const fixture of fixtures)
it(`bilateral blur ${fixture.geometry} (${mode})`, async () => {
    const files = new Map([["/in.png", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/in.png", input);
    const args = ["/in.png", "-bilateral-blur", fixture.geometry, "/out.png"];
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} }, stderr: { write: async () => {} },
    }) : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result).toMatchObject({ exitCode: 0 });
    const image = decodeImage(mode === "buffered" ? files.get("/out.png")! : await fs.readFile("/out.png"));
    expect([image.width, image.height]).toEqual([15, 11]);
    expect(Buffer.from(image.data).toString("hex")).toBe(fixture.expected);
});

// Native defaults, rectangular windows, virtual pixels, alpha, channel masks and intensity.
const settingsInputs = [
    "iVBORw0KGgoAAAANSUhEUgAAAAUAAAADBAMAAACpGNjLAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAtUExURRM7H0JSZnFpraCA9M+XO/6ugi3FyVzcEIvzV7oKnukh5Rg4LEdPc3ZmuqV9AcQjwPsAAAAHdElNRQfqCwkKICNLpzzZAAAAJXRFWHRkYXRlOmNyZWF0ZQAyMDI2LTExLTA5VDEwOjMyOjM1KzAwOjAwzTz2vAAAACV0RVh0ZGF0ZTptb2RpZnkAMjAyNi0xMS0wOVQxMDozMjozNSswMDowMLxhTgAAAAAodEVYdGRhdGU6dGltZXN0YW1wADIwMjYtMTEtMDlUMTA6MzI6MzUrMDA6MDDrdG/fAAAAFElEQVQI12NgVHZgCKuYwLD67AMAECoEG92h63UAAAAASUVORK5CYII=",
    "iVBORw0KGgoAAAANSUhEUgAAAAUAAAADBAMAAACpGNjLAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAtUExURRM7H0JSZnFpraCA9M+XO/6ugi3FyVzcEIvzV7oKnukh5Rg4LEdPc3ZmuqV9AcQjwPsAAAAPdFJOU0Bliq/U+V6DqM3yV3yhxmRiyj4AAAAHdElNRQfqCwkKICNLpzzZAAAAJXRFWHRkYXRlOmNyZWF0ZQAyMDI2LTExLTA5VDEwOjMyOjM1KzAwOjAwzTz2vAAAACV0RVh0ZGF0ZTptb2RpZnkAMjAyNi0xMS0wOVQxMDozMjozNSswMDowMLxhTgAAAAAodEVYdGRhdGU6dGltZXN0YW1wADIwMjYtMTEtMDlUMTA6MzI6MzUrMDA6MDDrdG/fAAAAFElEQVQI12NgVHZgCKuYwLD67AMAECoEG92h63UAAAAASUVORK5CYII="
];
const settingsFixtures = [
    {
        "name": "rgb default",
        "input": 0,
        "options": [
            "-bilateral-blur",
            "3"
        ],
        "expected": "133b1fff425266ff7169adffa080f3ffcf973cfffeae82ff2dc5c8ff5cdc11ff8bf357ffba0a9effe921e5ff18382cff474f73ff7666b9ffa57d01ff"
    },
    {
        "name": "rgb rectangular",
        "input": 0,
        "options": [
            "-bilateral-blur",
            "4x2+35+2"
        ],
        "expected": "1c3f2cff3b4e5bff6d67a6ffa080a1ffb98c79ffcfb392ff89ba7eff7cc27cff7cd65affb4169fffc72ac9ff653778ff69488cff76696dff907144ff"
    },
    {
        "name": "rgb zero",
        "input": 0,
        "options": [
            "-bilateral-blur",
            "0x0"
        ],
        "expected": "133b1fff425266ff7169adffa080f4ffcf973bfffeae82ff2dc5c9ff5cdc10ff8bf357ffba0a9effe921e5ff18382cff474f73ff7666baffa57d01ff"
    },
    {
        "name": "rgb zero sigma",
        "input": 0,
        "options": [
            "-bilateral-blur",
            "3x3+0+0"
        ],
        "expected": "133b1fff425266ff7169adffa080f4ffcf973bfffeae82ff2dc5c9ff5cdc10ff8bf357ffba0a9effe921e5ff18382cff474f73ff7666baffa57d01ff"
    },
    {
        "name": "rgb tile",
        "input": 0,
        "options": [
            "-virtual-pixel",
            "tile",
            "-bilateral-blur",
            "3x3+35+1"
        ],
        "expected": "503556ff514a70ff666c9fff968690ffba8d6fffbcae87ff6dbc88ff60c969ff85dd4dff9b2589ff933d7fff403f58ff4f567eff846d8affab6e6fff"
    },
    {
        "name": "rgb background",
        "input": 0,
        "options": [
            "-background",
            "#80c04080",
            "-virtual-pixel",
            "background",
            "-bilateral-blur",
            "3x3+35+1"
        ],
        "expected": "214234fe455968fb788aa4ecaeba98d8d5f07db8cded92c86dbc88ff60c969ff85dd4dffb22095febb41b7f0483a5dff4a5674fb867b77eeafb156ce"
    },
    {
        "name": "rgb red",
        "input": 0,
        "options": [
            "-channel",
            "R",
            "-bilateral-blur",
            "3x3+35+1",
            "+channel"
        ],
        "expected": "1c3b1fff425266ff6e69adff9f80f4ffc1973bffcdae82ff6dc5c9ff60dc10ff85f357ffb40a9effc721e5ff47382cff474f73ff7b66baff9a7d01ff"
    },
    {
        "name": "rgb alpha",
        "input": 0,
        "options": [
            "-channel",
            "A",
            "-bilateral-blur",
            "3x3+35+1",
            "+channel"
        ],
        "expected": "133b1fff425266ff7169adffa080f4ffcf973bfffeae82ff2dc5c9ff5cdc10ff8bf357ffba0a9effe921e5ff18382cff474f73ff7666baffa57d01ff"
    },
    {
        "name": "rgb brightness",
        "input": 0,
        "options": [
            "-intensity",
            "brightness",
            "-bilateral-blur",
            "3x3+35+1"
        ],
        "expected": "1a3e2aff3b4f5cff68829eff9d9d9effc17d69ffe884a6ff66aa96ff66be73ff8eb476ffb1556affe14bcdff1e3b35ff444f6fff877076ffa06343ff"
    },
    {
        "name": "rgb negative sigma",
        "input": 0,
        "options": [
            "-bilateral-blur",
            "3x3-35-1"
        ],
        "expected": "1c402dff425467ff6e71a9ff9f8aa4ffc1936bffcdb293ff6dbc88ff60c969ff85dd4dffb41c93ffc727c8ff473a5dff475174ff7b6776ff9a7336ff"
    },
    {
        "name": "alpha default",
        "input": 1,
        "options": [
            "-bilateral-blur",
            "3"
        ],
        "expected": "ffffff40ffffff65ffffff8affffffafffda56d4ffb688f9ffffff5effff4183ffffc8a8ff0ff4cdff25fef2ceffff57ffffff7cffffffa1ffcf02c6"
    },
    {
        "name": "alpha rectangular",
        "input": 1,
        "options": [
            "-bilateral-blur",
            "4x2+35+2"
        ],
        "expected": "ffffff47ffffff5fffffff87ffffffafffddbec3fddab2d6ffffffa2ffffff99ffffe19bff23fdc7f735f9d8ffffff91ffffff94ffffffa0ffce7bb4"
    },
    {
        "name": "alpha zero",
        "input": 1,
        "options": [
            "-bilateral-blur",
            "0x0"
        ],
        "expected": "ffffff40ffffff65ffffff8affffffafffda55d4ffb688f9ffffff5effff3d83ffffc8a8ff0ff4cdff25fef2ceffff57ffffff7cffffffa1ffcf02c6"
    },
    {
        "name": "alpha zero sigma",
        "input": 1,
        "options": [
            "-bilateral-blur",
            "3x3+0+0"
        ],
        "expected": "ffffff40ffffff65ffffff8affffffafffda55d4ffb688f9ffffff5effff3d83ffffc8a8ff0ff4cdff25fef2ceffff57ffffff7cffffffa1ffcf02c6"
    },
    {
        "name": "alpha tile",
        "input": 1,
        "options": [
            "-virtual-pixel",
            "tile",
            "-bilateral-blur",
            "3x3+35+1"
        ],
        "expected": "ffffff75ffffff77ffffff88ffffffadffd8aac8f5e3b0c8ffffff8effffff85ffffb8a3ff41f2b3e35ec4aeffffff6fffffff7cffffffa6ffb9bac4"
    },
    {
        "name": "alpha background",
        "input": 1,
        "options": [
            "-background",
            "#80c04080",
            "-virtual-pixel",
            "background",
            "-bilateral-blur",
            "3x3+35+1"
        ],
        "expected": "ffffff4bffffff66ffffff86ffffff9fffffaf9efaffb3a8ffffff8effffff85ffffb8a3ff33ecc7f255edc3ffffff7bffffff7cffffffa0ffff8ca3"
    },
    {
        "name": "alpha red",
        "input": 1,
        "options": [
            "-channel",
            "R",
            "-bilateral-blur",
            "3x3+35+1",
            "+channel"
        ],
        "expected": "ff3b1f40ff526665ff69ad8aff80f4afff973bd4fcae82f9ffc5c95effdc1083fff357a8ff0a9ecdf721e5f2ff382c57ff4f737cff66baa1ff7d01c6"
    },
    {
        "name": "alpha alpha",
        "input": 1,
        "options": [
            "-channel",
            "A",
            "-bilateral-blur",
            "3x3+35+1",
            "+channel"
        ],
        "expected": "133b1f47425266657169ad88a080f4afcf973bc9feae82d52dc5c98e5cdc10858bf357a3ba0a9ecae921e5d918382c7b474f737c7666baa5a57d01bd"
    },
    {
        "name": "alpha brightness",
        "input": 1,
        "options": [
            "-intensity",
            "brightness",
            "-bilateral-blur",
            "3x3+35+1"
        ],
        "expected": "ffffff46ffffff5fffffff85ffffffb0ffbd9ecbff92b8ebffffff89ffffff8affffffa8ff88a9c7ff57eceaf4ffff5cffffff7affffffacffaa73c0"
    },
    {
        "name": "alpha negative sigma",
        "input": 1,
        "options": [
            "-bilateral-blur",
            "3x3-35-1"
        ],
        "expected": "ffffff47ffffff65ffffff88ffffffafffe0a3c9fcdab5d5ffffff8effffff85ffffb8a3ff2be7caf731f8d9ffffff7bffffff7cfffdffa5ffc85dbd"
    }
];
for (const retained of [false, true])
it.each(settingsFixtures)(`bilateral settings $name (retained=${retained})`, async fixture => {
    const source = Buffer.from(settingsInputs[fixture.input]!, "base64"), files = new Map([["/in.png", source]]), fs = new MemoryFileSystem();
    await fs.writeFile("/in.png", source);
    const result = await runMagickCli(["/in.png", ...fixture.options, "PNG32:/out.png"], retained ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(Buffer.from(decodeImage(retained ? await fs.readFile("/out.png") : files.get("/out.png")!).data).toString("hex")).toBe(fixture.expected);
});

it("supports synchronous conversion and mogrify option operands", async () => {
    const files = new Map([["/in.png", input]]);
    expect(runMagickCliSync(["/in.png", "-bilateral-blur", "5x5+35+3", "/sync.png"], files).exitCode).toBe(0);
    expect((await runMogrifyCli(["-bilateral-blur", "5x5+35+3", "/in.png"], files)).exitCode).toBe(0);
    for (const path of ["/sync.png", "/in.png"]) expect(Buffer.from(decodeImage(files.get(path)!).data).toString("hex")).toBe(fixtures[0]!.expected);
});

for (const retained of [false, true])
it.each(["", "bad", "1001x5+35+3", "5x1001+35+3", "3x3+64+1junk"])(`rejects invalid or unbounded geometry %s without replacing output (retained=${retained})`, async geometry => {
    const files = new Map([["/in.png", input], ["/out.png", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/in.png", input); await fs.writeFile("/out.png", input);
    const result = await runMagickCli(["/in.png", "-bilateral-blur", geometry, "/out.png"], retained ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(geometry.includes("1001") ? "window exceeds limit" : "bilateral-blur");
    expect(Buffer.from(retained ? await fs.readFile("/out.png") : files.get("/out.png")!)).toEqual(input);
});

for (const retained of [false, true])
it(`preserves 16-bit precision and unselected channels (retained=${retained})`, async () => {
    const source = Buffer.from("UDYKMyAyCjY1NTM1CgPoB9ALuOpgdTBhqA+gE4gXcBtYH0AjKCcQKvgu4DLINrA6mA==", "base64"), files = new Map([["/in.ppm", source]]), fs = new MemoryFileSystem();
    await fs.writeFile("/in.ppm", source);
    const result = await runMagickCli(["/in.ppm", "-channel", "R", "-bilateral-blur", "3x3+35+1", "+channel", "/out.png"], retained ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode, result.stderr).toBe(0);
    const image = decodeImage(retained ? await fs.readFile("/out.png") : files.get("/out.png")!);
    const expected = Buffer.from("0b3207d00bb8ffffe624753061a8ffff17c513881770ffff19ce1f402328ffff23ea2af82ee0ffff2be836b03a98ffff", "hex");
    expect(Array.from(image.data16!)).toEqual(Array.from({ length: expected.length / 2 }, (_, i) => expected.readUInt16BE(i * 2)));
});

it("bounds reads, writes and cooperative work across raster chunks", () => {
    const width = 2053, pixels = new Uint8Array(width * 4);
    for (let i = 0; i < width; i++) pixels.set([64, 96, 128, 255], i * 4);
    const output = new Uint8Array(pixels.length);
    const steps = bilateralBlurPixelSteps({ width, height: 1, hasAlpha: false }, { width: 5, height: 5, x: 35, y: 3, hasOffset: true, hasYOffset: true }, { r: 0, g: 0, b: 0, a: 255 }, "tile");
    let next = steps.next(), pauses = 0;
    while (!next.done) {
        const request = next.value;
        if (!request) { pauses++; next = steps.next(); }
        else if (request.kind === "read") {
            expect(request.length).toBeLessThanOrEqual(4096);
            next = steps.next(pixels.subarray(request.position, request.position + request.length));
        } else {
            expect(request.data.length).toBeLessThanOrEqual(4096);
            output.set(request.data, request.position);
            next = steps.next();
        }
    }
    expect(pauses).toBeGreaterThan(width * 25);
    expect(output).toEqual(pixels);
});

for (const mode of ["command", "buffered", "retained", "sync"] as const)
for (const geometry of ["3x3+64+1junk", "3x3+64+1"])
it(`validates complete bilateral geometry ${geometry} (${mode})`, async () => {
    const source = Buffer.concat([Buffer.from("P6\n2 1\n255\n"), Buffer.from("0a141e5a6e82", "hex")]);
    const files = new Map([["/in.ppm", source]]), fs = new MemoryFileSystem();
    await fs.writeFile("/in.ppm", source);
    const args = ["/in.ppm", "-bilateral-blur", geometry, "-depth", "8", "rgb:-"];
    const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async chunk => { stdout.push(chunk); } },
        stderr: { write: async chunk => { stderr.push(chunk); } },
    }) : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    const invalid = geometry.endsWith("junk");
    expect(result.exitCode).toBe(invalid ? 1 : 0);
    const output = mode === "command" ? Buffer.concat(stdout) : Buffer.from("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : []);
    expect(output.toString("hex")).toBe(invalid ? "" : "14202b506275");
    if (invalid) expect(mode === "command" ? Buffer.concat(stderr).toString() : "stderr" in result ? result.stderr : "").toContain("bilateral-blur");
});
