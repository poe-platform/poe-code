import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

it.each([false, true])("applies ordered dither in retained=%s", async retained => {
    for (const [argument, expected] of [["o8x8,4", [170, 170, 255, 255]], ["o8x8,2", [255, 255, 255, 255]]] as const) {
        const input = await sharp(new Uint8Array([100, 150, 200, 255]), { raw: { width: 1, height: 1, channels: 4 } }).png().toBuffer();
        const files = new Map([["input", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/input", input);
        const result = await runConvertCli(["input", "-ordered-dither", argument, "out.png"], retained ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect(Array.from(decodeImage(retained ? await fs.readFile("/out.png") : files.get("out.png")!).data)).toEqual(expected);
    }
});

// RGBA8 reference hashes from ImageMagick 7.1.2-31, including tiled map edges,
// per-channel level lists, aliases, transparency and channel masks.
const nativeCases: [string[], string][] = [
    [["-ordered-dither", "o8x8,0"], "bec824ac01eec6a6ea618fedf941119f10eef3b35a8a70432abfe27189b44793"],
    [["-ordered-dither", "o8x8,1"], "bec824ac01eec6a6ea618fedf941119f10eef3b35a8a70432abfe27189b44793"],
    [["-ordered-dither", "o8x8,2.5"], "a4aef425252801c061d84f859d8c157f8bb112e33f59dad8846652495c096159"],
    [["-ordered-dither", "o8x8,256"], "bec824ac01eec6a6ea618fedf941119f10eef3b35a8a70432abfe27189b44793"],
    [["-ordered-dither", "o8x8,4,2,3,4,5"], "17c652b110a14f627a54cee99b0727cd16d03557b0aca0e7b514b455c50fb7af"],
    [["-ordered-dither", "threshold"], "e04d29dd11f85a43feca250c169b6ec3c749b8ef6b978919f4de8642cd706bed"],
    [["-ordered-dither", "threshold,4"], "f7984d084b7eebe6db2e2d5bf15570c9c099f84d47be126317abdf35a4fe3ed7"],
    [["-ordered-dither", "threshold,3,4,5"], "b9502e6df084c73600c05b712054627954c85c65cefa4c33f91908b0800750a3"],
    [["-ordered-dither", "1x1,2"], "e04d29dd11f85a43feca250c169b6ec3c749b8ef6b978919f4de8642cd706bed"],
    [["-ordered-dither", "checks"], "247a78e95260668204ced2590ffdc4cec4c3fd0d63e45a9a10b2af0d3c3c7ec5"],
    [["-ordered-dither", "checks,4"], "9da6cd63279d1085b39b164af6196c49871c6399c302962a45739eba410443b5"],
    [["-ordered-dither", "checks,3,4,5"], "8d869c359c549ccdf320fccf3f3c2d9fb3c4d8542d1e00bf47036a6ad8fbbabb"],
    [["-ordered-dither", "2x1,2"], "247a78e95260668204ced2590ffdc4cec4c3fd0d63e45a9a10b2af0d3c3c7ec5"],
    [["-ordered-dither", "o2x2"], "7c5550cb642b51ed03de6b1451b19adf75ad062cc2cfd37d58f2cf8d0f3c7eab"],
    [["-ordered-dither", "o2x2,4"], "cdd86cb2901f8820e4bb7e470a4f4f3c4d21f014e7aa9718ec1437f878eb21cb"],
    [["-ordered-dither", "o2x2,3,4,5"], "32b2652a502b096a8ba877e5f684cc3d199147951b49ed6aec540fff98508666"],
    [["-ordered-dither", "2x2,2"], "7c5550cb642b51ed03de6b1451b19adf75ad062cc2cfd37d58f2cf8d0f3c7eab"],
    [["-ordered-dither", "o3x3"], "5f3fcf74c5f111718a31af61edb434acc87cfe9cb925f8d238e4b503241ef344"],
    [["-ordered-dither", "o3x3,4"], "6400e93ffecb6bbe938a762aa2076ede49a4bae56cf25266f5b7caf9cea910cb"],
    [["-ordered-dither", "o3x3,3,4,5"], "3c9467ca0e51edee143b2beebd8bca28411dcfe568afecea44b2c2cf7e9ffb04"],
    [["-ordered-dither", "3x3,2"], "5f3fcf74c5f111718a31af61edb434acc87cfe9cb925f8d238e4b503241ef344"],
    [["-ordered-dither", "o4x4"], "4ed741943ab116a82e8be9c1918ff6809eb85980908a99cdd5772805b21cbad6"],
    [["-ordered-dither", "o4x4,4"], "c7c2583ae41b78257fd6a3101474549cdf40270390f8026f60a3500744a26144"],
    [["-ordered-dither", "o4x4,3,4,5"], "feaa5b55af35cc6ce469dcdb27d3ed3b6fc9e17feba5a6bcffde872566216820"],
    [["-ordered-dither", "4x4,2"], "4ed741943ab116a82e8be9c1918ff6809eb85980908a99cdd5772805b21cbad6"],
    [["-ordered-dither", "o8x8"], "e18a4f16f0a9803675569c512ebf44e1752c122ac6cba5654d52bce607e00120"],
    [["-ordered-dither", "o8x8,4"], "aeefaedb2657a63ce8f153da07356e02c42d5dcb219dd54e7b8e302a5b26ed70"],
    [["-ordered-dither", "o8x8,3,4,5"], "0f7e8d51ae06fe332bdbccd52c2d70b5ac3c7cb9f414091608a528a224c95090"],
    [["-ordered-dither", "8x8,2"], "e18a4f16f0a9803675569c512ebf44e1752c122ac6cba5654d52bce607e00120"],
    [["-ordered-dither", "h4x4a"], "92868f9d58446b0298b6c407f1e3b130fb949c291de18c8b8878a9b85d2b5582"],
    [["-ordered-dither", "h4x4a,4"], "48c2529a4599689c706ed875cc99671ac4fd0baa4cf903a85ad52f45c6672fdf"],
    [["-ordered-dither", "h4x4a,3,4,5"], "c2e6cbe0dda8002792c6537350f5338cab443a58477e2f6c61f7050a25bf3cbe"],
    [["-ordered-dither", "4x1,2"], "92868f9d58446b0298b6c407f1e3b130fb949c291de18c8b8878a9b85d2b5582"],
    [["-ordered-dither", "h6x6a"], "0b6b3acc553a30824ca9a3c2111f5e1bb5cb030757766653c10709d797be5545"],
    [["-ordered-dither", "h6x6a,4"], "d96f81cef080a7a4218f8e98e1767cc82366df4fa5d62dbad908aa3d07802fb5"],
    [["-ordered-dither", "h6x6a,3,4,5"], "a0a9fdc8166135394df0fca3be024486187d3075fc49b1c184af1dbfa12af3ef"],
    [["-ordered-dither", "6x1,2"], "0b6b3acc553a30824ca9a3c2111f5e1bb5cb030757766653c10709d797be5545"],
    [["-ordered-dither", "h8x8a"], "b7920a57fe587e8c6bff04c91c2d8827aaa81034fd0d64e442b176045c2840f3"],
    [["-ordered-dither", "h8x8a,4"], "8188fcf551d8987f0e1810b5d429c7b637681f1a401e5e3d897742b6b0525e2e"],
    [["-ordered-dither", "h8x8a,3,4,5"], "40816c3dd4f47b31b72d2c3c3ed61eb39cb200075419df852f6a34e7f1ff16f6"],
    [["-ordered-dither", "8x1,2"], "b7920a57fe587e8c6bff04c91c2d8827aaa81034fd0d64e442b176045c2840f3"],
    [["-ordered-dither", "h4x4o"], "aaa1f1801a3749509a0981e573642cc757a1ef0e5efceb6282c4bb174fd7718d"],
    [["-ordered-dither", "h4x4o,4"], "ec6f04d5dfb831bbe4eac03f1a5d345f4cd37c3c940bf6cacae9bf7f8cf3e823"],
    [["-ordered-dither", "h4x4o,3,4,5"], "c02cbe1be2fab79932ff3c7498c039390a45a634dcdeab1273beaf40564fb419"],
    [["-ordered-dither", "h6x6o"], "e9f57460ffbdbcebd3f8ac4c8cafad7209c041c4162a6322f22b19d82d97bb73"],
    [["-ordered-dither", "h6x6o,4"], "14a68ab7dd57c4c382de29251ccf69a70115a0d2a48bfe416022ff454ccab821"],
    [["-ordered-dither", "h6x6o,3,4,5"], "b672cda01c05eb3a23cab2260ae9f83f70eedaba3bcfda179ed6d4216acac911"],
    [["-ordered-dither", "h8x8o"], "0d7cae09581f83ea6635558fc7c9920d6b2feedab834368bb5b6000acf683467"],
    [["-ordered-dither", "h8x8o,4"], "0781ec8f30f7dff8ba4212e369c07994ef3c867aba60abb8ccd440ebdd6fb6b9"],
    [["-ordered-dither", "h8x8o,3,4,5"], "872afa734d0cb4b364a80b8bf796303d780318903380bc643165f0d8950d3804"],
    [["-ordered-dither", "h16x16o"], "37b7fcfe1e6bc0c8fbbd5724ee485e16763818bd7308a55946785d2330a17a4e"],
    [["-ordered-dither", "h16x16o,4"], "f3969f7d96a10625ed47c4b24079c502888f796e97dc692a308534eb41528ac7"],
    [["-ordered-dither", "h16x16o,3,4,5"], "b5df14656292aa4035488b45ec05aec64be07612b9cd248e2b4ceac486122627"],
    [["-ordered-dither", "c5x5b"], "213f230f0b981a5f15df2a72df47c32895a8dcd9dfd6c195e3444c7a48bb9bf8"],
    [["-ordered-dither", "c5x5b,4"], "aad6d78490ade390985b3117e66590dd2fafda397430ae9bd8e3bbbf852b1464"],
    [["-ordered-dither", "c5x5b,3,4,5"], "9cf52bac3153109f8850583df7e3842ba35ffe0dd8c096b04e20778fbe04ec72"],
    [["-ordered-dither", "c5x5,2"], "213f230f0b981a5f15df2a72df47c32895a8dcd9dfd6c195e3444c7a48bb9bf8"],
    [["-ordered-dither", "c5x5w"], "c76e5f5f3b584a6bcd31b382d36328b11bde73c9a477c988833602ad8e82b048"],
    [["-ordered-dither", "c5x5w,4"], "358dd41f4018cd32b0e8243f520ea7efc0e2c65b3b4ae6b4d21645a716c3e40c"],
    [["-ordered-dither", "c5x5w,3,4,5"], "a37099f900c2cb868389f7ec7f1e28693bdf402b5752436c806907ea456ce9c0"],
    [["-ordered-dither", "c6x6b"], "945fa81e2c1f9927f128fac2080da93a5c09c11c84f816554bc535f6b3314166"],
    [["-ordered-dither", "c6x6b,4"], "827a8b969cd92d1971b3758f8bed28d28b08d414628db7f2cf2d87b01ab159d8"],
    [["-ordered-dither", "c6x6b,3,4,5"], "7d120e22a798ef1b3c1f7accb03b50399def45f8b1b251f757a80c04ba3b3af1"],
    [["-ordered-dither", "c6x6,2"], "945fa81e2c1f9927f128fac2080da93a5c09c11c84f816554bc535f6b3314166"],
    [["-ordered-dither", "c6x6w"], "4b3510addf536c2af2b5e6692a867f7ce3a851578ee5183f06d741b5fc9bee54"],
    [["-ordered-dither", "c6x6w,4"], "78cfbc8d8297712958338fac975470885022ad53b9508ab4886fe8e6abb7b5fc"],
    [["-ordered-dither", "c6x6w,3,4,5"], "01c4f83bacf84fee49a1ee41b7d33f368eaa09fe89e9e0c73e01eb0359ed7ca6"],
    [["-ordered-dither", "c7x7b"], "653ed3fe845bfa0ba67206be7a664ce37262cf1b24b5d3a41c83b5ee84b933d2"],
    [["-ordered-dither", "c7x7b,4"], "fea198e0211104f0cd51a87329e34af053152ce811c7cf9cdd8fbe56bc52ad90"],
    [["-ordered-dither", "c7x7b,3,4,5"], "10002d8ce99579a6233dbb42c36cf9726698565bfd16edcbd02d4d0c630fe14b"],
    [["-ordered-dither", "c7x7,2"], "653ed3fe845bfa0ba67206be7a664ce37262cf1b24b5d3a41c83b5ee84b933d2"],
    [["-ordered-dither", "c7x7w"], "1c59f0cb2c1b8a9b1dc00950b80be5350da31561f504577fdda5c7a3b2b333ae"],
    [["-ordered-dither", "c7x7w,4"], "e5320701f1a8cef300d12abff1c3d2de110e1c9de8508c2822a8c3df390f919d"],
    [["-ordered-dither", "c7x7w,3,4,5"], "21e933fc2abf289ac699fa05566600d62ad526da74361a0b23942a4e68284bd2"],
    [["-channel", "R", "-ordered-dither", "o8x8,4"], "a7e522ce48b3df2b1ed05fdb8a1e4b5ced6dbf7e8710c34b650f8c3e60b2ff37"],
    [["-channel", "Alpha", "-ordered-dither", "o8x8,4"], "22d816fc30cdc852c12f51ecddfab1d7865522132cd2ed63a2ade03a9dae4783"],
    [["-channel", "RG", "-ordered-dither", "o8x8,4"], "848d8bc877d406f34bde538b2ae8e3422d2bad54b085c54c5d58ad246ddba531"],
];
it.each([false, true])("matches native threshold maps in retained=%s", async retained => {
    const input = await sharp(Uint8Array.from({ length: 19 * 17 * 4 }, (_, i) => i * 37 % 256), { raw: { width: 19, height: 17, channels: 4 } }).png().toBuffer();
    for (const [args, expected] of nativeCases) {
        const files = new Map([["input", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/input", input);
        const filesystem = new Proxy(fs, { get(target, key) {
            if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole-file dither I/O forbidden"); };
            const value = Reflect.get(target, key, target);
            return typeof value === "function" ? value.bind(target) : value;
        } });
        expect((await runConvertCli(["input", ...args, "out.png"], retained ? { filesystem, cwd: "/" } : files)).exitCode, args.join(" ")).toBe(0);
        const output = decodeImage(retained ? await fs.readFile("/out.png") : files.get("out.png")!);
        expect(createHash("sha256").update(output.data).digest("hex"), args.join(" ")).toBe(expected);
    }
});

it.each([false, true])("rejects unsupported maps and invalid levels without replacing output, retained=%s", async retained => {
    for (const argument of ["unknown,4", "o8x8,1e999", "o8x8,2,-2"]) {
        const original = new Uint8Array([1, 2, 3]);
        const files = new Map([["out.png", original]]), fs = new MemoryFileSystem();
        await fs.writeFile("/out.png", original);
        const result = await runConvertCli(["xc:red", "-ordered-dither", argument, "out.png"], retained ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).not.toBe(0);
        expect(result.stderr).toContain("ordered-dither");
        expect(retained ? await fs.readFile("/out.png") : files.get("out.png")).toEqual(original);
    }
});

it.each([false, true])("preserves map coordinates across pixel chunks, retained=%s", async retained => {
    const input = await sharp(Uint8Array.from({ length: 1031 * 2 * 4 }, (_, i) => i * 37 % 256), { raw: { width: 1031, height: 2, channels: 4 } }).png().toBuffer();
    const files = new Map([["input", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/input", input);
    expect((await runConvertCli(["input", "-ordered-dither", "o8x8,4", "out.png"], retained ? { filesystem: fs, cwd: "/" } : files)).exitCode).toBe(0);
    const output = decodeImage(retained ? await fs.readFile("/out.png") : files.get("out.png")!);
    expect(createHash("sha256").update(output.data).digest("hex")).toBe("e9806f6e3970d6abe3eb00be31d2bf76f1b56ffedf3c0f3901166d879ca7ecb3");
});
