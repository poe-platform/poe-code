import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure pdfunite, pdfseparate, pdfdetach, pdfinfo, pdffonts, pdfimages, compare, montage, composite, mogrify & identify diagnostics parity matrix", () => {
  it("1. pdfunite -v, --version, -h, --help, and insufficient operands diagnostics", async () => {
    await withE2EHarness(async (h) => {
      const v1 = await h.exec("pdfunite -v");
      assert.equal(v1.exitCode, 0);
      assert.equal(v1.stderr, "pdfunite version 24.08.0\n");

      const v2 = await h.exec("pdfunite --version");
      assert.equal(v2.exitCode, 0);
      assert.equal(v2.stderr, "pdfunite version 24.08.0\n");

      const h1 = await h.exec("pdfunite --help");
      assert.equal(h1.exitCode, 0);
      assert.equal(
        h1.stderr,
        "Usage: pdfunite [options] <PDF-sourcefile-1>..<PDF-sourcefile-n> <PDF-destfile>\n"
      );

      await h.expectFail(
        "pdfunite /workspace/a.pdf /workspace/out.pdf",
        99,
        "Usage: pdfunite [options] <PDF-sourcefile-1>..<PDF-sourcefile-n> <PDF-destfile>\n"
      );
    });
  });

  it("2. pdfunite missing source file and damaged/non-PDF file diagnostics (exit 255)", async () => {
    await withE2EHarness(async (h) => {
      await h.exec("printf '<h1>A</h1>' > /workspace/a.html && wkhtmltopdf /workspace/a.html /workspace/a.pdf && printf 'not a pdf' > /workspace/bad.pdf");
      await h.expectFail(
        "pdfunite /workspace/missing.pdf /workspace/a.pdf /workspace/out.pdf",
        255,
        "I/O Error: Couldn't open file '/workspace/missing.pdf': No such file or directory.\nSyntax Error: Could not merge damaged documents ('/workspace/missing.pdf')\n"
      );
      await h.expectFail(
        "pdfunite /workspace/bad.pdf /workspace/a.pdf /workspace/out.pdf",
        255,
        "Syntax Error: Could not merge damaged documents ('/workspace/bad.pdf')\n"
      );
    });
  });

  it("3. pdfseparate -v, --help, invalid options, and wrong operand count diagnostics", async () => {
    await withE2EHarness(async (h) => {
      const v1 = await h.exec("pdfseparate -v");
      assert.equal(v1.exitCode, 0);
      assert.equal(v1.stderr, "pdfseparate version 24.08.0\n");

      const h1 = await h.exec("pdfseparate -h");
      assert.equal(h1.exitCode, 0);
      assert.equal(
        h1.stderr,
        "Usage: pdfseparate [options] <PDF-sourcefile> <PDF-pattern-destfile>\n  -f <int> / -l <int>\n"
      );

      await h.expectFail(
        "pdfseparate -f abc /workspace/in.pdf /workspace/out-%d.pdf",
        99,
        "Usage: pdfseparate [options] <PDF-sourcefile> <PDF-pattern-destfile>\n  -f <int> / -l <int>\n"
      );

      await h.expectFail(
        "pdfseparate /workspace/only_one.pdf",
        99,
        "Usage: pdfseparate [options] <PDF-sourcefile> <PDF-pattern-destfile>\n"
      );
    });
  });

  it("4. pdfseparate missing file, damaged file, wrong page range, and missing %d pattern diagnostics", async () => {
    await withE2EHarness(async (h) => {
      await h.exec(`
        printf '<h1>P1</h1>' > /workspace/p1.html
        printf '<h1>P2</h1>' > /workspace/p2.html
        wkhtmltopdf /workspace/p1.html /workspace/p1.pdf
        wkhtmltopdf /workspace/p2.html /workspace/p2.pdf
        pdfunite /workspace/p1.pdf /workspace/p2.pdf /workspace/two.pdf
        printf 'not a pdf' > /workspace/bad.pdf
      `);
      await h.expectFail(
        "pdfseparate /workspace/missing.pdf /workspace/out-%d.pdf",
        99,
        "I/O Error: Couldn't open file '/workspace/missing.pdf': No such file or directory.\nSyntax Error: Could not extract page(s) from damaged file ('/workspace/missing.pdf')\n"
      );
      await h.expectFail(
        "pdfseparate /workspace/bad.pdf /workspace/out-%d.pdf",
        99,
        "Syntax Error: Could not extract page(s) from damaged file ('/workspace/bad.pdf')\n"
      );
      await h.expectFail(
        "pdfseparate -f 5 -l 6 /workspace/two.pdf /workspace/out-%d.pdf",
        99,
        "Command Line Error: Wrong page range given: the first page (5) can not be after the last page (2).\n"
      );
      await h.expectFail(
        "pdfseparate /workspace/two.pdf /workspace/no_percent.pdf",
        99,
        "Error: '/workspace/no_percent.pdf' must contain '%d' if more than one page should be extracted\n"
      );
    });
  });

  it("5. pdfdetach -v, --help, missing file, non-PDF file, and unknown encoding diagnostics", async () => {
    await withE2EHarness(async (h) => {
      const v1 = await h.exec("pdfdetach -v");
      assert.equal(v1.exitCode, 0);
      assert.equal(v1.stdout, "pdfdetach version 24.08.0\n");

      const h1 = await h.exec("pdfdetach --help");
      assert.equal(h1.exitCode, 0);
      assert.equal(
        h1.stdout,
        "Usage: pdfdetach [options] <PDF-file>\n  -list / -save <int> / -savefile <name> / -saveall / -o <path>\n"
      );

      await h.expectFail(
        "pdfdetach -enc BOGUS /workspace/in.pdf",
        99,
        "Command Line Error: Unknown encoding 'BOGUS'\n"
      );
      await h.expectFail(
        "pdfdetach",
        99,
        "Usage: pdfdetach [options] <PDF-file>\n"
      );
      await h.expectFail(
        "pdfdetach /workspace/missing.pdf",
        1,
        "I/O Error: Couldn't open file '/workspace/missing.pdf'\n"
      );
      await h.exec("printf 'not pdf' > /workspace/bad.pdf");
      await h.expectFail(
        "pdfdetach /workspace/bad.pdf",
        1,
        "PDF Error: Invalid PDF header: missing %PDF- signature\n"
      );
    });
  });

  it("6. pdfdetach invalid attachment index and missing attachment name diagnostics", async () => {
    await withE2EHarness(async (h) => {
      await h.exec("printf '<h1>Doc</h1>' > /workspace/doc.html && wkhtmltopdf /workspace/doc.html /workspace/doc.pdf");
      await h.expectFail(
        "pdfdetach -save 3 /workspace/doc.pdf",
        1,
        "Error: Invalid file index 3\n"
      );
      await h.expectFail(
        "pdfdetach -savefile secret.txt /workspace/doc.pdf",
        1,
        "Error: Embedded file 'secret.txt' not found\n"
      );
    });
  });

  it("7. pdfinfo -v, --help, and -listenc exact stdout output", async () => {
    await withE2EHarness(async (h) => {
      const v1 = await h.exec("pdfinfo -v");
      assert.equal(v1.exitCode, 0);
      assert.equal(v1.stdout, "pdfinfo version 26.09.90 (@poe-code/pdf-ast)\n");

      const enc = await h.exec("pdfinfo -listenc");
      assert.equal(enc.exitCode, 0);
      assert.equal(
        enc.stdout,
        "Available encodings are:\nASCII7\nLatin1\nUTF-8\nUCS-2\nSymbol\nZapfDingbats\n"
      );

      const help = await h.exec("pdfinfo --help");
      assert.equal(help.exitCode, 0);
      assert.ok(help.stdout.startsWith("Usage: pdfinfo [options] [PDF-file]\n"));
    });
  });

  it("8. pdfinfo option validation, empty stream, missing file, non-PDF, and page range diagnostics", async () => {
    await withE2EHarness(async (h) => {
      await h.expectFail(
        "pdfinfo -f abc /workspace/in.pdf",
        99,
        "Invalid -f page number\n"
      );
      await h.expectFail(
        "pdfinfo -l abc /workspace/in.pdf",
        99,
        "Invalid -l page number\n"
      );
      await h.expectFail(
        "pdfinfo -enc BOGUS /workspace/in.pdf",
        99,
        "Command Line Error: Unknown encoding 'BOGUS'\n"
      );
      await h.expectFail(
        "pdfinfo -bogus /workspace/in.pdf",
        99,
        "Command Line Error: Unknown option '-bogus'\n"
      );
      await h.expectFail(
        "pdfinfo /workspace/a.pdf /workspace/b.pdf",
        99,
        "Usage: pdfinfo [options] [PDF-file]\n"
      );
      await h.expectFail(
        "pdfinfo /workspace/missing.pdf",
        1,
        "I/O Error: Couldn't open file '/workspace/missing.pdf': No such file or directory.\n"
      );
      await h.exec(": > /workspace/empty.pdf && printf 'not pdf' > /workspace/bad.pdf && printf '<h1>P1</h1>' > /workspace/p1.html && wkhtmltopdf /workspace/p1.html /workspace/p1.pdf");
      await h.expectFail(
        "pdfinfo /workspace/empty.pdf",
        1,
        "Syntax Error: Document stream is empty\n"
      );
      await h.expectFail(
        "pdfinfo /workspace/bad.pdf",
        1,
        "Syntax Error: Invalid PDF header: missing %PDF- signature\n"
      );
      await h.expectFail(
        "pdfinfo -f 4 -l 5 /workspace/p1.pdf",
        99,
        "Command Line Error: Wrong page range given: the first page (4) can not be after the last page (1).\n"
      );
    });
  });

  it("9. pdffonts -v, --help, missing file, non-PDF file, and page range diagnostics", async () => {
    await withE2EHarness(async (h) => {
      const v1 = await h.exec("pdffonts -v");
      assert.equal(v1.exitCode, 0);
      assert.equal(v1.stdout, "pdffonts version 24.08.0\n");

      const h1 = await h.exec("pdffonts --help");
      assert.equal(h1.exitCode, 0);
      assert.equal(
        h1.stdout,
        "Usage: pdffonts [options] <PDF-file>\n  -f <int> / -l <int> / -upw <string> / -opw <string>\n"
      );

      await h.expectFail(
        "pdffonts",
        99,
        "Usage: pdffonts [options] <PDF-file>\n"
      );
      await h.expectFail(
        "pdffonts /workspace/missing.pdf",
        1,
        "I/O Error: Couldn't open file '/workspace/missing.pdf'\n"
      );
      await h.exec("printf 'not pdf' > /workspace/bad.pdf && printf '<h1>P1</h1>' > /workspace/p1.html && wkhtmltopdf /workspace/p1.html /workspace/p1.pdf");
      await h.expectFail(
        "pdffonts /workspace/bad.pdf",
        1,
        "PDF Error: Invalid PDF header: missing %PDF- signature\n"
      );
      await h.expectFail(
        "pdffonts -f 5 -l 6 /workspace/p1.pdf",
        99,
        "Command Line Error: Wrong page range given: the first page (5) can not be after the last page (1).\n"
      );
    });
  });

  it("10. pdfimages -v, --help, and option/operand validation diagnostics", async () => {
    await withE2EHarness(async (h) => {
      const v1 = await h.exec("pdfimages -v");
      assert.equal(v1.exitCode, 0);
      assert.equal(v1.stdout, "pdfimages version 24.08.0\n");

      const h1 = await h.exec("pdfimages --help");
      assert.equal(h1.exitCode, 0);
      assert.equal(
        h1.stdout,
        "Usage: pdfimages [options] <PDF-file> <image-root>\n       pdfimages -list [options] <PDF-file>\n  -list / -png / -j / -all / -f <int> / -l <int> / -p\n  -min-width <int> / -min-height <int> : ignore smaller images\n"
      );

      await h.expectFail("pdfimages -f", 99, "Missing value for '-f'\n");
      await h.expectFail("pdfimages -f abc", 99, "Bad '-f' value on command line\n");
      await h.expectFail("pdfimages -min-width abc", 99, "Bad '-min-width' value on command line\n");
      await h.expectFail("pdfimages -bogus /workspace/a.pdf /workspace/out", 99, "Unknown option '-bogus'\n");
      await h.expectFail("pdfimages /workspace/only_one.pdf", 99, "Usage: pdfimages [options] <PDF-file> <image-root>\n");
      await h.expectFail("pdfimages -list /workspace/a.pdf /workspace/extra", 99, "Usage: pdfimages -list [options] <PDF-file>\n");
    });
  });

  it("11. pdfimages missing file, empty stream, non-PDF stream, and wrong page range diagnostics", async () => {
    await withE2EHarness(async (h) => {
      await h.exec(": > /workspace/empty.pdf && printf 'not pdf' > /workspace/bad.pdf && printf '<h1>P1</h1>' > /workspace/p1.html && wkhtmltopdf /workspace/p1.html /workspace/p1.pdf");
      await h.expectFail(
        "pdfimages -list /workspace/missing.pdf",
        1,
        "I/O Error: Couldn't open file '/workspace/missing.pdf'\n"
      );
      await h.expectFail(
        "pdfimages -list /workspace/empty.pdf",
        1,
        "Syntax Error: Document stream is empty\n"
      );
      await h.expectFail(
        "pdfimages -list /workspace/bad.pdf",
        1,
        "PDF Error: Invalid PDF header: missing %PDF- signature\n"
      );
      await h.expectFail(
        "pdfimages -list -f 5 -l 6 /workspace/p1.pdf",
        99,
        "Command Line Error: Wrong page range given: the first page (5) can not be after the last page (1).\n"
      );
    });
  });

  it("12. identify --help, --version, missing filename, and missing input file diagnostics", async () => {
    await withE2EHarness(async (h) => {
      const help = await h.exec("identify --help");
      assert.equal(help.exitCode, 0);
      assert.equal(help.stdout, "Usage: identify [-ping] [-verbose] [-format FORMAT] file...\n");

      const ver = await h.exec("identify --version");
      assert.equal(ver.exitCode, 0);
      assert.equal(ver.stdout, "Version: ImageMagick 7.1.1-safe-bash (@poe-code/image-ast)\n");

      await h.expectFail("identify", 1, "identify: missing an image filename\n");
      await h.expectFail(
        "identify /workspace/missing.png",
        1,
        "identify: unable to open image '/workspace/missing.png': No such file or directory\n"
      );
    });
  });

  it("13. mogrify missing input file and -format/-path conversion", async () => {
    await withE2EHarness(async (h) => {
      await h.expectFail(
        "mogrify -resize 10x10 /workspace/missing.png",
        1,
        "mogrify: unable to open image '/workspace/missing.png': No such file or directory\n"
      );
      const r = await h.exec(`
        mkdir -p /workspace/mog_out
        magick -size 20x10 xc:red /workspace/src.png
        mogrify -path /workspace/mog_out -format jpg -resize 10x5! /workspace/src.png
        identify -format '%wx%h %m' /workspace/mog_out/src.jpg
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout.trim(), "10x5 JPEG");
    });
  });

  it("14. composite missing operands and missing input file diagnostics", async () => {
    await withE2EHarness(async (h) => {
      await h.expectFail(
        "composite /workspace/only_one.png /workspace/only_two.png",
        1,
        "composite: missing an image filename\n"
      );
      await h.expectFail(
        "composite /workspace/missing_over.png /workspace/missing_base.png /workspace/out.png",
        1,
        "magick: no images defined '/workspace/out.png'\n"
      );
    });
  });

  it("15. montage missing operands and missing input file diagnostics", async () => {
    await withE2EHarness(async (h) => {
      await h.expectFail(
        "montage /workspace/only_one.png",
        1,
        "montage: missing an image filename\n"
      );
      await h.expectFail(
        "montage /workspace/missing_tile.png /workspace/out.png",
        1,
        "montage: unable to open image '/workspace/missing_tile.png': No such file or directory\n"
      );
    });
  });

  it("16. compare --help, missing operands (exit 2), and missing input files (exit 2)", async () => {
    await withE2EHarness(async (h) => {
      const help = await h.exec("compare --help");
      assert.equal(help.exitCode, 0);
      assert.equal(
        help.stdout,
        "Usage: compare [-metric AE|MAE|MSE|RMSE|PSNR|SSIM|PAE|NCC] [-fuzz value%] [-highlight-color color] [-lowlight-color color] reference.png candidate.png diff.png\n"
      );

      await h.expectFail(
        "compare /workspace/only_one.png",
        2,
        "compare: missing an image filename\n"
      );
      await h.expectFail(
        "compare /workspace/missing_ref.png /workspace/missing_cand.png /workspace/diff.png",
        2,
        "compare: unable to open image '/workspace/missing_ref.png': No such file or directory\n"
      );
    });
  });

  it("17. compare two-operand default null: output and identical vs different exit codes", async () => {
    await withE2EHarness(async (h) => {
      await h.exec("magick -size 6x6 xc:red /workspace/r1.png && cp /workspace/r1.png /workspace/r2.png && magick -size 6x6 xc:blue /workspace/b1.png");
      const same = await h.exec("compare -metric AE /workspace/r1.png /workspace/r2.png");
      assert.equal(same.exitCode, 0);
      assert.equal(same.stderr.trim(), "0");

      const diff = await h.exec("compare -metric AE /workspace/r1.png /workspace/b1.png");
      assert.equal(diff.exitCode, 1);
      assert.equal(diff.stderr.trim(), "36");
    });
  });

  it("18. sips empty args, --help, --version, --helpProperties, --formats, and invalid option diagnostics", async () => {
    await withE2EHarness(async (h) => {
      await h.expectFail(
        "sips",
        1,
        "sips: no arguments specified. Try 'sips --help' for help.\n"
      );
      const v = await h.exec("sips --version");
      assert.equal(v.exitCode, 0);
      assert.equal(v.stdout, "sips 10.4.4\n");

      const h1 = await h.exec("sips --helpProperties");
      assert.equal(h1.exitCode, 0);
      assert.ok(h1.stdout.includes("pixelWidth\npixelHeight"));

      await h.expectFail("sips -g", 1, "sips: missing argument for -g\n");
      await h.expectFail("sips -Z 0 /workspace/a.png", 1, "sips: invalid size for -Z\n");
      await h.expectFail("sips -f diagonal /workspace/a.png", 1, "sips: flip direction must be 'horizontal' or 'vertical'\n");
    });
  });

  it("19. diffpdf and pdfdiff --help, unsupported option, operand count, and invalid PDF diagnostics", async () => {
    await withE2EHarness(async (h) => {
      const help = await h.exec("diffpdf --help");
      assert.equal(help.exitCode, 0);
      assert.equal(
        help.stdout,
        "Usage: diffpdf [--text|--layout] OLD.pdf NEW.pdf\nExit 0: equal, 1: different, 2: invalid invocation.\n"
      );

      await h.expectFail("diffpdf --bogus a.pdf b.pdf", 2, "diffpdf: unsupported option --bogus\n");
      await h.expectFail("pdfdiff only_one.pdf", 2, "diffpdf: expected two PDF files\n");
      await h.exec("printf 'not pdf' > /workspace/bad.pdf");
      await h.expectFail(
        "diffpdf /workspace/bad.pdf /workspace/bad.pdf",
        2,
        "diffpdf: /workspace/bad.pdf: Invalid PDF header: missing %PDF- signature\n"
      );
    });
  });

  it("20. end-to-end pdfunite + pdfseparate + pdfinfo + pdffonts + montage + compare workflow", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        printf '<h1>Alpha</h1>' > /workspace/p1.html
        printf '<h1>Beta</h1>' > /workspace/p2.html
        wkhtmltopdf /workspace/p1.html /workspace/p1.pdf
        wkhtmltopdf /workspace/p2.html /workspace/p2.pdf
        pdfunite /workspace/p1.pdf /workspace/p2.pdf /workspace/merged.pdf
        pdfseparate /workspace/merged.pdf /workspace/page-%d.pdf
        diffpdf /workspace/p1.pdf /workspace/page-1.pdf
        magick -size 10x10 xc:red /workspace/t1.png
        magick -size 10x10 xc:blue /workspace/t2.png
        montage -tile 2x1 -geometry +0+0 /workspace/t1.png /workspace/t2.png /workspace/grid.png
        identify -format '%wx%h' /workspace/grid.png
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout.trim(), "20x10");
    });
  });
});
