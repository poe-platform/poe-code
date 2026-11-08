import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SafeBashE2EHarness } from "./harness.js";

describe("obscure media, pdf, image, video, audio, office, diagram, archive, and crypto edge matrix", () => {
  it("01_magick_exiftool_png_metadata_roundtrip", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("magick -size 64x64 xc:coral /workspace/code.png\nexiftool -Artist=\"PoeSecurity\" -Comment=\"QRToken987\" -overwrite_original /workspace/code.png >/dev/null\nartist=$(exiftool -s3 -Artist /workspace/code.png)\ncomment=$(exiftool -s3 -Comment /workspace/code.png)\ndims=$(magick identify -format \"%wx%h\" /workspace/code.png)\nprintf \"dims=%s\\nartist=%s\\ncomment=%s\\n\" \"$dims\" \"$artist\" \"$comment\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "dims=64x64\nartist=PoeSecurity\ncomment=QRToken987\n");
    } finally {
      await h.dispose();
    }
  });

  it("02_magick_canvas_resize_rotate_format_convert_identify", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("magick -size 120x80 xc:navy /workspace/base.png\nmagick /workspace/base.png -resize 60x40 /workspace/half.jpg\nmagick /workspace/half.jpg -rotate 90 /workspace/rot.webp\nmagick identify -format \"%m %wx%h\\n\" /workspace/base.png /workspace/half.jpg /workspace/rot.webp");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "PNG 120x80\nJPEG 60x40\nWEBP 40x60\n");
    } finally {
      await h.dispose();
    }
  });

  it("03_sips_resize_and_property_query_on_png", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("magick -size 200x100 xc:green /workspace/card.png\nsips -z 50 100 /workspace/card.png >/dev/null\nsips -g pixelWidth -g pixelHeight -g format /workspace/card.png | awk '/pixelWidth|pixelHeight|format/{print $1 \":\" $2}'");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "pixelWidth::100\npixelHeight::50\nformat::png\n");
    } finally {
      await h.dispose();
    }
  });

  it("04_pdf_multi_page_merge_split_rotate_metadata", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'EOF' > /workspace/doc1.html\n<html><body><h1>Chapter One</h1><p>Alpha content</p></body></html>\nEOF\ncat << 'EOF' > /workspace/doc2.html\n<html><body><h1>Chapter Two</h1><p>Beta content</p></body></html>\nEOF\nwkhtmltopdf /workspace/doc1.html /workspace/c1.pdf >/dev/null 2>&1\nwkhtmltopdf /workspace/doc2.html /workspace/c2.pdf >/dev/null 2>&1\npdfunite /workspace/c1.pdf /workspace/c2.pdf /workspace/book.pdf\nqpdf --rotate=+90:1 /workspace/book.pdf /workspace/book_rot.pdf\npages=$(pdfinfo /workspace/book_rot.pdf | awk '/^Pages:/{print $2}')\npdfseparate /workspace/book_rot.pdf /workspace/page_%d.pdf\nt1=$(pdftotext /workspace/page_1.pdf - | tr -s '[:space:]' ' ' | sed 's/^ //;s/ $//')\nt2=$(pdftotext /workspace/page_2.pdf - | tr -s '[:space:]' ' ' | sed 's/^ //;s/ $//')\nprintf \"pages=%s\\nt1=%s\\nt2=%s\\n\" \"$pages\" \"$t1\" \"$t2\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "pages=2\nt1=Chapter One Alpha content\nt2=Chapter Two Beta content\n");
    } finally {
      await h.dispose();
    }
  });

  it("05_wkhtmltopdf_pdftoppm_pdfinfo_inspection_pipeline", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'EOF' > /workspace/report.html\n<html><body><h1>Quarterly Summary</h1><p>Revenue increased by 42%.</p></body></html>\nEOF\nwkhtmltopdf /workspace/report.html /workspace/report.pdf >/dev/null 2>&1\npdftoppm -png -r 72 /workspace/report.pdf /workspace/rendered\nls /workspace/rendered*.png | wc -l | tr -d ' '\npdfinfo /workspace/report.pdf | awk '/^Pages:/{print \"pages=\" $2}'");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "1\npages=1\n");
    } finally {
      await h.dispose();
    }
  });

  it("06_ffmpeg_synthesized_video_audio_mux_and_ffprobe_json", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("ffmpeg -y -f lavfi -i testsrc=duration=2:size=160x120:rate=15 -f lavfi -i sine=frequency=440:duration=2 -c:v libx264 -c:a aac /workspace/clip.mp4 >/dev/null 2>&1\nffprobe -v error -show_entries format=format_name:stream=codec_type,width,height -of json /workspace/clip.mp4 | jq -c '{streams: [.streams[] | {type: .codec_type, w: .width, h: .height}]}'");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "{\"streams\":[{\"type\":\"video\",\"w\":160,\"h\":120},{\"type\":\"audio\",\"w\":null,\"h\":null}]}\n");
    } finally {
      await h.dispose();
    }
  });

  it("07_ffmpeg_audio_wav_synthesis_and_ffprobe_csv", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("ffmpeg -y -f lavfi -i sine=frequency=880:duration=2 -ar 16000 -ac 1 /workspace/tone.wav >/dev/null 2>&1\nffprobe -v error -show_entries stream=codec_type,sample_rate,channels -of csv=p=0 /workspace/tone.wav");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "audio,16000,1\n");
    } finally {
      await h.dispose();
    }
  });

  it("08_pdftk_cat_rotate_and_dump_data_inspection", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'EOF' > /workspace/p1.html\n<html><head><title>SpecDoc</title></head><body><p>Page One</p></body></html>\nEOF\ncat << 'EOF' > /workspace/p2.html\n<html><body><p>Page Two</p></body></html>\nEOF\nwkhtmltopdf /workspace/p1.html /workspace/p1.pdf >/dev/null 2>&1\nwkhtmltopdf /workspace/p2.html /workspace/p2.pdf >/dev/null 2>&1\npdftk A=/workspace/p1.pdf B=/workspace/p2.pdf cat A1east B1 output /workspace/combined.pdf\npdftk /workspace/combined.pdf dump_data | grep -E \"^(NumberOfPages|PageMediaNumber|PageMediaRotation):\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "NumberOfPages: 2\nPageMediaNumber: 1\nPageMediaRotation: 90\nPageMediaNumber: 2\nPageMediaRotation: 0\n");
    } finally {
      await h.dispose();
    }
  });

  it("09_mmdc_mermaid_diagram_to_svg_and_png", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'EOF' > /workspace/flow.mmd\ngraph LR\n  A[Ingest] --> B[Validate]\n  B --> C[Publish]\nEOF\nmmdc -i /workspace/flow.mmd -o /workspace/flow.svg\nmmdc -i /workspace/flow.mmd -o /workspace/flow.png\nsvg_ok=$(grep -c \"Validate\" /workspace/flow.svg)\npng_info=$(magick identify -format \"%m\" /workspace/flow.png)\nprintf \"svg_has_label=%s png_fmt=%s\\n\" \"$svg_ok\" \"$png_info\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "svg_has_label=1 png_fmt=PNG\n");
    } finally {
      await h.dispose();
    }
  });

  it("10_html_to_markdown_and_unrtf_conversion", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'EOF' > /workspace/page.html\n<article><h2>Release Notes</h2><ul><li>Fast Wasm</li><li>Zero Leaks</li></ul></article>\nEOF\nmd=$(html-to-markdown /workspace/page.html | grep -E \"Release Notes|Fast Wasm|Zero Leaks\" | wc -l | tr -d ' ')\ncat << 'EOF' > /workspace/memo.rtf\n{\\rtf1\\ansi{\\b Confidential Memo}\\par Project Greenlight approved.}\nEOF\nrtf_txt=$(unrtf --text /workspace/memo.rtf | grep -E \"Confidential Memo|Project Greenlight\" | paste -sd'|' -)\nprintf \"md_lines=%s\\nrtf=%s\\n\" \"$md\" \"$rtf_txt\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "md_lines=3\nrtf=Confidential Memo|Project Greenlight approved.\n");
    } finally {
      await h.dispose();
    }
  });

  it("11_soffice_headless_txt_to_pdf_and_pdftotext", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'EOF' > /workspace/contract.txt\nService Level Agreement: 99.99% Uptime Guaranteed\nEOF\nsoffice --headless --convert-to pdf --outdir /workspace /workspace/contract.txt >/dev/null 2>&1\npdftotext /workspace/contract.pdf - | grep -o \"99.99% Uptime Guaranteed\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "99.99% Uptime Guaranteed\n");
    } finally {
      await h.dispose();
    }
  });

  it("12_tar_gzip_bzip2_xz_zstd_nested_archive_chain", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("mkdir -p /workspace/src_tree/sub\nprintf \"payload_alpha\\n\" > /workspace/src_tree/a.txt\nprintf \"payload_beta\\n\" > /workspace/src_tree/sub/b.txt\ntar -cf /workspace/tree.tar -C /workspace src_tree\ngzip -c /workspace/tree.tar > /workspace/tree.tar.gz\nbzip2 -c /workspace/tree.tar.gz > /workspace/tree.tar.gz.bz2\nxz -c /workspace/tree.tar.gz.bz2 > /workspace/tree.tar.gz.bz2.xz\nzstd -q -c /workspace/tree.tar.gz.bz2.xz > /workspace/tree.tar.gz.bz2.xz.zst\nmkdir -p /workspace/unpacked\nzstd -q -d -c /workspace/tree.tar.gz.bz2.xz.zst | xz -d -c | bzip2 -d -c | gzip -d -c | tar -xf - -C /workspace/unpacked\ncat /workspace/unpacked/src_tree/a.txt /workspace/unpacked/src_tree/sub/b.txt");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "payload_alpha\npayload_beta\n");
    } finally {
      await h.dispose();
    }
  });

  it("13_zip_unzip_selective_extract_and_list", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("mkdir -p /workspace/pkg\nprintf \"v1\" > /workspace/pkg/one.txt\nprintf \"v2\" > /workspace/pkg/two.txt\nprintf \"v3\" > /workspace/pkg/three.log\nzip -q -r /workspace/pkg.zip /workspace/pkg\nmkdir -p /workspace/out_zip\nunzip -q /workspace/pkg.zip -d /workspace/out_zip\nfind /workspace/out_zip -type f | sort | xargs head -n 1");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "==> /workspace/out_zip/workspace/pkg/one.txt <==\nv1\n==> /workspace/out_zip/workspace/pkg/three.log <==\nv3\n==> /workspace/out_zip/workspace/pkg/two.txt <==\nv2");
    } finally {
      await h.dispose();
    }
  });

  it("14_multi_hash_verification_sha256_sha512_sha1_md5", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("printf \"deterministic-crypto-seed-2026\\n\" > /workspace/seed.bin\nsha256sum /workspace/seed.bin > /workspace/seed.sha256\nsha512sum /workspace/seed.bin > /workspace/seed.sha512\nsha1sum /workspace/seed.bin > /workspace/seed.sha1\nmd5sum /workspace/seed.bin > /workspace/seed.md5\nsha256sum -c /workspace/seed.sha256\nsha512sum -c /workspace/seed.sha512\nsha1sum -c /workspace/seed.sha1\nmd5sum -c /workspace/seed.md5");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "/workspace/seed.bin: OK\n/workspace/seed.bin: OK\n/workspace/seed.bin: OK\n/workspace/seed.bin: OK\n");
    } finally {
      await h.dispose();
    }
  });

  it("15_xxd_plain_reverse_binary_patch_and_od_hex", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("printf \"HELLO_WORLD\" > /workspace/msg.bin\nhex=$(xxd -p /workspace/msg.bin | tr -d '\\n')\npatched_hex=\"${hex/574f524c44/5255535421}\"\nprintf \"%s\" \"$patched_hex\" | xxd -r -p > /workspace/patched.bin\ncat /workspace/patched.bin\nprintf \"\\n\"\nod -An -tx1 /workspace/patched.bin | tr -s ' ' | sed 's/^ //;s/ $//'");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "HELLO_RUST!\n48 45 4c 4c 4f 5f 52 55 53 54 21\n");
    } finally {
      await h.dispose();
    }
  });

  it("16_base64_base32_roundtrip_and_dd_byte_slicing", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("printf \"0123456789ABCDEFGHIJ\" | base64 | base32 > /workspace/encoded.b32\ncat /workspace/encoded.b32 | base32 -d | base64 -d > /workspace/raw.bin\ndd if=/workspace/raw.bin of=/workspace/slice.bin bs=1 skip=10 count=6 status=none\ncat /workspace/slice.bin\nprintf \"\\n\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "ABCDEF\n");
    } finally {
      await h.dispose();
    }
  });

  it("17_file_magic_detection_across_image_archive_pdf_sqlite", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("magick -size 16x16 xc:red /workspace/sample.gif\nmagick -size 16x16 xc:blue /workspace/sample.webp\nmagick -size 16x16 xc:yellow /workspace/sample.jpg\nsqlite3 /workspace/sample.db \"CREATE TABLE t(x INT); INSERT INTO t VALUES (1);\"\nfor f in /workspace/sample.gif /workspace/sample.webp /workspace/sample.jpg /workspace/sample.db; do\n  printf \"%s=%s\\n\" \"$(basename \"$f\")\" \"$(file -b --mime-type \"$f\")\"\ndone");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "sample.gif=image/gif\nsample.webp=image/webp\nsample.jpg=image/jpeg\nsample.db=application/vnd.sqlite3\n");
    } finally {
      await h.dispose();
    }
  });

  it("18_sponge_in_place_json_and_csv_transformation", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'EOF' > /workspace/items.json\n[{\"id\":2,\"v\":20},{\"id\":1,\"v\":10},{\"id\":3,\"v\":30}]\nEOF\njq -c 'sort_by(.id) | map(.v *= 2)' /workspace/items.json | sponge /workspace/items.json\ncat /workspace/items.json");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "[{\"id\":1,\"v\":20},{\"id\":2,\"v\":40},{\"id\":3,\"v\":60}]\n");
    } finally {
      await h.dispose();
    }
  });

  it("19_envsubst_variable_whitelist_template_rendering", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("export APP_NAME=\"poe-gateway\" APP_PORT=\"9090\" SECRET_KEY=\"do-not-touch\"\ncat << 'EOF' > /workspace/app.conf.tmpl\nservice=${APP_NAME}\nlisten=0.0.0.0:${APP_PORT}\nsecret=${SECRET_KEY}\nEOF\nenvsubst '${APP_NAME} ${APP_PORT}' < /workspace/app.conf.tmpl");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "service=poe-gateway\nlisten=0.0.0.0:9090\nsecret=${SECRET_KEY}\n");
    } finally {
      await h.dispose();
    }
  });

  it("20_csplit_and_pr_paginated_document_reassembly", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'EOF' > /workspace/sections.txt\nTitle: Intro\nBody line 1\n---\nTitle: Methods\nBody line 2\n---\nTitle: Results\nBody line 3\nEOF\ncsplit -q -f /workspace/sec_ /workspace/sections.txt '/^---$/' '{*}'\nfor f in /workspace/sec_*; do\n  printf \"[%s] %s\\n\" \"$(basename \"$f\")\" \"$(grep '^Title:' \"$f\")\"\ndone");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "[sec_00] Title: Intro\n[sec_01] Title: Methods\n[sec_02] Title: Results\n");
    } finally {
      await h.dispose();
    }
  });

});
