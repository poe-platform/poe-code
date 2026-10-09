import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure pdftk, pdftoppm, pdftocairo, pdftotext, pdftohtml, magick & exiftool diagnostics parity matrix", () => {
  it("1. pdftk --help, -h, and empty args print exact usage on stdout", async () => {
    await withE2EHarness(async (h) => {
      const expected =
        "Usage: pdftk <input PDF files | [handle]=filename ...> [<operation> <operation arguments>] [output <output filename>] [flatten]\n";
      const r1 = await h.exec("pdftk --help");
      assert.equal(r1.exitCode, 0);
      assert.equal(r1.stdout, expected);

      const r2 = await h.exec("pdftk -h");
      assert.equal(r2.exitCode, 0);
      assert.equal(r2.stdout, expected);

      const r3 = await h.exec("pdftk");
      assert.equal(r3.exitCode, 0);
      assert.equal(r3.stdout, expected);
    });
  });

  it("2. pdftk --version and -v print exact version string", async () => {
    await withE2EHarness(async (h) => {
      const expected = "pdftk port to Java 3.3.3 (safe-bash @poe-code/pdf-ast)\n";
      const r1 = await h.exec("pdftk --version");
      assert.equal(r1.exitCode, 0);
      assert.equal(r1.stdout, expected);

      const r2 = await h.exec("pdftk -v");
      assert.equal(r2.exitCode, 0);
      assert.equal(r2.stdout, expected);
    });
  });

  it("3. pdftk missing input PDF files specified diagnostic", async () => {
    await withE2EHarness(async (h) => {
      await h.expectFail(
        "pdftk cat output /workspace/out.pdf",
        1,
        "Error: No input PDF files specified.\n"
      );
    });
  });

  it("4. pdftk missing file on disk and non-PDF header diagnostics", async () => {
    await withE2EHarness(async (h) => {
      await h.expectFail(
        "pdftk /workspace/missing.pdf cat output /workspace/out.pdf",
        1,
        "Error: Unable to find file '/workspace/missing.pdf'\n"
      );
      await h.exec("printf 'not a pdf' > /workspace/bad.pdf");
      await h.expectFail(
        "pdftk /workspace/bad.pdf cat output /workspace/out.pdf",
        1,
        "Error: Failed to open PDF '/workspace/bad.pdf': Invalid PDF header: missing %PDF- signature\n"
      );
    });
  });

  it("5. pdftk missing update_info and stamp/background overlay files diagnostics", async () => {
    await withE2EHarness(async (h) => {
      await h.exec("printf '<h1>Doc</h1>' > /workspace/doc.html && wkhtmltopdf /workspace/doc.html /workspace/valid.pdf");
      await h.expectFail(
        "pdftk /workspace/valid.pdf update_info /workspace/missing.info output /workspace/out.pdf",
        1,
        "Error: Unable to open info file '/workspace/missing.info'\n"
      );
      await h.expectFail(
        "pdftk /workspace/valid.pdf stamp /workspace/missing_stamp.pdf output /workspace/out.pdf",
        1,
        "Error: Unable to open '/workspace/missing_stamp.pdf'\n"
      );
      await h.expectFail(
        "pdftk /workspace/valid.pdf background /workspace/missing_bg.pdf output /workspace/out.pdf",
        1,
        "Error: Unable to open '/workspace/missing_bg.pdf'\n"
      );
    });
  });

  it("6. pdftotext and pdftohtml invalid PDF header diagnostics", async () => {
    await withE2EHarness(async (h) => {
      await h.exec("printf 'not a pdf' > /workspace/bad.pdf");
      await h.expectFail(
        "pdftotext /workspace/bad.pdf -",
        1,
        "Syntax Error: Invalid PDF header: missing %PDF- signature\n"
      );
      await h.expectFail(
        "pdftohtml -stdout /workspace/bad.pdf",
        1,
        "PDF Error: Invalid PDF header: missing %PDF- signature\n"
      );
    });
  });

  it("7. pdftoppm and pdftocairo -v, --version, and --help diagnostics", async () => {
    await withE2EHarness(async (h) => {
      const v1 = await h.exec("pdftoppm -v");
      assert.equal(v1.exitCode, 0);
      assert.equal(v1.stdout, "pdftoppm version 24.08.0\n");

      const v2 = await h.exec("pdftocairo --version");
      assert.equal(v2.exitCode, 0);
      assert.equal(v2.stdout, "pdftocairo version 24.08.0\n");

      const h1 = await h.exec("pdftoppm --help");
      assert.equal(h1.exitCode, 0);
      assert.equal(
        h1.stdout,
        "Usage: pdftoppm [options] [PDF-file [PPM-root]]\n  -png / -gray / -mono / -svg / -r <fp> / -rx <fp> / -ry <fp> / -f <int> / -l <int> / -singlefile / -x <int> / -y <int> / -W <int> / -H <int> / -cropbox\n"
      );

      const h2 = await h.exec("pdftocairo -help");
      assert.equal(h2.exitCode, 0);
      assert.equal(
        h2.stdout,
        "Usage: pdftocairo [options] <PDF-file> [<output-file>]\n  -png / -jpeg / -tiff / -ps / -eps / -pdf / -svg\n"
      );
    });
  });

  it("8. pdftoppm and pdftocairo missing value for option diagnostics (exit 99)", async () => {
    await withE2EHarness(async (h) => {
      for (const flag of ["-r", "-rx", "-ry", "-scale-to", "-f", "-l", "-x", "-y", "-W", "-H", "-sep", "-aa", "-tiffcompression"]) {
        await h.expectFail(
          `pdftoppm ${flag}`,
          99,
          `Missing value for '${flag}'\n`
        );
      }
      await h.expectFail(
        "pdftocairo -antialias",
        99,
        "Bad '-antialias' value on command line\n"
      );
    });
  });

  it("9. pdftoppm and pdftocairo bad numeric, enum, and unknown option diagnostics (exit 99)", async () => {
    await withE2EHarness(async (h) => {
      await h.expectFail(
        "pdftoppm -r abc /workspace/in.pdf",
        99,
        "Bad '-r' value on command line\n"
      );
      await h.expectFail(
        "pdftoppm -f abc /workspace/in.pdf",
        99,
        "Bad '-f' value on command line\n"
      );
      await h.expectFail(
        "pdftoppm -aa maybe /workspace/in.pdf",
        99,
        "Bad '-aa' value on command line\n"
      );
      await h.expectFail(
        "pdftoppm -tiffcompression invalid /workspace/in.pdf",
        99,
        "Bad '-tiffcompression' value on command line\n"
      );
      await h.expectFail(
        "pdftocairo -png -antialias bogus /workspace/in.pdf",
        99,
        "Bad '-antialias' value on command line\n"
      );
      await h.expectFail(
        "pdftoppm -bogus /workspace/in.pdf",
        99,
        "Unknown option '-bogus'\n"
      );
    });
  });

  it("10. pdftoppm and pdftocairo empty stream, non-PDF stream, and out-of-range page numbers", async () => {
    await withE2EHarness(async (h) => {
      await h.exec("printf '' > /workspace/empty.pdf && printf 'not pdf' > /workspace/bad.pdf");
      await h.expectFail(
        "pdftoppm -png /workspace/empty.pdf /workspace/out",
        1,
        "Syntax Error: Document stream is empty\n"
      );
      await h.expectFail(
        "pdftoppm -png /workspace/bad.pdf /workspace/out",
        1,
        "PDF Error: Invalid PDF header: missing %PDF- signature\n"
      );
      await h.exec("printf '<h1>Single Page</h1>' > /workspace/p1.html && wkhtmltopdf /workspace/p1.html /workspace/p1.pdf");
      await h.expectFail(
        "pdftoppm -png -f 5 -l 6 /workspace/p1.pdf /workspace/out",
        99,
        "Command Line Error: Wrong page range given: the first page (5) can not be after the last page (1).\n"
      );
    });
  });

  it("11. magick and convert help, empty args, and single-operand no images defined diagnostics", async () => {
    await withE2EHarness(async (h) => {
      const expectedHelp = "Usage: magick [input-options] input-file [operators] output-file\n";
      const r1 = await h.exec("magick -help");
      assert.equal(r1.exitCode, 0);
      assert.equal(r1.stdout, expectedHelp);

      const r2 = await h.exec("convert --help");
      assert.equal(r2.exitCode, 0);
      assert.equal(r2.stdout, expectedHelp);

      const r3 = await h.exec("magick");
      assert.equal(r3.exitCode, 0);
      assert.equal(r3.stdout, expectedHelp);

      await h.expectFail(
        "magick /workspace/only_out.png",
        1,
        "magick: no images defined '/workspace/only_out.png'\n"
      );
      await h.expectFail(
        "convert /workspace/only_out.png",
        1,
        "magick: no images defined '/workspace/only_out.png'\n"
      );
    });
  });

  it("12. magick missing input file and pseudo-image single-operand creation", async () => {
    await withE2EHarness(async (h) => {
      await h.expectFail(
        "magick /workspace/missing_input.png /workspace/out.png",
        1,
        "magick: no images defined '/workspace/out.png'\n"
      );
      const r = await h.exec(
        "magick -size 12x8 xc:red /workspace/red.png && identify -format '%wx%h %m' /workspace/red.png"
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout.trim(), "12x8 PNG");
    });
  });

  it("13. exiftool disallowed code evaluation / ambient polling flags (-if, -stay_open, -common_args, -execute)", async () => {
    await withE2EHarness(async (h) => {
      for (const flag of ["-if", "-stay_open", "-common_args", "-execute", "-execute123"]) {
        await h.expectFail(
          `exiftool ${flag} /workspace/a.png`,
          1,
          `Error: ExifTool option not yet supported (no code evaluation or ambient polling): ${flag}\n`
        );
      }
    });
  });

  it("14. exiftool missing argument for value options (-o, -p, -tagsFromFile, -config, -charset, -api)", async () => {
    await withE2EHarness(async (h) => {
      for (const flag of ["-o", "-p", "-tagsFromFile", "-config", "-charset", "-api"]) {
        await h.expectFail(
          `exiftool ${flag}`,
          1,
          `Error: Missing argument for ${flag}\n`
        );
      }
    });
  });

  it("15. exiftool no file specified, repeated stdin operands, and writing stdin metadata", async () => {
    await withE2EHarness(async (h) => {
      await h.expectFail(
        "exiftool -j",
        1,
        "Error: No file specified\n"
      );
      await h.expectFail(
        "exiftool - -",
        1,
        "Error: Repeated stdin operands are not supported\n"
      );
      await h.expectFail(
        "exiftool -Artist=Alice -",
        1,
        "Error: Writing stdin metadata is not yet supported\n"
      );
    });
  });

  it("16. exiftool -o without tag assignments, -o with multiple files, and -tagsFromFile with assignments", async () => {
    await withE2EHarness(async (h) => {
      await h.exec("magick -size 8x8 xc:blue /workspace/a.png && cp /workspace/a.png /workspace/b.png");
      await h.expectFail(
        "exiftool -o /workspace/copy.png /workspace/a.png",
        1,
        "Error: -o requires a single file with tag assignments in this profile\n"
      );
      await h.expectFail(
        "exiftool -Artist=Alice -o /workspace/copy.png /workspace/a.png /workspace/b.png",
        1,
        "Error: -o requires a single file with tag assignments in this profile\n"
      );
      await h.expectFail(
        "exiftool -tagsFromFile /workspace/a.png -Artist=Bob /workspace/b.png",
        1,
        "Error: Combining tagsFromFile with assignments is not yet supported\n"
      );
    });
  });

  it("17. exiftool conflicting output modes (-j -csv, -X -T, -X with write mode)", async () => {
    await withE2EHarness(async (h) => {
      await h.exec("magick -size 8x8 xc:green /workspace/a.png");
      await h.expectFail(
        "exiftool -j -csv /workspace/a.png",
        1,
        "Error: CSV combined output/import policy not yet supported\n"
      );
      await h.expectFail(
        "exiftool -X -T /workspace/a.png",
        1,
        "Error: Conflicting ExifTool output modes\n"
      );
      await h.expectFail(
        "exiftool -x -Artist=Alice /workspace/a.png",
        1,
        "Error: Presentation modes require extraction\n"
      );
    });
  });

  it("18. exiftool missing file, directory input, and empty file diagnostics", async () => {
    await withE2EHarness(async (h) => {
      await h.exec("mkdir -p /workspace/imgdir && : > /workspace/empty.png");
      await h.expectFail(
        "exiftool /workspace/missing.png",
        1,
        "Error: File not found - /workspace/missing.png\n"
      );
      await h.expectFail(
        "exiftool /workspace/imgdir",
        1,
        "Error: Only regular VFS files are admitted - /workspace/imgdir\n"
      );
      await h.expectFail(
        "exiftool /workspace/empty.png",
        1,
        "Error: File is empty - /workspace/empty.png\n"
      );
    });
  });

  it("19. exiftool -tagsFromFile missing source, directory source, and empty source diagnostics", async () => {
    await withE2EHarness(async (h) => {
      await h.exec("mkdir -p /workspace/srcdir && : > /workspace/emptysrc.png && magick -size 8x8 xc:white /workspace/dst.png");
      await h.expectFail(
        "exiftool -tagsFromFile /workspace/no_such_src.png /workspace/dst.png",
        1,
        "Error: File not found - /workspace/dst.png\n"
      );
      await h.expectFail(
        "exiftool -tagsFromFile /workspace/srcdir /workspace/dst.png",
        1,
        "Error: Only regular VFS files are admitted - /workspace/dst.png\n"
      );
      await h.expectFail(
        "exiftool -tagsFromFile /workspace/emptysrc.png /workspace/dst.png",
        1,
        "Error: Not a PNG file - /workspace/dst.png\n"
      );
    });
  });

  it("20. end-to-end pdftk + pdftoppm + magick + exiftool metadata & page rendering pipeline", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        printf '<h1>Page One</h1>' > /workspace/p1.html
        printf '<h1>Page Two</h1>' > /workspace/p2.html
        wkhtmltopdf /workspace/p1.html /workspace/p1.pdf
        wkhtmltopdf /workspace/p2.html /workspace/p2.pdf
        pdftk A=/workspace/p1.pdf B=/workspace/p2.pdf cat A B output /workspace/merged.pdf
        pdftoppm -png -r 72 -f 2 -l 2 /workspace/merged.pdf /workspace/page
        exiftool -overwrite_original -Artist="Ada Lovelace" /workspace/page-2.png >/dev/null
        exiftool -s3 -Artist /workspace/page-2.png
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout.trim(), "Ada Lovelace");
    });
  });
});
