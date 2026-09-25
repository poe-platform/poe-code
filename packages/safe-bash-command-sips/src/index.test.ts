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
    expect(oneLine.stdout.trim()).toBe("test.png|pixelWidth: 320|pixelHeight: 240|");

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

    // #43: sips -1 (--oneLine) formatting matches /usr/bin/sips
    const oneLineRes = await runSipsCli(["-1", "-g", "pixelWidth", "-g", "pixelHeight", "dir/sub/small.png"], files);
    expect(oneLineRes.exitCode).toBe(0);
    expect(oneLineRes.stdout).toBe("dir/sub/small.png|pixelWidth: 40|pixelHeight: 20|\n");

    // #42: identify [frame] bracket selector syntax
    const subFrameRes = await runIdentifyCli(["-format", "%wx%h", "dir/sub/small.png[0]"], files);
    expect(subFrameRes.exitCode).toBe(0);
    expect(subFrameRes.stdout).toBe("40x20");
  });

  it("supports iPhone HEIC, HEIF, and AVIF conversion and inspection in sips and identify", async () => {
    const png = await makeSamplePng(320, 240);
    const files = new Map<string, Uint8Array>([["IMG_0001.png", png]]);

    const convHeic = await runSipsCli(
      ["-s", "format", "heic", "IMG_0001.png", "--out", "IMG_0001.heic"],
      files
    );
    expect(convHeic.exitCode).toBe(0);
    expect(files.has("IMG_0001.heic")).toBe(true);

    const sipsQuery = await runSipsCli(["-g", "all", "IMG_0001.heic"], files);
    expect(sipsQuery.exitCode).toBe(0);
    expect(sipsQuery.stdout).toContain("pixelWidth: 320");
    expect(sipsQuery.stdout).toContain("pixelHeight: 240");
    expect(sipsQuery.stdout).toContain("typeIdentifier: public.heic");
    expect(sipsQuery.stdout).toContain("format: heic");

    const idQuery = await runIdentifyCli(["IMG_0001.heic"], files);
    expect(idQuery.exitCode).toBe(0);
    expect(idQuery.stdout).toContain("IMG_0001.heic HEIC 320x240");

    // Convert HEIC back to JPEG via sips
    const convJpg = await runSipsCli(
      ["-Z", "160", "-s", "format", "jpeg", "IMG_0001.heic", "--out", "IMG_0001.jpg"],
      files
    );
    expect(convJpg.exitCode).toBe(0);
    const jpgMeta = await sharp(files.get("IMG_0001.jpg")!).metadata();
    expect(jpgMeta.format).toBe("jpeg");
    expect(jpgMeta.width).toBe(160);
    expect(jpgMeta.height).toBe(120);
  });

  it("matches macOS /usr/bin/sips slot precedence when combining --resampleWidth/--resampleHeight and -c/--padToHeightWidth (#52)", async () => {
    const png200x100 = await makeSamplePng(200, 100);
    const files = new Map<string, Uint8Array>([["/work/in.png", png200x100]]);

    await runSipsCli(
      ["--resampleWidth", "100", "--resampleHeight", "100", "/work/in.png", "--out", "/work/res.png"],
      files
    );
    const resMeta = await sharp(files.get("/work/res.png")!).metadata();
    expect(resMeta.width).toBe(100);
    expect(resMeta.height).toBe(50);

    const png240x160 = await sharp({
      create: { width: 240, height: 160, channels: 4, background: { r: 40, g: 120, b: 220, alpha: 1 } }
    })
      .png()
      .toBuffer();
    files.set("/work/blue.png", png240x160);
    await runSipsCli(
      ["-Z", "120", "-r", "90", "-c", "80", "60", "--padToHeightWidth", "100", "100", "--padColor", "FF0000", "/work/blue.png", "--out", "/work/pad.png"],
      files
    );
    const padRaw = await sharp(files.get("/work/pad.png")!).raw().toBuffer();
    // At (50, 5), the rotated 80x120 image was cropped to 80x100 and padded to 100x100, so (50, 5) is blue (40, 120, 220), not red!
    const topIdx = (5 * 100 + 50) * 4;
    expect(padRaw[topIdx]).toBe(40);
    expect(padRaw[topIdx + 1]).toBe(120);
    expect(padRaw[topIdx + 2]).toBe(220);
  });

  it("updates file extension when --out points to an existing directory or batch output with -s format (#59)", async () => {
    const png80x40 = await makeSamplePng(80, 40);
    const png60x90 = await makeSamplePng(60, 90);
    const files = new Map<string, Uint8Array>([
      ["/work/a.png", png80x40],
      ["/work/b.png", png60x90]
    ]);

    const batchRes = await runSipsCli(
      ["-Z", "30", "-s", "format", "jpeg", "/work/a.png", "/work/b.png", "--out", "/work/out"],
      files
    );
    expect(batchRes.exitCode).toBe(0);
    expect(files.has("/work/out/a.jpg")).toBe(true);
    expect(files.has("/work/out/b.jpg")).toBe(true);
    const metaA = await sharp(files.get("/work/out/a.jpg")!).metadata();
    expect(metaA.format).toBe("jpeg");
    expect(metaA.width).toBe(30);
    expect(metaA.height).toBe(15);

    // Single file when /work/out already exists as a directory (contains /work/out/a.jpg)
    const singleRes = await runSipsCli(
      ["-s", "format", "webp", "/work/a.png", "--out", "/work/out"],
      files
    );
    expect(singleRes.exitCode).toBe(0);
    expect(files.has("/work/out/a.webp")).toBe(true);
  });

  it("executes resample operations before rotate (-r) matching /usr/bin/sips (#67)", async () => {
    const png100x60 = await makeSamplePng(100, 60);
    const files = new Map<string, Uint8Array>([["/work/in.png", png100x60]]);

    const res1 = await runSipsCli(
      ["-r", "90", "--resampleWidth", "40", "/work/in.png", "--out", "/work/out1.png"],
      files
    );
    expect(res1.exitCode).toBe(0);
    const meta1 = await sharp(files.get("/work/out1.png")!).metadata();
    expect(meta1.width).toBe(24);
    expect(meta1.height).toBe(40);

    const res2 = await runSipsCli(
      ["-r", "90", "-z", "30", "40", "/work/in.png", "--out", "/work/out2.png"],
      files
    );
    expect(res2.exitCode).toBe(0);
    const meta2 = await sharp(files.get("/work/out2.png")!).metadata();
    expect(meta2.width).toBe(30);
    expect(meta2.height).toBe(40);
  });

  it("converts images to PDF via sips -s format pdf --out matching /usr/bin/sips (#70)", async () => {
    const png = await makeSamplePng(64, 48);
    const files = new Map<string, Uint8Array>([["/work/in.png", png]]);
    const res = await runSipsCli(
      ["-Z", "32", "-s", "format", "pdf", "/work/in.png", "--out", "/work/out.pdf"],
      files
    );
    expect(res.exitCode).toBe(0);
    expect(files.has("/work/out.pdf")).toBe(true);
    const meta = await sharp(files.get("/work/out.pdf")!).metadata();
    expect(meta.format).toBe("pdf");
    expect(meta.width).toBe(32);
    expect(meta.height).toBe(24);
  });
});
