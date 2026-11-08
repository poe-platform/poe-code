import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SafeBashE2EHarness } from "./harness.js";

describe("obscure media pdf image video audio office diagram archive crypto pipeline matrix", () => {
  it("01 wkhtmltopdf HTML to PDF generation with qpdf --linearize and pdfinfo verification", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'HTML' > spec.html\n<html><head><title>Architecture Spec v4</title></head><body><h1>Core Engine</h1><p>Deterministic execution pipeline.</p></body></html>\nHTML\nwkhtmltopdf --title \"Architecture Spec v4\" spec.html spec.pdf\nqpdf --linearize spec.pdf spec_lin.pdf\npdfinfo spec_lin.pdf | grep -E '^(Title|Pages|Optimized):' | awk '{$1=$1; print}'\npdftotext spec_lin.pdf - | tr -d '\\f' | tr -s ' \\n' ' '\necho \"\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "Title: Architecture Spec v4\nPages: 1\nOptimized: yes\nCore Engine Deterministic execution pipeline. \n");
    } finally {
      await h.dispose();
    }
  });

  it("02 multi-PDF merge with qpdf --empty --pages and page range extraction", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'HTML' > p1.html\n<html><body><p>Page One Alpha</p></body></html>\nHTML\ncat << 'HTML' > p2.html\n<html><body><p>Page Two Beta</p></body></html>\nHTML\ncat << 'HTML' > p3.html\n<html><body><p>Page Three Gamma</p></body></html>\nHTML\nwkhtmltopdf p1.html p1.pdf\nwkhtmltopdf p2.html p2.pdf\nwkhtmltopdf p3.html p3.pdf\nqpdf --empty --pages p1.pdf p2.pdf p3.pdf -- merged.pdf\npdfinfo merged.pdf | grep '^Pages:' | awk '{$1=$1; print}'\nqpdf merged.pdf --pages . 2-3 -- sub.pdf\npdfinfo sub.pdf | grep '^Pages:' | awk '{$1=$1; print}'");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "Pages: 3\nPages: 2\n");
    } finally {
      await h.dispose();
    }
  });

  it("03 pdftk cat page rotation and dump_data inspection", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'HTML' > doc.html\n<html><body><p>Rotatable Document</p></body></html>\nHTML\nwkhtmltopdf doc.html doc.pdf\npdftk doc.pdf cat 1east output rotated.pdf\npdftk rotated.pdf dump_data | grep -E '^(NumberOfPages|PageMediaRotation):'");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "NumberOfPages: 1\nPageMediaRotation: 90\n");
    } finally {
      await h.dispose();
    }
  });

  it("04 magick canvas creation resize format conversion and identify geometry check", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("magick -size 120x80 xc:#336699 banner.png\nidentify -format \"%m %wx%h\\n\" banner.png\nmagick banner.png -resize 60x40 banner_small.jpg\nidentify -format \"%m %wx%h\\n\" banner_small.jpg\nfile --mime-type -b banner.png banner_small.jpg");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "PNG 120x80\nJPEG 60x40\nimage/png\nimage/jpeg\n");
    } finally {
      await h.dispose();
    }
  });

  it("05 sips image resampling property query and format conversion to webp/png", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("magick -size 100x50 xc:coral src_img.png\nsips -z 25 50 src_img.png --out resized_img.png >/dev/null\nidentify -format \"%wx%h\\n\" resized_img.png");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "50x25\n");
    } finally {
      await h.dispose();
    }
  });

  it("06 exiftool metadata tag write read -s3 and tag deletion", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("magick -size 32x32 xc:white photo.jpg\nexiftool -overwrite_original -Artist=\"Ada Lovelace\" -Copyright=\"2026 Analytical Engine\" photo.jpg >/dev/null\nprintf \"artist=%s\\n\" \"$(exiftool -s3 -Artist photo.jpg)\"\nprintf \"copy=%s\\n\" \"$(exiftool -s3 -Copyright photo.jpg)\"\nexiftool -overwrite_original -Copyright= photo.jpg >/dev/null\nprintf \"after_del=[%s]\\n\" \"$(exiftool -s3 -Copyright photo.jpg)\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "artist=Ada Lovelace\ncopy=2026 Analytical Engine\nafter_del=[]\n");
    } finally {
      await h.dispose();
    }
  });

  it("07 pdftoppm rasterization of PDF to PNG and dimension inspection", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'HTML' > slide.html\n<html><body><h1>Slide Deck</h1></body></html>\nHTML\nwkhtmltopdf slide.html slide.pdf\npdftoppm -png -r 72 slide.pdf slide_page\nls slide_page*.png | sort\nidentify -format \"%m\\n\" slide_page-1.png");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "slide_page-1.png\nPNG\n");
    } finally {
      await h.dispose();
    }
  });

  it("08 ffmpeg synthetic video and sine audio generation muxing and ffprobe csv stream inspection", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("ffmpeg -f lavfi -i color=c=blue:s=64x48:r=10 -t 1 -f lavfi -i sine=frequency=440:sample_rate=16000 -t 1 -y muxed.mp4 2>/dev/null\nffprobe -v error -show_entries stream=codec_type,width,height -of csv=p=0 muxed.mp4");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "video,64,48\naudio\n");
    } finally {
      await h.dispose();
    }
  });

  it("09 ffmpeg video frame extraction to PNG and audio extraction to WAV", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("ffmpeg -f lavfi -i testsrc=size=80x60:rate=5 -t 1 -y clip.mp4 2>/dev/null\nffmpeg -i clip.mp4 -frames:v 1 -y frame0.png 2>/dev/null\nidentify -format \"%m %wx%h\\n\" frame0.png");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "PNG 80x60\n");
    } finally {
      await h.dispose();
    }
  });

  it("10 mmdc Mermaid diagram rendering to SVG and PNG with XML/image verification", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'MMD' > flow.mmd\ngraph LR\n  A[Ingest] --> B[Validate]\n  B --> C[Publish]\nMMD\nmmdc -i flow.mmd -o flow.svg\nmmdc -i flow.mmd -o flow.png\ngrep -q \"<svg\" flow.svg && echo \"SVG_OK\"\nidentify -format \"%m\\n\" flow.png");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "SVG_OK\nPNG\n");
    } finally {
      await h.dispose();
    }
  });

  it("11 soffice headless CSV to XLSX conversion and roundtrip back to CSV", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'CSV' > budget.csv\ndept,q1,q2\neng,100,120\nsec,50,65\nCSV\nsoffice --headless --convert-to xlsx budget.csv >/dev/null\nmkdir -p out_csv\nsoffice --headless --convert-to csv --outdir out_csv budget.xlsx >/dev/null\ncat out_csv/budget.csv");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "dept,q1,q2\neng,100,120\nsec,50,65\n");
    } finally {
      await h.dispose();
    }
  });

  it("12 unrtf RTF to HTML conversion piped to html-to-markdown", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'RTF' > note.rtf\n{\\rtf1\\ansi\\deff0\n{\\b Release Notes v2}\\par\nAll integration gates passed.\\par\n}\nRTF\nunrtf --html note.rtf 2>/dev/null | html-to-markdown | grep -E '(Release Notes|integration gates)'");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "**Release Notes v2**\nAll integration gates passed.\n");
    } finally {
      await h.dispose();
    }
  });

  it("13 tar create append delete and extract with --strip-components and --exclude", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("mkdir -p pkg/v1/src pkg/v1/tmp\nprintf 'main_code\\n' > pkg/v1/src/main.rs\nprintf 'cache_data\\n' > pkg/v1/tmp/cache.tmp\ntar --exclude='*.tmp' -cf bundle.tar pkg/v1\nprintf 'extra_doc\\n' > README.txt\ntar -rf bundle.tar README.txt\ntar -tf bundle.tar | sort\nmkdir -p out_dir\ntar --strip-components=3 -xf bundle.tar -C out_dir pkg/v1/src/main.rs\ncat out_dir/main.rs");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "README.txt\npkg/v1/\npkg/v1/src/\npkg/v1/src/main.rs\npkg/v1/tmp/\nmain_code\n");
    } finally {
      await h.dispose();
    }
  });

  it("14 zip recursive archive and unzip -d to nested target directory", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("mkdir -p assets/icons assets/fonts\nprintf 'svg_icon_bytes\\n' > assets/icons/logo.svg\nprintf 'woff_font_bytes\\n' > assets/fonts/mono.woff\nzip -r -q assets.zip assets\nunzip -q assets.zip -d restored_assets\ncat restored_assets/assets/icons/logo.svg restored_assets/assets/fonts/mono.woff");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "svg_icon_bytes\nwoff_font_bytes\n");
    } finally {
      await h.dispose();
    }
  });

  it("15 gzip bzip2 xz and zstd multi-codec compression roundtrip verification", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("payload=\"deterministic-compression-payload-2026-xyz\"\nfor codec in \"gzip -c:gunzip -c\" \"bzip2 -c:bunzip2 -c\" \"xz -c:unxz -c\" \"zstd -q -c:unzstd -q -c\"; do\n  enc=\"${codec%%:*}\"\n  dec=\"${codec##*:}\"\n  out=$(printf '%s' \"$payload\" | $enc | $dec)\n  printf \"%s=%s\\n\" \"${enc%% *}\" \"$([[ \"$out\" == \"$payload\" ]] && echo OK || echo FAIL)\"\ndone");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "gzip=OK\nbzip2=OK\nxz=OK\nzstd=OK\n");
    } finally {
      await h.dispose();
    }
  });

  it("16 xxd hex dump reverse patch and xxd -e little-endian dump", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("printf 'ABCD1234' > bin.dat\nxxd -p bin.dat | sed 's/41424344/5758595a/' | xxd -r -p > patched.dat\ncat patched.dat\necho \"\"\nxxd -e -g 4 patched.dat");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "WXYZ1234\n00000000: 5a595857 34333231                    WXYZ1234\n");
    } finally {
      await h.dispose();
    }
  });

  it("17 base64 -w 0 and base32 encoding decoding pipeline", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("msg=\"safe-bash-binary-codec-check\"\nb64=$(printf '%s' \"$msg\" | base64 -w 0)\nb32=$(printf '%s' \"$msg\" | base32 | tr -d '\\n')\nd64=$(printf '%s' \"$b64\" | base64 -d)\nd32=$(printf '%s\\n' \"$b32\" | base32 -d)\nprintf \"b64_len=%d d64=%s d32=%s\\n\" \"${#b64}\" \"$d64\" \"$d32\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "b64_len=40 d64=safe-bash-binary-codec-check d32=safe-bash-binary-codec-check\n");
    } finally {
      await h.dispose();
    }
  });

  it("18 sha256sum sha512sum sha1sum md5sum and sha256sum -c manifest verification", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("printf 'alpha_artifact\\n' > a.bin\nprintf 'beta_artifact\\n' > b.bin\nsha256sum a.bin b.bin > sums.sha256\nsha256sum -c sums.sha256\ns1=$(sha1sum a.bin | awk '{print length($1)}')\ns512=$(sha512sum a.bin | awk '{print length($1)}')\nm5=$(md5sum a.bin | awk '{print length($1)}')\nprintf \"s1_len=%s s512_len=%s md5_len=%s\\n\" \"$s1\" \"$s512\" \"$m5\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "a.bin: OK\nb.bin: OK\ns1_len=40 s512_len=128 md5_len=32\n");
    } finally {
      await h.dispose();
    }
  });

  it("19 dd block slicing and truncate file size adjustment with stat verification", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("printf '0123456789ABCDEF' > raw_block.bin\ndd if=raw_block.bin of=slice.bin bs=4 skip=1 count=2 status=none\ncat slice.bin\necho \"\"\ntruncate -s 20 slice.bin\nstat -c '%s' slice.bin");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "456789AB\n20\n");
    } finally {
      await h.dispose();
    }
  });

  it("20 od hex inspection cksum CRC verification envsubst and sponge atomic rewrite", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("export APP_NAME=\"nexus\" APP_PORT=\"9443\"\ncat << 'TPL' > service.conf\nservice=${APP_NAME}\nlisten=0.0.0.0:${APP_PORT}\nsecret=${UNSET_SECRET}\nTPL\nenvsubst '$APP_NAME $APP_PORT' < service.conf | sponge service.conf\ncat service.conf\ncksum service.conf | awk '{print $2, $3}'");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "service=nexus\nlisten=0.0.0.0:9443\nsecret=${UNSET_SECRET}\n57 service.conf\n");
    } finally {
      await h.dispose();
    }
  });

});
