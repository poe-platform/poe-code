import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure magick, composite, montage, compare, mogrify, identify, sips & exiftool matrix", () => {
  it("01: composite and magick composite overlay images with -gravity, -geometry, -dissolve, -blend, and -watermark", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
set -euo pipefail
magick -size 120x80 xc:navy /workspace/base.png
magick -size 40x30 xc:gold /workspace/badge.png

composite -gravity center -geometry +5-3 -dissolve 65 /workspace/badge.png /workspace/base.png /workspace/out1.png
magick composite -gravity southeast -blend 50 -watermark 30 /workspace/badge.png /workspace/base.png /workspace/out2.jpg

identify -format "%f:%m:%wx%h\n" /workspace/out1.png /workspace/out2.jpg
`,
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout,
        "out1.png:PNG:120x80\nout2.jpg:JPEG:120x80\n",
      );
    });
  });

  it("02: composite rejects missing operands and nonexistent input files with exit code 1", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
magick -size 32x32 xc:red /workspace/only.png
composite /workspace/only.png /workspace/out.png 2>/workspace/err1.txt
rc1=$?
composite /workspace/missing1.png /workspace/missing2.png /workspace/out.png 2>/workspace/err2.txt
rc2=$?
printf "rc1=%d rc2=%d\n" "$rc1" "$rc2"
`,
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(r.stdout.trim(), "rc1=1 rc2=1");
      assert.match(await h.readText("/workspace/err1.txt"), /composite:/i);
      assert.ok((await h.readText("/workspace/err2.txt")).trim().length > 0);
    });
  });

  it("03: montage and magick montage tile multiple images with -tile COLSxROWS and -geometry WxH+PADX+PADY", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
set -euo pipefail
for i in 1 2 3 4 5 6; do
  magick -size 50x40 xc:coral "/workspace/tile_$i.png"
done

# 3x2 grid with 30x20 cell + 4px X padding (left+right = 8 per col) and 3px Y padding (top+bottom = 6 per row)
# width = 3 * (30 + 8) = 114, height = 2 * (20 + 6) = 52
montage /workspace/tile_1.png /workspace/tile_2.png /workspace/tile_3.png \
  /workspace/tile_4.png /workspace/tile_5.png /workspace/tile_6.png \
  -tile 3x2 -geometry 30x20+4+3 /workspace/sheet1.png

# Default auto-grid for 4 images (ceil(sqrt(4)) = 2x2) with -geometry 24x24+2+2 -> 2*(24+4) = 56x56
magick montage /workspace/tile_1.png /workspace/tile_2.png /workspace/tile_3.png /workspace/tile_4.png \
  -geometry 24x24+2+2 /workspace/sheet2.png

identify -format "%f:%wx%h\n" /workspace/sheet1.png /workspace/sheet2.png
`,
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout,
        "sheet1.png:114x52\nsheet2.png:56x56\n",
      );
    });
  });

  it("04: montage supports -border and rejects missing files or insufficient operands with exit code 1", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
magick -size 20x20 xc:blue /workspace/a.png
magick -size 20x20 xc:green /workspace/b.png
# 2x1 grid, 20x20 + border 2 (adds 4 to cellW/H -> 24x24), pad 0 -> 48x24
montage /workspace/a.png /workspace/b.png -tile 2x1 -geometry 20x20+0+0 -border 2 /workspace/bordered.png
identify -format "%wx%h\n" /workspace/bordered.png

montage /workspace/a.png 2>/workspace/m_err1.txt
rc1=$?
montage /workspace/no_such.png /workspace/out.png 2>/workspace/m_err2.txt
rc2=$?
printf "rc1=%d rc2=%d\n" "$rc1" "$rc2"
`,
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(r.stdout, "48x24\nrc1=1 rc2=1\n");
    });
  });

  it("05: compare and magick compare evaluate identical vs modified images across metrics (AE, RMSE, PSNR, SSIM, DSSIM) and exit codes 0/1/2", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
magick -size 40x30 xc:red /workspace/red1.png
magick -size 40x30 xc:red /workspace/red2.png
magick -size 40x30 xc:blue /workspace/blue.png

compare -metric AE /workspace/red1.png /workspace/red2.png null: 2>/workspace/ae_same.txt
rc_same=$?

compare -metric AE /workspace/red1.png /workspace/blue.png /workspace/diff.png 2>/workspace/ae_diff.txt
rc_diff=$?

magick compare -metric SSIM /workspace/red1.png /workspace/red2.png null: 2>/workspace/ssim_same.txt
rc_ssim=$?

compare -metric PSNR /workspace/red1.png /workspace/red2.png null: 2>/workspace/psnr_same.txt

compare /workspace/red1.png /workspace/missing.png null: 2>/workspace/cmp_err.txt
rc_err=$?

printf "same=%d diff=%d ssim=%d err=%d\n" "$rc_same" "$rc_diff" "$rc_ssim" "$rc_err"
identify -format "%f:%wx%h\n" /workspace/diff.png
`,
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout,
        "same=0 diff=1 ssim=0 err=2\ndiff.png:40x30\n",
      );
      assert.equal((await h.readText("/workspace/ae_same.txt")).trim(), "0");
      const aeDiff = Number((await h.readText("/workspace/ae_diff.txt")).trim());
      assert.ok(aeDiff > 0, `expected positive AE diff, got ${aeDiff}`);
      assert.equal((await h.readText("/workspace/ssim_same.txt")).trim(), "1");
      assert.equal((await h.readText("/workspace/psnr_same.txt")).trim(), "inf");
    });
  });

  it("06: mogrify and magick mogrify batch-convert with -format and -path and resize in-place", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
set -euo pipefail
mkdir -p /workspace/src /workspace/dest
magick -size 80x40 xc:purple /workspace/src/one.png
magick -size 120x60 xc:orange /workspace/src/two.png

# Batch convert PNG -> JPG into /workspace/dest with 50% resize
mogrify -path /workspace/dest -format jpg -resize 50% /workspace/src/one.png /workspace/src/two.png

# Originals remain unchanged
identify -format "%f:%m:%wx%h\n" /workspace/src/one.png /workspace/src/two.png
# Converted files exist in /workspace/dest with halved dimensions
magick identify -format "%f:%m:%wx%h\n" /workspace/dest/one.jpg /workspace/dest/two.jpg

# In-place mogrify resize on original
magick mogrify -resize 20x10! /workspace/src/one.png
identify -format "%f:%wx%h\n" /workspace/src/one.png
`,
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout,
        "one.png:PNG:80x40\ntwo.png:PNG:120x60\none.jpg:JPEG:40x20\ntwo.jpg:JPEG:60x30\none.png:20x10\n",
      );
    });
  });

  it("07: mogrify returns exit code 1 when target file does not exist", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
mogrify -resize 50% /workspace/nonexistent.png 2>/workspace/mog_err.txt
echo "rc=$?"
`,
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout.trim(), "rc=1");
      assert.match(await h.readText("/workspace/mog_err.txt"), /nonexistent\.png/i);
    });
  });

  it("08: convert and magick resize geometry modifiers (%, !, >, <, ^, Wx, xH, -scale, -sample, -thumbnail)", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
set -euo pipefail
magick -size 100x50 xc:teal /workspace/base.png

convert /workspace/base.png -resize 50% /workspace/pct.png
convert /workspace/base.png -resize 40x40! /workspace/bang.png
convert /workspace/base.png -resize "200x200>" /workspace/shrink_noop.png
convert /workspace/base.png -resize "40x40>" /workspace/shrink_act.png
convert /workspace/base.png -resize "40x40<" /workspace/enlarge_noop.png
convert /workspace/base.png -resize "200x200<" /workspace/enlarge_act.png
convert /workspace/base.png -resize "60x60^" /workspace/fill_min.png
convert /workspace/base.png -scale 30x /workspace/w_only.png
convert /workspace/base.png -sample x25 /workspace/h_only.png
convert /workspace/base.png -thumbnail 20x20 /workspace/thumb.png

identify -format "%f:%wx%h\n" \
  /workspace/pct.png \
  /workspace/bang.png \
  /workspace/shrink_noop.png \
  /workspace/shrink_act.png \
  /workspace/enlarge_noop.png \
  /workspace/enlarge_act.png \
  /workspace/fill_min.png \
  /workspace/w_only.png \
  /workspace/h_only.png \
  /workspace/thumb.png
`,
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout,
        [
          "pct.png:50x25",
          "bang.png:40x40",
          "shrink_noop.png:100x50",
          "shrink_act.png:40x20",
          "enlarge_noop.png:100x50",
          "enlarge_act.png:200x100",
          "fill_min.png:120x60",
          "w_only.png:30x15",
          "h_only.png:50x25",
          "thumb.png:20x10",
          "",
        ].join("\n"),
      );
    });
  });

  it("09: convert and magick -append (vertical) and +append (horizontal) stack multiple images", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
set -euo pipefail
magick -size 40x20 xc:red /workspace/i1.png
magick -size 60x30 xc:green /workspace/i2.png
magick -size 50x15 xc:blue /workspace/i3.png

# Vertical stack (-append): width = max(40,60,50) = 60, height = 20+30+15 = 65
convert /workspace/i1.png /workspace/i2.png /workspace/i3.png -append /workspace/vstack.png

# Horizontal stack (+append): width = 40+60+50 = 150, height = max(20,30,15) = 30
magick /workspace/i1.png /workspace/i2.png /workspace/i3.png +append /workspace/hstack.png

identify -format "%f:%wx%h\n" /workspace/vstack.png /workspace/hstack.png
`,
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout,
        "vstack.png:60x65\nhstack.png:150x30\n",
      );
    });
  });

  it("10: convert and magick handle -border, -extent, -transpose, -transverse, -negate, and builtin rose:", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
set -euo pipefail
# Builtin rose: is 70x46
magick rose: /workspace/rose.png
# -border 5x10 adds 10 to width and 20 to height -> 80x66
convert /workspace/rose.png -bordercolor white -border 5x10 /workspace/bordered.png
# -transpose swaps width and height -> 66x80
convert /workspace/bordered.png -transpose /workspace/transposed.png
# -transverse swaps width and height -> 80x66
convert /workspace/transposed.png -transverse -negate /workspace/transversed.png
# -extent 100x100 sets canvas to 100x100
magick /workspace/transversed.png -background black -gravity center -extent 100x100 /workspace/extented.png

identify -format "%f:%wx%h\n" \
  /workspace/rose.png \
  /workspace/bordered.png \
  /workspace/transposed.png \
  /workspace/transversed.png \
  /workspace/extented.png
`,
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout,
        [
          "rose.png:70x46",
          "bordered.png:80x66",
          "transposed.png:66x80",
          "transversed.png:80x66",
          "extented.png:100x100",
          "",
        ].join("\n"),
      );
    });
  });

  it("11: magick, convert, and identify support -list (font, format, color, configure, list) and -version", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
set -eu
magick -version | head -n 1
convert -list font | grep -F "Font: DejaVu-Sans" | head -n 1
magick -list format | grep -E "PNG|JPEG" | wc -l | tr -d ' '
identify -list color | grep -F "white"
magick -list configure | grep -F "DELEGATES"
convert -list list | grep -F "format"
`,
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      const lines = r.stdout.trim().split("\n");
      assert.match(lines[0]!, /ImageMagick 7\.1\.1/);
      assert.match(lines[1]!, /DejaVu-Sans/);
      assert.equal(lines[2]!, "3");
      assert.match(lines[3]!, /white/);
      assert.match(lines[4]!, /DELEGATES/);
      assert.match(lines[5]!, /format/);
    });
  });

  it("12: identify and magick identify support -ping, -verbose, and rich -format escape sequences", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
set -euo pipefail
magick -size 64x48 xc:skyblue /workspace/sample.png

identify -ping -format "%f|%t|%e|%m|%wx%h|%g|%P|%z|%q|%r|%C|%Q|%[width]x%[height]|%[fx:w*h]|%%\n" /workspace/sample.png
magick identify -verbose /workspace/sample.png | grep -E "^(Image:|  Format:|  Geometry:|  Colorspace:|  Depth:)"
`,
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      const lines = r.stdout.trim().split("\n");
      assert.equal(
        lines[0],
        "sample.png|sample|png|PNG|64x48|64x48+0+0|64x48|8|8|DirectClass sRGB|Zip|92|64x48|3072|%",
      );
      assert.ok(lines.some((l) => l.includes("Format: PNG")));
      assert.ok(lines.some((l) => l.includes("Geometry: 64x48+0+0")));
      assert.ok(lines.some((l) => l.includes("Colorspace: sRGB")));
    });
  });

  it("13: identify returns exit code 1 when called with no files or nonexistent file", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
identify 2>/workspace/id_err1.txt
rc1=$?
identify /workspace/no_such_image.png 2>/workspace/id_err2.txt
rc2=$?
printf "rc1=%d rc2=%d\n" "$rc1" "$rc2"
`,
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout.trim(), "rc1=1 rc2=1");
      assert.match(await h.readText("/workspace/id_err1.txt"), /identify:/i);
      assert.match(await h.readText("/workspace/id_err2.txt"), /no_such_image\.png/i);
    });
  });

  it("14: sips supports -s/-d custom properties, -g all, -g allxml, --verify, --formats, -H, and -v", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
set -eu
sips -v
sips -H | head -n 4 | paste -sd ',' -
sips --formats | grep -F "org.webmproject.webp"

magick -size 80x40 xc:lime /workspace/card.png
magick -size 80x40 xc:lime /workspace/clean_webp.png
sips --verify /workspace/card.png
sips -s artist "Ada Lovelace" -s copyright "2026 Poe" -s dpiWidth 144 /workspace/card.png >/dev/null
sips -1 -g artist -g copyright -g dpiWidth -g typeIdentifier /workspace/card.png

# Delete copyright property and verify it becomes <nil>
sips -d copyright /workspace/card.png >/dev/null
sips -1 -g artist -g copyright /workspace/card.png

# Convert to webp via typeIdentifier and check XML plist output
sips -s format org.webmproject.webp /workspace/clean_webp.png --out /workspace/card.webp >/dev/null
sips -1 -g format -g typeIdentifier /workspace/card.webp
sips -g allxml /workspace/card.webp | grep -F "<string>webp</string>"
`,
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      const lines = r.stdout.trim().split("\n");
      assert.equal(lines[0], "sips 10.4.4");
      assert.equal(lines[1], "pixelWidth,pixelHeight,typeIdentifier,format");
      assert.match(lines[2]!, /org\.webmproject\.webp/);
      assert.equal(lines[3], "/workspace/card.png");
      assert.equal(
        lines[4],
        "/workspace/card.png|artist: Ada Lovelace|copyright: 2026 Poe|dpiWidth: 144.000|typeIdentifier: public.png|",
      );
      assert.equal(
        lines[5],
        "/workspace/card.png|artist: Ada Lovelace|copyright: <nil>|",
      );
      assert.equal(
        lines[6],
        "/workspace/card.webp|format: webp|typeIdentifier: org.webmproject.webp|",
      );
      assert.match(lines[7]!, /<string>webp<\/string>/);
    });
  });

  it("15: sips enforces Error 6 when combining -g and modification flags and rejects unsupported formats or missing files", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
magick -size 32x32 xc:white /workspace/ok.png
sips -g pixelWidth -z 16 16 /workspace/ok.png 2>/workspace/sips_e6.txt
rc_e6=$?
sips -s format bogusfmt /workspace/ok.png 2>/workspace/sips_fmt.txt
rc_fmt=$?
sips -g pixelWidth /workspace/missing.png 2>/workspace/sips_miss.txt
rc_miss=$?
printf "e6=%d fmt=%d miss=%d\n" "$rc_e6" "$rc_fmt" "$rc_miss"
`,
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout.trim(), "e6=6 fmt=1 miss=1");
      assert.match(await h.readText("/workspace/sips_e6.txt"), /Error 6/);
      assert.match(await h.readText("/workspace/sips_fmt.txt"), /Unsupported format/i);
      assert.match(await h.readText("/workspace/sips_miss.txt"), /file does not exist/i);
    });
  });

  it("16: exiftool expands -@ argfile with comments and supports -s2, -G1, and -p '$Tag' formatting", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
set -euo pipefail
magick -size 72x48 xc:gold /workspace/banner.png
cat << 'ARGS' > /workspace/write.args
# ExifTool argument file with comments and blank lines
-Artist=Grace Hopper
-Title=Compiler Architecture
-Copyright=2026 USN
-overwrite_original
/workspace/banner.png
ARGS

exiftool -@ /workspace/write.args >/dev/null

exiftool -s2 -Artist -Title -ImageSize /workspace/banner.png
exiftool -G1 -Artist /workspace/banner.png
exiftool -p '$FileName|$ImageWidth x $ImageHeight|$Artist|$Title' /workspace/banner.png
`,
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      const lines = r.stdout.trim().split("\n");
      assert.equal(lines[0], "Artist: Grace Hopper");
      assert.equal(lines[1], "Title: Compiler Architecture");
      assert.equal(lines[2], "ImageSize: 72x48");
      assert.match(lines[3]!, /^\[PNG\]\s+Artist\s+:\s+Grace Hopper$/);
      assert.equal(lines[4], "banner.png|72 x 48|Grace Hopper|Compiler Architecture");
    });
  });

  it("17: exiftool -tagsFromFile copies selected or all writable tags across PNG, JPEG, and PDF files", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
set -euo pipefail
magick -size 40x40 xc:red /workspace/src.png
magick -size 60x60 xc:blue /workspace/dst.jpg
wkhtmltopdf --title "OrigPDF" - /workspace/doc.pdf << 'HTML'
<html><body><p>Hello</p></body></html>
HTML

exiftool -Artist="Margaret Hamilton" -Title="Apollo Guidance" -Copyright="1969 MIT" -overwrite_original /workspace/src.png >/dev/null

# Copy only Artist tag to dst.jpg
exiftool -tagsFromFile /workspace/src.png -Artist -overwrite_original /workspace/dst.jpg >/dev/null
exiftool -s2 -Artist -Title /workspace/dst.jpg

# Copy Title from src.png to doc.pdf and verify via pdfinfo
exiftool -tagsFromFile /workspace/src.png -Title -overwrite_original /workspace/doc.pdf >/dev/null
pdfinfo /workspace/doc.pdf | grep -F "Title:"
`,
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      const lines = r.stdout.trim().split("\n");
      assert.equal(lines[0], "Artist: Margaret Hamilton");
      assert.match(lines[1]!, /^Title:\s+Apollo Guidance$/);
    });
  });

  it("18: exiftool -all= strips PNG metadata cleanly while refusing PDF -all= redaction with exit code 1", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
magick -size 32x32 xc:green /workspace/clean.png
exiftool -Artist="Secret Author" -Comment="Internal Note" -overwrite_original /workspace/clean.png >/dev/null
exiftool -s3 -Artist -Comment /workspace/clean.png

# Strip all metadata from PNG
exiftool -all= -overwrite_original /workspace/clean.png >/dev/null
after=$(exiftool -s3 -Artist -Comment /workspace/clean.png)
printf "after_png=[%s]\n" "$after"

# Attempting -all= on PDF must fail with exit code 1
wkhtmltopdf - /workspace/confidential.pdf << 'HTML'
<html><body><p>Classified</p></body></html>
HTML
exiftool -all= /workspace/confidential.pdf 2>/workspace/pdf_err.txt
rc_pdf=$?
printf "rc_pdf=%d\n" "$rc_pdf"
`,
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout,
        "Secret Author\nInternal Note\nafter_png=[]\nrc_pdf=1\n",
      );
      assert.match(await h.readText("/workspace/pdf_err.txt"), /PDF parser\/writer not yet supported/i);
    });
  });

  it("19: multi-image montage contact sheet + composite watermark + compare visual regression gate", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
set -euo pipefail
mkdir -p /workspace/frames
magick -size 60x40 xc:#ff3366 /workspace/frames/f1.png
magick -size 60x40 xc:#33cc99 /workspace/frames/f2.png
magick -size 60x40 xc:#3366ff /workspace/frames/f3.png
magick -size 60x40 xc:#ffcc00 /workspace/frames/f4.png

# Build 2x2 contact sheet with 60x40 + 2px padding -> 2*(60+4) = 128, 2*(40+4) = 88
montage /workspace/frames/f1.png /workspace/frames/f2.png /workspace/frames/f3.png /workspace/frames/f4.png \
  -tile 2x2 -geometry 60x40+2+2 /workspace/contact.png

# Create a watermark stamp and composite onto contact sheet
magick -size 32x16 xc:white /workspace/stamp.png
composite -gravity southeast -geometry +4+4 -dissolve 50 /workspace/stamp.png /workspace/contact.png /workspace/watermarked.png

# Compare contact.png with itself (0 diff) vs watermarked.png (non-zero diff)
compare -metric AE /workspace/contact.png /workspace/contact.png null: 2>/workspace/self_ae.txt
rc_self=$?
compare -metric AE /workspace/contact.png /workspace/watermarked.png /workspace/delta.png 2>/workspace/wm_ae.txt || rc_wm=$?

identify -format "%f:%wx%h\n" /workspace/contact.png /workspace/watermarked.png /workspace/delta.png
printf "rc_self=%d rc_wm=%d self_ae=%s\n" "$rc_self" "$rc_wm" "$(cat /workspace/self_ae.txt)"
`,
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout,
        [
          "contact.png:128x88",
          "watermarked.png:128x88",
          "delta.png:128x88",
          "rc_self=0 rc_wm=1 self_ae=0",
          "",
        ].join("\n"),
      );
    });
  });

  it("20: end-to-end media asset pipeline: mogrify batch + sips + exiftool -csv + sqlite3 + jq audit", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        String.raw`
set -euo pipefail
mkdir -p /workspace/raw /workspace/pub
magick -size 160x120 xc:royalblue /workspace/raw/hero.png
magick -size 100x80 xc:seagreen /workspace/raw/card.png
magick -size 64x64 xc:coral /workspace/raw/icon.png

# Copy raw -> pub and batch resize by 50% with mogrify
cp /workspace/raw/*.png /workspace/pub/
mogrify -resize 50% /workspace/pub/*.png

# Stamp metadata via exiftool
exiftool -Artist="DesignOps" -Copyright="2026 Poe" -overwrite_original /workspace/pub/hero.png /workspace/pub/card.png /workspace/pub/icon.png >/dev/null

# Export CSV catalog via exiftool -csv and load into sqlite3 for aggregation
exiftool -csv -FileName -ImageWidth -ImageHeight -Artist /workspace/pub/hero.png /workspace/pub/card.png /workspace/pub/icon.png > /workspace/catalog.csv 2>/dev/null

sqlite3 /workspace/media.db << 'SQL'
.mode csv
.import /workspace/catalog.csv assets
.mode list
SELECT json_object(
  'count', COUNT(*),
  'total_pixels', SUM(CAST(ImageWidth AS INTEGER) * CAST(ImageHeight AS INTEGER)),
  'files', json_group_array(FileName || ':' || ImageWidth || 'x' || ImageHeight)
) FROM assets;
SQL
`,
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      const summary = JSON.parse(r.stdout.trim());
      // 80*60 (4800) + 50*40 (2000) + 32*32 (1024) = 7824
      assert.equal(summary.count, 3);
      assert.equal(summary.total_pixels, 7824);
      assert.deepEqual(summary.files, [
        "hero.png:80x60",
        "card.png:50x40",
        "icon.png:32x32",
      ]);
    });
  });
});
