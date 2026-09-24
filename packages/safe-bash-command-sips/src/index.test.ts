import { describe, expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { runIdentifyCli, runSipsCli } from "./index.js";

async function makeSamplePng(width = 800, height = 600): Promise<Uint8Array> {
  return sharp({
    create: { width, height, channels: 4, background: "#336699" }
  })
    .withMetadata({ density: 144 })
    .png()
    .toBuffer();
}

describe("safe-bash-command-sips (sips & identify)", () => {
  it("queries image properties with sips -g pixelWidth -g pixelHeight -g format", async () => {
    const png = await makeSamplePng(800, 600);
    const files = new Map<string, Uint8Array>([["/workspace/hero.png", png]]);

    const res = await runSipsCli(
      ["-g", "pixelWidth", "-g", "pixelHeight", "-g", "format", "/workspace/hero.png"],
      files
    );
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toBe(
      "/workspace/hero.png\n" +
        "  pixelWidth: 800\n" +
        "  pixelHeight: 600\n" +
        "  format: png\n"
    );
  });

  it("supports single-line (-1), -g all, and -g allxml property queries", async () => {
    const png = await makeSamplePng(320, 240);
    const files = new Map<string, Uint8Array>([["test.png", png]]);

    const oneLine = await runSipsCli(["-1", "-g", "pixelWidth", "-g", "pixelHeight", "test.png"], files);
    expect(oneLine.exitCode).toBe(0);
    expect(oneLine.stdout.trim()).toBe("test.png|  pixelWidth: 320|  pixelHeight: 240");

    const allRes = await runSipsCli(["-g", "all", "test.png"], files);
    expect(allRes.exitCode).toBe(0);
    expect(allRes.stdout).toContain("dpiWidth: 144.000");
    expect(allRes.stdout).toContain("space: RGB");

    const xmlRes = await runSipsCli(["-g", "allxml", "test.png"], files);
    expect(xmlRes.exitCode).toBe(0);
    expect(xmlRes.stdout).toContain("<plist version=\"1.0\">");
    expect(xmlRes.stdout).toContain("<key>pixelWidth</key>");
  });

  it("proportionally resizes with -Z and converts PNG to JPEG via -s format jpeg --out", async () => {
    const png = await makeSamplePng(800, 600);
    const files = new Map<string, Uint8Array>([["in.png", png]]);

    const res = await runSipsCli(
      ["-Z", "500", "-s", "format", "jpeg", "-s", "formatOptions", "85", "in.png", "--out", "out.jpg"],
      files
    );
    expect(res.exitCode).toBe(0);
    const outBytes = files.get("out.jpg");
    expect(outBytes).toBeDefined();

    const meta = await sharp(outBytes!).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.width).toBe(500);
    expect(meta.height).toBe(375);
  });

  it("resizes in-place with -z <height> <width> honoring sips height-first argument order", async () => {
    const png = await makeSamplePng(800, 600);
    const files = new Map<string, Uint8Array>([["in.png", png]]);

    const res = await runSipsCli(["-z", "300", "400", "in.png"], files);
    expect(res.exitCode).toBe(0);
    const updated = files.get("in.png")!;
    const meta = await sharp(updated).metadata();
    expect(meta.height).toBe(300);
    expect(meta.width).toBe(400);
  });

  it("crops (-c), rotates (-r), pads (-p --padColor), and flips (-f) images", async () => {
    const png = await makeSamplePng(400, 300);
    const files = new Map<string, Uint8Array>([["avatar.png", png]]);

    const res = await runSipsCli(
      [
        "-c", "200", "200",
        "-r", "90",
        "-p", "300", "250",
        "--padColor", "FFFFFF",
        "-f", "horizontal",
        "avatar.png",
        "--out", "avatar-card.png"
      ],
      files
    );
    expect(res.exitCode).toBe(0);
    const card = files.get("avatar-card.png")!;
    const meta = await sharp(card).metadata();
    expect(meta.height).toBe(300);
    expect(meta.width).toBe(250);
  });

  it("implements identify default one-line output, -format placeholders, and -verbose", async () => {
    const png = await makeSamplePng(640, 480);
    const files = new Map<string, Uint8Array>([["hero.png", png]]);

    const def = await runIdentifyCli(["hero.png"], files);
    expect(def.exitCode).toBe(0);
    expect(def.stdout).toBe(
      `hero.png PNG 640x480 640x480+0+0 8-bit sRGB ${png.byteLength}B 0.000u 0:00.000\n`
    );

    const fmt = await runIdentifyCli(["-format", "%f:%wx%h:%m:%z\\n", "hero.png"], files);
    expect(fmt.exitCode).toBe(0);
    expect(fmt.stdout).toBe("hero.png:640x480:PNG:8\n");

    const verb = await runIdentifyCli(["-verbose", "hero.png"], files);
    expect(verb.exitCode).toBe(0);
    expect(verb.stdout).toContain("Geometry: 640x480+0+0");
    expect(verb.stdout).toContain("Resolution: 144x144");

    // #36: sips -c pads when crop dimensions exceed source dimensions, and identify -format supports %d, %i, %n, %p, %[width], %[height]
    const smallPng = await makeSamplePng(40, 20);
    files.set("dir/sub/small.png", smallPng);
    const cropRes = await runSipsCli(["-c", "30", "30", "dir/sub/small.png", "--out", "dir/sub/cropped.png"], files);
    expect(cropRes.exitCode).toBe(0);
    const croppedMeta = await sharp(files.get("dir/sub/cropped.png")!).metadata();
    expect(croppedMeta.width).toBe(30);
    expect(croppedMeta.height).toBe(30);

    const extFmt = await runIdentifyCli(
      ["-format", "%d|%i|%n|%p|%[width]x%[height]|%[channels]|%[colorspace]\\n", "dir/sub/small.png"],
      files
    );
    expect(extFmt.exitCode).toBe(0);
    expect(extFmt.stdout).toBe("dir/sub|dir/sub/small.png|1|0|40x20|4|sRGB\n");
  });
});
