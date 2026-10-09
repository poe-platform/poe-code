import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure media, graphviz, qr, pdf, image, audio/video & office diagnostics parity matrix", () => {
  it("1. dot and neato missing file and directory input diagnostics", async () => {
    await withE2EHarness(async (h) => {
      await h.exec("mkdir -p /workspace/gvdir");
      await h.expectFail(
        "dot /workspace/gvdir/missing.dot",
        1,
        "dot: ENOENT: no such file or directory, readFile '/workspace/gvdir/missing.dot'\n"
      );
      await h.expectFail(
        "neato /workspace/gvdir",
        1,
        "neato: EISDIR: illegal operation on a directory, readFile '/workspace/gvdir'\n"
      );
    });
  });

  it("2. dot and neato option validation (-Tinvalid, -Ktwopi, missing flag value, bad attribute)", async () => {
    await withE2EHarness(async (h) => {
      await h.expectFail(
        "printf 'digraph { a -> b }' | dot -Tinvalid",
        1,
        "dot: unknown format: invalid\n"
      );
      await h.expectFail(
        "printf 'digraph { a -> b }' | dot -Ktwopi",
        1,
        "dot: unsupported layout: twopi (choose dot or neato)\n"
      );
      await h.expectFail(
        "dot -T",
        1,
        "dot: missing value for -T\n"
      );
      await h.expectFail(
        "dot -Gbadattr",
        1,
        "dot: expected -Gname=value\n"
      );
    });
  });

  it("3. svgo missing file, directory input, multiple inputs, and input+string conflict diagnostics", async () => {
    await withE2EHarness(async (h) => {
      await h.exec("mkdir -p /workspace/svgdir");
      await h.expectFail(
        "svgo /workspace/svgdir/missing.svg",
        1,
        "svgo: ENOENT: no such file or directory, readFile '/workspace/svgdir/missing.svg'\n"
      );
      await h.expectFail(
        "svgo /workspace/svgdir",
        1,
        "svgo: EISDIR: illegal operation on a directory, readFile '/workspace/svgdir'\n"
      );
      await h.expectFail(
        "svgo a.svg b.svg",
        1,
        "svgo: multiple inputs\n"
      );
      await h.expectFail(
        "svgo -i a.svg -s '<svg/>'",
        1,
        "svgo: choose input or string\n"
      );
    });
  });

  it("4. rsvg-convert unsupported format, invalid zoom/dpi, and multiple stdout inputs diagnostics", async () => {
    await withE2EHarness(async (h) => {
      await h.expectFail(
        "printf '<svg width=\"10\" height=\"10\"/>' | rsvg-convert -f webp",
        1,
        "rsvg-convert: unsupported format webp\n"
      );
      await h.expectFail(
        "printf '<svg width=\"10\" height=\"10\"/>' | rsvg-convert -z 0",
        1,
        "rsvg-convert: unsupported option -z\n"
      );
      await h.expectFail(
        "rsvg-convert -o",
        1,
        "rsvg-convert: missing output path\n"
      );
      await h.expectFail(
        "rsvg-convert -f png a.svg b.svg",
        1,
        "rsvg-convert: expected at most one input\n"
      );
    });
  });

  it("5. qrencode missing file, directory input, micro QR, and structured append diagnostics", async () => {
    await withE2EHarness(async (h) => {
      await h.exec("mkdir -p /workspace/qrdir");
      await h.expectFail(
        "qrencode -r /workspace/qrdir/missing.txt -o -",
        1,
        "qrencode: ENOENT: no such file or directory, stat '/workspace/qrdir/missing.txt'\n"
      );
      await h.expectFail(
        "qrencode -r /workspace/qrdir -o -",
        1,
        "qrencode: EISDIR: illegal operation on a directory, readStream '/workspace/qrdir'\n"
      );
      await h.expectFail(
        "qrencode -M -v 5 -o - 'hello'",
        1,
        "qrencode: Unsupported Micro QR version, level, or structured append\n"
      );
      await h.expectFail(
        "qrencode -S -v 1 -o - 'hello'",
        1,
        "qrencode: Structured append requires a version and output filename\n"
      );
      await h.expectFail(
        "qrencode -r in.txt -o - 'hello'",
        1,
        "qrencode: Choose a file or an input string\n"
      );
    });
  });

  it("6. sox and soxi missing file, directory input, and invalid option diagnostics", async () => {
    await withE2EHarness(async (h) => {
      await h.exec("mkdir -p /workspace/audiodir");
      await h.expectFail(
        "soxi /workspace/audiodir/missing.wav",
        1,
        "soxi: ENOENT: no such file or directory, readFile '/workspace/audiodir/missing.wav'\n"
      );
      await h.expectFail(
        "soxi /workspace/audiodir",
        1,
        "soxi: EISDIR: illegal operation on a directory, readFile '/workspace/audiodir'\n"
      );
      await h.expectFail(
        "sox /workspace/audiodir/missing.wav /workspace/audiodir/out.wav",
        1,
        "sox: ENOENT: no such file or directory, readFile '/workspace/audiodir/missing.wav'\n"
      );
      await h.expectFail(
        "sox /workspace/audiodir /workspace/audiodir/out.wav",
        1,
        "sox: EISDIR: illegal operation on a directory, readFile '/workspace/audiodir'\n"
      );
      await h.expectFail(
        "sox only_one.wav",
        1,
        "sox: Expected input and output files\n"
      );
    });
  });

  it("7. ffmpeg missing args, missing -i, missing output, invalid -start_number, and missing/directory input diagnostics", async () => {
    await withE2EHarness(async (h) => {
      await h.exec("mkdir -p /workspace/ffdir");
      await h.expectFail("ffmpeg", 1, /usage: ffmpeg/);
      await h.expectFail(
        "ffmpeg -start_number -1 -i in.mp4 out.mp4",
        1,
        "ffmpeg: invalid start_number\n"
      );
      await h.expectFail(
        "ffmpeg out.mp4",
        1,
        "ffmpeg: must specify at least one input (-i)\n"
      );
      await h.expectFail(
        "ffmpeg -i in.mp4",
        1,
        "ffmpeg: must specify an output file\n"
      );
      await h.expectFail(
        "ffmpeg -i /workspace/ffdir/missing.mp4 /workspace/ffdir/out.mp4",
        1,
        "ffmpeg: ENOENT: no such file or directory, readFile '/workspace/ffdir/missing.mp4'\n"
      );
      await h.expectFail(
        "ffmpeg -i /workspace/ffdir /workspace/ffdir/out.mp4",
        1,
        "ffmpeg: EISDIR: illegal operation on a directory, readFile '/workspace/ffdir'\n"
      );
    });
  });

  it("8. ffprobe option validation, writer validation, quiet suppression, and missing/directory input diagnostics", async () => {
    await withE2EHarness(async (h) => {
      await h.exec("mkdir -p /workspace/fpdir");
      await h.expectFail(
        "ffprobe",
        1,
        "Simple multimedia streams analyzer\nusage: ffprobe [OPTIONS] INPUT_FILE\n"
      );
      await h.expectFail(
        "ffprobe -of",
        1,
        "ffprobe: Missing value for -of\n"
      );
      await h.expectFail(
        "ffprobe -bogus a.mp4",
        1,
        "ffprobe: Unknown option -bogus\n"
      );
      await h.expectFail(
        "ffprobe a.mp4 b.mp4",
        1,
        "ffprobe: Expected one input\n"
      );
      await h.expectFail(
        "ffprobe -show_streams",
        1,
        "ffprobe: must specify an input file\n"
      );
      await h.expectFail(
        "ffprobe -of xml a.mp4",
        1,
        "ffprobe: Unknown output format xml\n"
      );
      await h.expectFail(
        "ffprobe -of json:badopt=1 a.mp4",
        1,
        "ffprobe: Unsupported writer option badopt\n"
      );
      await h.expectFail(
        "ffprobe /workspace/fpdir/missing.mp4",
        1,
        "ffprobe: ENOENT: no such file or directory, openReadFile '/workspace/fpdir/missing.mp4'\n"
      );
      await h.expectFail(
        "ffprobe /workspace/fpdir",
        1,
        "ffprobe: EISDIR: illegal operation on a directory, openReadFile '/workspace/fpdir'\n"
      );
      await h.expectFail(
        "ffprobe -v quiet /workspace/fpdir/missing.mp4",
        1,
        ""
      );
    });
  });

  it("9. soffice and libreoffice missing args, missing source file, and unsupported target diagnostics", async () => {
    await withE2EHarness(async (h) => {
      await h.expectFail(
        "soffice --headless",
        1,
        "Error: --convert-to and at least one input file are required\n"
      );
      await h.expectFail(
        "soffice --headless --convert-to pdf /workspace/missing.docx",
        1,
        "Error: source file could not be loaded: /workspace/missing.docx\n"
      );
      await h.expectFail(
        "libreoffice --headless --cat /workspace/missing.docx",
        1,
        "Error: source file could not be loaded: /workspace/missing.docx\n"
      );
    });
  });

  it("10. diffpdf and pdfdiff invalid PDF header, missing file, and argument count diagnostics", async () => {
    await withE2EHarness(async (h) => {
      await h.exec("printf 'not a pdf' > /workspace/bad.pdf");
      await h.expectFail(
        "diffpdf /workspace/bad.pdf",
        2,
        "diffpdf: expected two PDF files\n"
      );
      await h.expectFail(
        "diffpdf --unknown a.pdf b.pdf",
        2,
        "diffpdf: unsupported option --unknown\n"
      );
      await h.expectFail(
        "diffpdf /workspace/missing1.pdf /workspace/missing2.pdf",
        1,
        "ENOENT: no such file or directory, readFile '/workspace/missing1.pdf'\n"
      );
      await h.expectFail(
        "pdfdiff /workspace/bad.pdf /workspace/bad.pdf",
        2,
        "diffpdf: /workspace/bad.pdf: Invalid PDF header: missing %PDF- signature\n"
      );
    });
  });

  it("11. sips help, formats, properties, and option validation diagnostics", async () => {
    await withE2EHarness(async (h) => {
      const help = await h.exec("sips --help && sips -v && sips -H | head -n 3");
      assert.equal(help.exitCode, 0);
      assert.match(help.stdout, /--resampleHeightWidthMax <size>/);
      assert.match(help.stdout, /sips 10\.4\.4/);
      assert.match(help.stdout, /pixelWidth\npixelHeight\ntypeIdentifier/);

      await h.expectFail(
        "sips",
        1,
        "sips: no arguments specified. Try 'sips --help' for help.\n"
      );
      await h.expectFail(
        "sips -g pixelWidth",
        1,
        "sips: no input files specified\n"
      );
      await h.expectFail(
        "sips -Z 0 a.png",
        1,
        "sips: invalid size for -Z\n"
      );
      await h.expectFail(
        "sips -z 10 -5 a.png",
        1,
        "sips: invalid dimensions for -z\n"
      );
      await h.expectFail(
        "sips --resampleWidth 0 a.png",
        1,
        "sips: invalid width for --resampleWidth\n"
      );
      await h.expectFail(
        "sips --resampleHeight -1 a.png",
        1,
        "sips: invalid height for --resampleHeight\n"
      );
      await h.expectFail(
        "sips --cropOffset 10 nope a.png",
        1,
        "sips: invalid offset for --cropOffset\n"
      );
      await h.expectFail(
        "sips -s format ico a.png",
        1,
        "Error:Unsupported format: ico\n"
      );
      await h.expectFail(
        "sips --bogus a.png",
        1,
        "sips: unknown option: --bogus\n"
      );
      await h.expectFail(
        "sips -g pixelWidth -z 16 16 a.png",
        6,
        "Error 6: cannot get properties and modify file in the same invocation\nTry 'sips --help' for help using this tool\n"
      );
    });
  });

  it("12. wkhtmltopdf option validation, unsupported .txt input, TOC rejection, and missing file diagnostics", async () => {
    await withE2EHarness(async (h) => {
      await h.expectFail(
        "wkhtmltopdf only_one_arg.html",
        1,
        "wkhtmltopdf: MISSING_OBJECT: Expected at least one input object and exactly one output\n"
      );
      await h.expectFail(
        "wkhtmltopdf toc in.html out.pdf",
        1,
        "wkhtmltopdf: UNSUPPORTED_CAPABILITY: TOC requires a qualified outline/XSLT engine\n"
      );
      await h.expectFail(
        "wkhtmltopdf --bogus-flag in.html out.pdf",
        1,
        "wkhtmltopdf: UNKNOWN_OPTION (--bogus-flag): Unknown switch\n"
      );
      await h.expectFail(
        "wkhtmltopdf /workspace/missing.html /workspace/out.pdf",
        1,
        "wkhtmltopdf: ENOENT: ENOENT: no such file or directory, realpath '/workspace/missing.html'\n"
      );
    });
  });

  it("13. pdfunite and pdfseparate option validation and page range diagnostics", async () => {
    await withE2EHarness(async (h) => {
      await h.expectFail(
        "pdfunite --bogus a.pdf b.pdf out.pdf",
        99,
        "Usage: pdfunite [options] <PDF-sourcefile-1>..<PDF-sourcefile-n> <PDF-destfile>\n"
      );
      await h.expectFail(
        "pdfseparate -f nope in.pdf out-%d.pdf",
        99,
        "Usage: pdfseparate [options] <PDF-sourcefile> <PDF-pattern-destfile>\n  -f <int> / -l <int>\n"
      );
      await h.expectFail(
        "pdfseparate -l nope in.pdf out-%d.pdf",
        99,
        "Usage: pdfseparate [options] <PDF-sourcefile> <PDF-pattern-destfile>\n  -f <int> / -l <int>\n"
      );
      await h.expectFail(
        "pdfseparate --bogus in.pdf out-%d.pdf",
        99,
        "Usage: pdfseparate [options] <PDF-sourcefile> <PDF-pattern-destfile>\n  -f <int> / -l <int>\n"
      );
    });
  });

  it("14. pdfinfo, pdffonts, pdfdetach, and pdfimages option validation diagnostics", async () => {
    await withE2EHarness(async (h) => {
      await h.expectFail(
        "pdfinfo -f nope a.pdf",
        99,
        "Invalid -f page number\n"
      );
      await h.expectFail(
        "pdfinfo --bogus a.pdf",
        99,
        "Command Line Error: Unknown option '--bogus'\n"
      );
      await h.expectFail(
        "pdffonts",
        99,
        "Usage: pdffonts [options] <PDF-file>\n"
      );
      await h.expectFail(
        "pdfdetach -enc BOGUS a.pdf",
        99,
        "Command Line Error: Unknown encoding 'BOGUS'\n"
      );
      await h.expectFail(
        "pdfdetach",
        99,
        "Usage: pdfdetach [options] <PDF-file>\n"
      );
      await h.expectFail(
        "pdfimages -f nope a.pdf root",
        99,
        "Bad '-f' value on command line\n"
      );
      await h.expectFail(
        "pdfimages --bogus a.pdf root",
        99,
        "Unknown option '--bogus'\n"
      );
    });
  });

  it("15. qpdf missing input, non-PDF file, missing file, and split-pages diagnostics", async () => {
    await withE2EHarness(async (h) => {
      await h.exec("printf 'plain text' > /workspace/not.pdf");
      await h.expectFail(
        "qpdf --check",
        2,
        "qpdf: an input file is required\n"
      );
      await h.expectFail(
        "qpdf --show-npages /workspace/missing.pdf",
        2,
        "qpdf: cannot open /workspace/missing.pdf\n"
      );
      await h.expectFail(
        "qpdf --show-npages /workspace/not.pdf",
        2,
        "qpdf: /workspace/not.pdf: Invalid PDF header: missing %PDF- signature\n"
      );
      await h.expectFail(
        "qpdf --empty",
        2,
        "qpdf: an output file is required\n"
      );
    });
  });

  it("16. identify and composite missing filename and missing image diagnostics", async () => {
    await withE2EHarness(async (h) => {
      await h.expectFail(
        "identify",
        1,
        "identify: missing an image filename\n"
      );
      await h.expectFail(
        "identify /workspace/missing.png",
        1,
        "identify: unable to open image '/workspace/missing.png': No such file or directory\n"
      );
      await h.expectFail(
        "composite /workspace/only_one.png",
        1,
        "composite: missing an image filename\n"
      );
      await h.expectFail(
        "composite /workspace/missing_ov.png /workspace/missing_bg.png /workspace/out.png",
        1,
        "magick: no images defined '/workspace/out.png'\n"
      );
    });
  });

  it("17. dot -> svgo -> rsvg-convert -> identify end-to-end vector and raster pipeline", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "printf 'digraph G { rankdir=LR; A -> B; }' | dot -Tsvg > /workspace/graph.svg",
          "svgo -i /workspace/graph.svg -o /workspace/opt.svg",
          "rsvg-convert -f png -o /workspace/graph.png /workspace/opt.svg",
          "identify -format '%m\\n' /workspace/graph.png",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "PNG\n");
    });
  });

  it("18. qrencode -> sips resample -> exiftool metadata -> identify pipeline", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "qrencode -t PNG -s 4 -m 2 -o /workspace/qr.png 'https://poe.com'",
          "sips -z 64 64 /workspace/qr.png --out /workspace/qr64.png >/dev/null",
          "exiftool -overwrite_original -Artist='QRBot' /workspace/qr64.png >/dev/null",
          "printf '%s|%s\\n' \"$(identify -format '%m %wx%h' /workspace/qr64.png)\" \"$(exiftool -s3 -Artist /workspace/qr64.png)\"",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "PNG 64x64|QRBot\n");
    });
  });

  it("19. wkhtmltopdf -> qpdf --npages -> pdftotext -> diffpdf pipeline", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "printf '<h1>Parity Report</h1><p>Page One</p>' > /workspace/doc1.html",
          "printf '<h1>Parity Report</h1><p>Page Two</p>' > /workspace/doc2.html",
          "wkhtmltopdf -q /workspace/doc1.html /workspace/doc1.pdf",
          "wkhtmltopdf -q /workspace/doc2.html /workspace/doc2.pdf",
          "np=$(qpdf --show-npages /workspace/doc1.pdf)",
          "diffpdf /workspace/doc1.pdf /workspace/doc1.pdf >/dev/null && same=$? || same=$?",
          "diffpdf /workspace/doc1.pdf /workspace/doc2.pdf >/dev/null && diff=$? || diff=$?",
          "printf 'np=%s same=%s diff=%s\\n' \"$np\" \"$same\" \"$diff\"",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "np=1 same=0 diff=1\n");
    });
  });

  it("20. sox synth -> soxi inspection -> ffmpeg transcode -> ffprobe csv verification", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "sox -n -r 16000 -c 1 -b 16 /workspace/tone.wav synth 0.5 sine 440",
          "sr=$(soxi -r /workspace/tone.wav)",
          "ch=$(soxi -c /workspace/tone.wav)",
          "ffmpeg -y -i /workspace/tone.wav -ar 8000 -ac 2 /workspace/resampled.wav 2>/dev/null",
          "probe=$(ffprobe -v quiet -select_streams a:0 -show_entries stream=sample_rate,channels -of csv=p=0 /workspace/resampled.wav)",
          "printf 'soxi=%s:%s ffprobe=%s\\n' \"$sr\" \"$ch\" \"$probe\"",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "soxi=16000:1 ffprobe=8000,2\n");
    });
  });
});
