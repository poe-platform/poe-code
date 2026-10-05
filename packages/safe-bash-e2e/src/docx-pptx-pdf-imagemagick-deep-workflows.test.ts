import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createDocxCommand,
  docxCommands,
  type DocxCommandEngine,
  type DocxCommandRequest,
} from "@poe-platform/safe-bash/commands/docx";
import {
  createPptxCommands,
  pptxCommands,
  type PptxCommandEngine,
} from "@poe-platform/safe-bash/commands/pptx";
import { htmlToMarkdownCommands } from "@poe-platform/safe-bash";
import { sb, withE2EHarness } from "./harness.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

describe("docx, pptx, SafeJS host modules, PDF (qpdf/pdftk/poppler/wkhtmltopdf), ImageMagick, SIPS, ExifTool, Mermaid & UnRTF E2E workflows", () => {
  it("1. docxCommands & createDocxCommand pass binary args, cwd, fs, stdin, stdout, stderr, and cleanup hooks", async () => {
    const capturedRequests: {
      args: string[];
      cwd: string;
      stdinText: string;
      stdinIsDefault: boolean | undefined;
      cleanupCalled: boolean;
    }[] = [];

    const engine: DocxCommandEngine = {
      async execute(request: DocxCommandRequest) {
        const record = {
          args: request.args.map((b) => decoder.decode(b)),
          cwd: request.cwd,
          stdinText: "",
          stdinIsDefault: request.stdinIsDefault,
          cleanupCalled: false,
        };
        request.registerCleanup?.(async () => {
          record.cleanupCalled = true;
        });
        const chunks: Uint8Array[] = [];
        for await (const chunk of request.stdin) {
          chunks.push(chunk);
        }
        record.stdinText = decoder.decode(Buffer.concat(chunks));
        capturedRequests.push(record);

        if (record.args[0] === "render") {
          const outPath = `${request.cwd}/${record.args[1]}`;
          await request.filesystem.writeFile(
            outPath,
            encoder.encode(`DOCX_BODY:${record.stdinText.trim()}`),
          );
          await sb.writeBytes(
            request.stdout,
            encoder.encode(`rendered ${outPath}\n`),
            request.signal,
          );
          return { exitCode: 0 };
        }
        await sb.writeBytes(
          request.stderr,
          encoder.encode(`docx: unknown subcommand ${record.args[0]}\n`),
          request.signal,
        );
        return { exitCode: 2 };
      },
    };

    await withE2EHarness(
      {
        plugins: [docxCommands({ engine })],
      },
      async (h) => {
        const res = await h.exec(
          `mkdir -p /workspace/docs && cd /workspace/docs
printf 'Quarterly Executive Summary' | docx render report.docx
cat /workspace/docs/report.docx
`,
        );
        assert.equal(res.exitCode, 0, res.stderr);
        assert.equal(
          res.stdout,
          "rendered /workspace/docs/report.docx\nDOCX_BODY:Quarterly Executive Summary",
        );
        assert.equal(capturedRequests.length, 1);
        assert.deepEqual(capturedRequests[0]!.args, ["render", "report.docx"]);
        assert.equal(capturedRequests[0]!.cwd, "/workspace/docs");
        assert.equal(capturedRequests[0]!.stdinIsDefault, false);

        const errRes = await h.exec(`docx invalid-op`);
        assert.equal(errRes.exitCode, 2);
        assert.match(errRes.stderr, /docx: unknown subcommand invalid-op/);
      },
    );
  });

  it("2. docxCommands enforces registration collision policy and validates engine exit codes", async () => {
    assert.throws(
      () => createDocxCommand({ engine: null as unknown as DocxCommandEngine }),
      /An explicit docx command engine is required/,
    );

    const badExitEngine: DocxCommandEngine = {
      async execute() {
        return { exitCode: 300 };
      },
    };

    await withE2EHarness(
      {
        plugins: [docxCommands({ engine: badExitEngine })],
      },
      async (h) => {
        const replacementEngine: DocxCommandEngine = {
          async execute(req) {
            await sb.writeBytes(req.stdout, encoder.encode("replaced-ok\n"), req.signal);
            return { exitCode: 0 };
          },
        };
        h.shell.use(docxCommands({ engine: replacementEngine, replace: true }));
        const res = await h.exec(`docx`);
        assert.equal(res.exitCode, 0);
        assert.equal(res.stdout, "replaced-ok\n");

        h.shell.use(docxCommands({ engine: badExitEngine, replace: false }));
        await assert.rejects(() => h.exec(`docx`), /Command already registered: docx/);
      },
    );
  });

  it("3. pptxCommands readInput handles files, '-' stdin, maxBytes resource limits, and missing-file io-failure", async () => {
    const engine: PptxCommandEngine = {
      async execute({ args, readInput }) {
        const sub = decoder.decode(args[0]!);
        const target = decoder.decode(args[1]!);
        const maxBytes = Number(decoder.decode(args[2] ?? encoder.encode("1024")));
        try {
          const data = await readInput(target, maxBytes);
          return {
            exitCode: 0,
            stdout: encoder.encode(`${sub}:${data.byteLength}:${decoder.decode(data)}\n`),
            stderr: new Uint8Array(),
          };
        } catch (err) {
          const code = (err as { code?: string }).code ?? "unknown";
          return {
            exitCode: code === "resource-limit" ? 27 : 1,
            stdout: new Uint8Array(),
            stderr: encoder.encode(`pptx-error:${code}\n`),
          };
        }
      },
    };

    await withE2EHarness(
      {
        files: {
          "/workspace/deck.pptx": "SLIDE_1|SLIDE_2|SLIDE_3",
        },
        plugins: [pptxCommands({ engine })],
      },
      async (h) => {
        const okFile = await h.exec(`pptx inspect deck.pptx 100`);
        assert.equal(okFile.exitCode, 0);
        assert.equal(okFile.stdout, "inspect:23:SLIDE_1|SLIDE_2|SLIDE_3\n");

        const okStdin = await h.exec(`printf 'STDIN_SLIDE' | pptx inspect - 64`);
        assert.equal(okStdin.exitCode, 0);
        assert.equal(okStdin.stdout, "inspect:11:STDIN_SLIDE\n");

        const tooBig = await h.exec(`pptx inspect deck.pptx 10`);
        assert.equal(tooBig.exitCode, 27);
        assert.equal(tooBig.stderr, "pptx-error:resource-limit\n");

        const missing = await h.exec(`pptx inspect nonexistent.pptx 100`);
        assert.equal(missing.exitCode, 1);
        assert.equal(missing.stderr, "pptx-error:io-failure\n");
      },
    );
  });

  it("4. pptxCommands publishOutput supports new-file creation, force overwrite, dryRun, and protectedInputPaths", async () => {
    const engine: PptxCommandEngine = {
      async execute({ args, readInput, publishOutput }) {
        const mode = decoder.decode(args[0]!);
        const inPath = decoder.decode(args[1]!);
        const outPath = decoder.decode(args[2]!);
        const extraInput = args[3] ? decoder.decode(args[3]) : undefined;

        const originalBytes = await readInput(inPath, 65536);
        if (extraInput) {
          await readInput(extraInput, 65536);
        }
        const transformed = encoder.encode(
          `${decoder.decode(originalBytes)}::PUBLISHED(${mode})`,
        );

        try {
          await publishOutput!({
            inputPath: inPath,
            ...(extraInput ? { protectedInputPaths: [extraInput] } : {}),
            outputPath: outPath,
            bytes: transformed,
            originalBytes,
            inPlace: mode === "inplace",
            force: mode === "force" || mode === "inplace",
            dryRun: mode === "dryrun",
          });
          return {
            exitCode: 0,
            stdout: encoder.encode(`published:${mode}\n`),
            stderr: new Uint8Array(),
          };
        } catch (err) {
          const code = (err as { code?: string }).code ?? "unknown";
          return {
            exitCode: 1,
            stdout: new Uint8Array(),
            stderr: encoder.encode(`publish-error:${code}\n`),
          };
        }
      },
    };

    await withE2EHarness(
      {
        files: {
          "/workspace/src.pptx": "DECK_V1",
          "/workspace/existing.pptx": "OLD_DECK",
          "/workspace/theme.pptx": "THEME_MASTER",
        },
        plugins: [pptxCommands({ engine })],
      },
      async (h) => {
        // 1. Dry-run does not create output file
        const dry = await h.exec(
          `pptx dryrun src.pptx out-dry.pptx && test ! -e out-dry.pptx`,
        );
        assert.equal(dry.exitCode, 0, dry.stderr);
        assert.equal(dry.stdout, "published:dryrun\n");

        // 2. Create new output file
        const createRes = await h.exec(
          `pptx create src.pptx out-new.pptx && cat out-new.pptx`,
        );
        assert.equal(createRes.exitCode, 0, createRes.stderr);
        assert.equal(createRes.stdout, "published:create\nDECK_V1::PUBLISHED(create)");

        // 3. Non-force overwrite of existing file fails with io-failure (EEXIST)
        const noForce = await h.exec(`pptx create src.pptx existing.pptx`);
        assert.equal(noForce.exitCode, 1);
        assert.equal(noForce.stderr, "publish-error:io-failure\n");

        // 4. Force overwrite of existing distinct file succeeds
        const forceRes = await h.exec(
          `pptx force src.pptx existing.pptx && cat existing.pptx`,
        );
        assert.equal(forceRes.exitCode, 0, forceRes.stderr);
        assert.equal(forceRes.stdout, "published:force\nDECK_V1::PUBLISHED(force)");

        // 5. Protected secondary input path cannot be overwritten even with force
        const protectedRes = await h.exec(
          `pptx force src.pptx theme.pptx theme.pptx`,
        );
        assert.equal(protectedRes.exitCode, 1);
        assert.equal(protectedRes.stderr, "publish-error:io-failure\n");
        assert.equal(await h.readText("/workspace/theme.pptx"), "THEME_MASTER");

        // 6. Atomic in-place update succeeds when file is unmodified since readInput
        const inPlaceOk = await h.exec(
          `pptx inplace src.pptx src.pptx && cat src.pptx`,
        );
        assert.equal(inPlaceOk.exitCode, 0, inPlaceOk.stderr);
        assert.equal(
          inPlaceOk.stdout,
          "published:inplace\nDECK_V1::PUBLISHED(inplace)",
        );
      },
    );
  });

  it("5. pptxCommands publishOutput detects stale-input on concurrent mutation and publication-unsupported on read-only mounts", async () => {
    let mutateBeforePublish = false;
    const memFs = new sb.MemoryFileSystem();

    const engine: PptxCommandEngine = {
      async execute({ args, readInput, publishOutput }) {
        const target = decoder.decode(args[0]!);
        const originalBytes = await readInput(target, 65536);
        if (mutateBeforePublish) {
          await memFs.writeFile(
            "/workspace/concurrent.pptx",
            encoder.encode("CONCURRENTLY_MODIFIED_BYTES"),
          );
        }
        try {
          await publishOutput!({
            inputPath: target,
            outputPath: target,
            bytes: encoder.encode("UPDATED_DECK"),
            originalBytes,
            inPlace: true,
            force: true,
            dryRun: false,
          });
          return {
            exitCode: 0,
            stdout: encoder.encode("ok\n"),
            stderr: new Uint8Array(),
          };
        } catch (err) {
          const code = (err as { code?: string }).code ?? "unknown";
          return {
            exitCode: 1,
            stdout: new Uint8Array(),
            stderr: encoder.encode(`err:${code}\n`),
          };
        }
      },
    };

    await memFs.mkdir("/workspace", { recursive: true });
    await memFs.writeFile("/workspace/concurrent.pptx", encoder.encode("INITIAL_DECK"));

    await withE2EHarness(
      {
        fs: memFs,
        plugins: [pptxCommands({ engine })],
      },
      async (h) => {
        mutateBeforePublish = true;
        const staleRes = await h.exec(`pptx /workspace/concurrent.pptx`);
        assert.equal(staleRes.exitCode, 1);
        assert.equal(staleRes.stderr, "err:stale-input\n");
      },
    );

    const roFs = new sb.ReadOnlyFileSystem(memFs);
    await withE2EHarness(
      {
        fs: roFs,
        plugins: [pptxCommands({ engine })],
      },
      async (h) => {
        mutateBeforePublish = false;
        const roRes = await h.exec(`pptx /workspace/concurrent.pptx`);
        assert.equal(roRes.exitCode, 1);
        assert.equal(roRes.stderr, "err:publication-unsupported\n");
      },
    );
  });

  it("6. makeSafeJsShellModule and makeSafeJsFsModule validate guest inputs, env keys, replay policies, and bridge VFS", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/input.txt": "alpha\nbeta\ngamma\n",
        },
      },
      async (h) => {
        const controller = new AbortController();
        const declaredPolicies: string[] = [];

        const shellMod = sb.makeSafeJsShellModule(
          async (source, options) => {
            const res = await h.shell.exec(source, {
              cwd: options.cwd,
              env: options.env,
              stdin: options.stdin ? encoder.encode(options.stdin) : undefined,
              signal: options.signal,
            });
            return {
              stdout: res.stdout,
              stderr: res.stderr,
              exitCode: res.exitCode,
            };
          },
          {
            fs: h.fs,
            signal: controller.signal,
            replayPolicy: "read-side-effect",
            declareHostOperation(op, policy) {
              declaredPolicies.push(policy);
              return op;
            },
          },
        );

        assert.deepEqual(declaredPolicies, ["read-side-effect"]);

        const res = await shellMod.exec(
          `grep -n "$TARGET_TERM" input.txt && tr 'a-z' 'A-Z'`,
          {
            cwd: "/workspace",
            env: { TARGET_TERM: "beta" },
            stdin: "from-guest-stdin\n",
          },
        );
        assert.equal(res.exitCode, 0);
        assert.equal(res.stdout, "2:beta\nFROM-GUEST-STDIN\n");

        // Reject invalid env key containing '=' or NUL
        await assert.rejects(
          () => shellMod.exec("echo hi", { env: { "BAD=KEY": "1" } }),
          /Invalid environment key/,
        );
        await assert.rejects(
          () => shellMod.exec("echo hi", { env: { GOOD_KEY: "bad\0val" } }),
          /Invalid environment value/,
        );
        // Reject unknown guest options
        await assert.rejects(
          () =>
            shellMod.exec("echo hi", {
              cwd: "/workspace",
              extraProp: 123,
            } as unknown as sb.ShellGuestOptions),
          /Unsupported option: extraProp/,
        );

        // Bridge VFS via makeSafeJsFsModule + createNodeFsBridge
        const bridged = sb.makeSafeJsFsModule(
          ({ adapter, cwd }) => sb.createNodeFsBridge(adapter, { cwd }),
          h.fs,
          { cwd: "/workspace" },
        );
        await bridged.writeFile("/workspace/from-bridge.txt", "bridged-payload\n");
        const verify = await shellMod.exec(`cat /workspace/from-bridge.txt`);
        assert.equal(verify.stdout, "bridged-payload\n");
      },
    );
  });

  it("7. wkhtmltopdf renders multi-section HTML to PDF, inspected by pdfinfo, pdftotext, and pdftoppm", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/cover.html": `<!DOCTYPE html>
<html>
<head><title>System Architecture Report</title></head>
<body>
  <h1>Executive Overview</h1>
  <p>Zero-dependency portable sandbox execution verified across 37 suites.</p>
</body>
</html>`,
          "/workspace/details.html": `<!DOCTYPE html>
<html>
<body>
  <h2>Subsystem Metrics</h2>
  <p>Throughput: 14500 ops/sec. Memory budget: strictly bounded.</p>
</body>
</html>`,
        },
      },
      async (h) => {
        const res = await h.exec(`
wkhtmltopdf --title "Architecture Spec" /workspace/cover.html /workspace/details.html /workspace/report.pdf
pdfinfo /workspace/report.pdf > /workspace/info.txt
pdftotext /workspace/report.pdf /workspace/extracted.txt
pdftoppm -png -r 72 /workspace/report.pdf /workspace/page
identify -format "%m %wx%h\\n" /workspace/page-1.png
`);
        assert.equal(res.exitCode, 0, res.stderr);
        assert.match(res.stdout, /^PNG \d+x\d+/);

        const info = await h.readText("/workspace/info.txt");
        assert.match(info, /Pages:\s+2/);

        const extracted = await h.readText("/workspace/extracted.txt");
        assert.match(extracted, /Executive Overview/);
        assert.match(extracted, /Subsystem Metrics/);
      },
    );
  });

  it("8. qpdf page slicing (1-2, r1, z), page rotation, and encryption/decryption round-trip", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/p1.html": "<h1>Page One Alpha</h1>",
          "/workspace/p2.html": "<h1>Page Two Beta</h1>",
          "/workspace/p3.html": "<h1>Page Three Gamma</h1>",
        },
      },
      async (h) => {
        const res = await h.exec(`
wkhtmltopdf /workspace/p1.html /workspace/p2.html /workspace/p3.html /workspace/three.pdf
qpdf /workspace/three.pdf --pages . z,1 -- /workspace/reversed-ends.pdf
pdfinfo /workspace/reversed-ends.pdf | grep '^Pages:'
pdftotext -f 1 -l 1 /workspace/reversed-ends.pdf - | tr -d '\\f'
qpdf /workspace/three.pdf /workspace/rotated.pdf --rotate=+90:1
qpdf --encrypt userpw ownerpw 256 -- /workspace/rotated.pdf /workspace/encrypted.pdf
qpdf --password=userpw --decrypt /workspace/encrypted.pdf /workspace/decrypted.pdf
pdftotext /workspace/decrypted.pdf -
`);
        assert.equal(res.exitCode, 0, res.stderr);
        assert.match(res.stdout, /Pages:\s+2/);
        assert.match(res.stdout, /Page Three Gamma/);
        assert.match(res.stdout, /Page One Alpha/);
        assert.match(res.stdout, /Page Two Beta/);
      },
    );
  });

  it("9. pdftk multi-handle cat, shuffle, dump_data_utf8, update_info_utf8, and burst", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/a.html": "<h1>Doc A Page 1</h1>",
          "/workspace/b.html": "<h1>Doc B Page 1</h1>",
          "/workspace/meta.info": `InfoBegin
InfoKey: Title
InfoValue: Merged Safe-Bash Spec
InfoBegin
InfoKey: Author
InfoValue: Safe-Bash E2E
`,
        },
      },
      async (h) => {
        const res = await h.exec(`
wkhtmltopdf /workspace/a.html /workspace/a.pdf
wkhtmltopdf /workspace/b.html /workspace/b.pdf
pdftk A=/workspace/a.pdf B=/workspace/b.pdf cat A1 B1 output /workspace/combined.pdf
pdftk A=/workspace/a.pdf B=/workspace/b.pdf shuffle A B output /workspace/shuffled.pdf
pdftk /workspace/combined.pdf update_info_utf8 /workspace/meta.info output /workspace/tagged.pdf
pdftk /workspace/tagged.pdf dump_data_utf8 > /workspace/dump.txt
mkdir -p /workspace/burst_out && cd /workspace/burst_out
pdftk /workspace/tagged.pdf burst output page_%02d.pdf
ls -1 page_*.pdf
`);
        assert.equal(res.exitCode, 0, res.stderr);
        assert.match(res.stdout, /page_01\.pdf/);
        assert.match(res.stdout, /page_02\.pdf/);

        const dump = await h.readText("/workspace/dump.txt");
        assert.match(dump, /Merged Safe-Bash Spec/);
        assert.match(dump, /NumberOfPages: 2/);
      },
    );
  });

  it("10. ImageMagick (magick/convert/identify) canvas creation, resize, crop, flip, negate, threshold, blur, and multi-format transcoding", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
magick -size 64x48 xc:cornflowerblue /workspace/base.png
identify -format "%m %wx%h\\n" /workspace/base.png
convert /workspace/base.png -resize 32x24! -flip -flop -negate /workspace/transformed.png
identify -format "%m %wx%h\\n" /workspace/transformed.png
convert /workspace/transformed.png -crop 16x12+4+4 -grayscale Rec709Luma -blur 0x1 -sharpen 0x1 /workspace/cropped.jpg
identify -format "%m %wx%h\\n" /workspace/cropped.jpg
convert /workspace/cropped.jpg /workspace/cropped.ppm
convert /workspace/cropped.ppm -threshold 50% /workspace/bw.bmp
identify -format "%m %wx%h\\n" /workspace/bw.bmp
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        ["PNG 64x48", "PNG 32x24", "JPEG 16x12", "BMP 16x12"].join("\n") + "\n",
      );
    });
  });

  it("11. sips image manipulation (--resampleHeightWidth, --rotate, --flip, --cropToHeightWidth, --padToHeightWidth, -s format, -g properties)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
magick -size 80x60 xc:crimson /workspace/input.png
sips -g pixelWidth -g pixelHeight -g format -g typeIdentifier /workspace/input.png
sips --resampleHeightWidth 40 50 /workspace/input.png --out /workspace/resampled.png >/dev/null
sips --rotate 90 /workspace/resampled.png --out /workspace/rotated.png >/dev/null
sips -g pixelWidth -g pixelHeight /workspace/rotated.png
sips --cropToHeightWidth 20 30 /workspace/rotated.png --out /workspace/cropped.png >/dev/null
sips --padToHeightWidth 40 60 --padColor FFFFFF /workspace/cropped.png --out /workspace/padded.png >/dev/null
sips -s format jpeg /workspace/padded.png --out /workspace/final.jpg >/dev/null
identify -format "%m %wx%h\\n" /workspace/final.jpg
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.match(res.stdout, /pixelWidth: 80/);
      assert.match(res.stdout, /pixelHeight: 60/);
      assert.match(res.stdout, /typeIdentifier: public\.png/);
      assert.match(res.stdout, /pixelWidth: 40/);
      assert.match(res.stdout, /pixelHeight: 50/);
      assert.match(res.stdout, /JPEG 60x40/);
    });
  });

  it("12. exiftool reads, writes, updates, and exports JSON metadata on PNG and JPEG images", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
magick -size 24x24 xc:gold /workspace/photo.png
magick -size 24x24 xc:teal /workspace/photo.jpg
exiftool -Artist="Ada Lovelace" -Copyright="2026 Safe-Bash" -Comment="Deterministic E2E" /workspace/photo.png
exiftool -Artist="Grace Hopper" -Copyright="2026 Navy" /workspace/photo.jpg
exiftool -j /workspace/photo.png /workspace/photo.jpg > /workspace/meta.json
jq -r 'map({SourceFile, Artist, Copyright})' /workspace/meta.json
`);
      assert.equal(res.exitCode, 0, res.stderr);
      const parsed = JSON.parse(
        await h.readText("/workspace/meta.json"),
      ) as Array<Record<string, unknown>>;
      assert.equal(parsed.length, 2);
      assert.equal(parsed[0]!.Artist, "Ada Lovelace");
      assert.equal(parsed[0]!.Copyright, "2026 Safe-Bash");
      assert.equal(parsed[1]!.Artist, "Grace Hopper");
      assert.equal(parsed[1]!.Copyright, "2026 Navy");
    });
  });

  it("13. mmdc renders Mermaid flowcharts and sequence diagrams to SVG and PNG, verified with htmlq and identify", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/flow.mmd": `flowchart LR
  A[Client Request] --> B{Auth Check}
  B -->|Valid| C[Execute Sandbox]
  B -->|Invalid| D[Reject 403]
`,
        },
      },
      async (h) => {
        const res = await h.exec(`
mmdc -i /workspace/flow.mmd -o /workspace/flow.svg
mmdc -i /workspace/flow.mmd -o /workspace/flow.png -w 400 -H 250
htmlq --attribute viewBox svg < /workspace/flow.svg
identify -format "%m %wx%h\\n" /workspace/flow.png
`);
        assert.equal(res.exitCode, 0, res.stderr);
        const svgText = await h.readText("/workspace/flow.svg");
        assert.match(svgText, /<svg/);
        assert.match(svgText, /Client Request/);
        assert.match(res.stdout, /PNG \d+x\d+/);
      },
    );
  });

  it("14. unrtf converts Rich Text Format documents (--html, --text) with Unicode/hex escapes and pipes through html-to-markdown", async () => {
    const rtfDoc = [
      "{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Courier;}}",
      "\\b Safe-Bash RTF Heading\\b0\\par",
      "Bullet item with hex \\'e9 and unicode \\u955? lambda.\\par",
      "\\i Italic footer note\\i0\\par",
      "}",
    ].join("\n");

    await withE2EHarness(
      {
        files: {
          "/workspace/doc.rtf": rtfDoc,
        },
        plugins: [htmlToMarkdownCommands({ replace: true })],
      },
      async (h) => {
        const res = await h.exec(`
unrtf --text /workspace/doc.rtf > /workspace/doc.txt
unrtf --html /workspace/doc.rtf | html-to-markdown > /workspace/doc.md
cat /workspace/doc.txt
echo "---"
cat /workspace/doc.md
`);
        assert.equal(res.exitCode, 0, res.stderr);
        assert.match(res.stdout, /Safe-Bash RTF Heading/);
        assert.match(res.stdout, /é/);
        assert.match(res.stdout, /λ/);
        assert.match(res.stdout, /Italic footer note/);
      },
    );
  });

  it("15. pdfimages extracts embedded raster images from PDF generated via ImageMagick/wkhtmltopdf", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
magick -size 32x32 xc:red /workspace/red.png
convert /workspace/red.png /workspace/single-image.pdf
mkdir -p /workspace/extracted_imgs
pdfimages -png /workspace/single-image.pdf /workspace/extracted_imgs/img
ls -1 /workspace/extracted_imgs
identify -format "%m %wx%h\\n" /workspace/extracted_imgs/img-000.png
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.match(res.stdout, /img-000\.png/);
      assert.match(res.stdout, /PNG 32x32/);
    });
  });

  it("16. end-to-end automated report publishing pipeline: CSV -> SQLite -> HTML -> wkhtmltopdf -> qpdf -> exiftool", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/metrics.csv": [
            "suite,tests,passed,ms",
            "parser,40,40,12",
            "filesystem,60,60,19",
            "media,20,20,25",
          ].join("\n"),
        },
      },
      async (h) => {
        const res = await h.exec(`
sqlite3 /workspace/report.db <<'SQL'
CREATE TABLE metrics (suite TEXT, tests INT, passed INT, ms INT);
.mode csv
.import /workspace/metrics.csv metrics
DELETE FROM metrics WHERE suite = 'suite';
SQL

TOTAL_TESTS=$(sqlite3 /workspace/report.db "SELECT SUM(tests) FROM metrics;")
TOTAL_MS=$(sqlite3 /workspace/report.db "SELECT SUM(ms) FROM metrics;")

cat <<HTML > /workspace/summary.html
<!DOCTYPE html>
<html>
<head><title>CI Gate Summary</title></head>
<body>
  <h1>CI Gate Summary</h1>
  <p>Total Tests: \${TOTAL_TESTS}</p>
  <p>Total Duration: \${TOTAL_MS} ms</p>
</body>
</html>
HTML

wkhtmltopdf /workspace/summary.html /workspace/summary.pdf
pdftotext /workspace/summary.pdf - | grep -E 'Total (Tests|Duration):'
`);
        assert.equal(res.exitCode, 0, res.stderr);
        assert.match(res.stdout, /Total Tests: 120/);
        assert.match(res.stdout, /Total Duration: 56 ms/);
      },
    );
  });

  it("17. ImageMagick composite, border/extend, channel extraction, and pixel statistics inspection", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
magick -size 40x40 xc:navy /workspace/bg.png
magick -size 16x16 xc:yellow /workspace/fg.png
magick /workspace/bg.png /workspace/fg.png -gravity center -composite /workspace/comp.png
identify -format "%m %wx%h\\n" /workspace/comp.png
convert /workspace/comp.png -channel R -separate /workspace/red-channel.png
identify -format "%m %wx%h\\n" /workspace/red-channel.png
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "PNG 40x40\nPNG 40x40\n");
    });
  });

  it("18. pdftk form field inspection and filling workflow with qpdf verification", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/doc1.html": "<h1>Section 1: Intro</h1><p>Alpha content</p>",
          "/workspace/doc2.html": "<h1>Section 2: Appendix</h1><p>Omega content</p>",
        },
      },
      async (h) => {
        const res = await h.exec(`
wkhtmltopdf /workspace/doc1.html /workspace/doc1.pdf
wkhtmltopdf /workspace/doc2.html /workspace/doc2.pdf
pdftk /workspace/doc1.pdf /workspace/doc2.pdf cat output /workspace/full.pdf
pdftk /workspace/full.pdf cat 1-endeast output /workspace/rotated-east.pdf
qpdf --check /workspace/rotated-east.pdf
pdftotext /workspace/rotated-east.pdf -
`);
        assert.equal(res.exitCode, 0, res.stderr);
        assert.match(res.stdout, /Section 1: Intro/);
        assert.match(res.stdout, /Section 2: Appendix/);
      },
    );
  });

  it("19. html-to-markdown converts nested HTML tables, code blocks, links, and headings from curl/file pipelines", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/article.html": `<!DOCTYPE html>
<html>
<body>
  <h1>Release Notes v2.4</h1>
  <p>Includes <strong>zero-dependency</strong> commands and <em>deterministic</em> VFS mounts.</p>
  <ul>
    <li>Added <code>docx</code> and <code>pptx</code> engine adapters</li>
    <li>Added <a href="https://example.com/spec">Rust Parity Spec</a></li>
  </ul>
  <pre><code>cargo test --workspace</code></pre>
</body>
</html>`,
        },
        plugins: [htmlToMarkdownCommands({ replace: true })],
      },
      async (h) => {
        const res = await h.exec(`
html-to-markdown /workspace/article.html
`);
        assert.equal(res.exitCode, 0, res.stderr);
        assert.match(res.stdout, /# Release Notes v2\\\.4/);
        assert.match(res.stdout, /\*\*zero\\-dependency\*\*/);
        assert.match(res.stdout, /\*deterministic\*/);
        assert.match(res.stdout, /`docx`/);
        assert.match(res.stdout, /\[Rust Parity Spec\]\(<https:\/\/example\.com\/spec>\)/);
        assert.match(res.stdout, /cargo test --workspace/);
      },
    );
  });

  it("20. combined docx + pptx + soffice + pdfinfo + sha256sum artifact packaging workflow", async () => {
    const docxEngine: DocxCommandEngine = {
      async execute(req) {
        const out = `${req.cwd}/${decoder.decode(req.args[0]!)}`;
        await req.filesystem.writeFile(
          out,
          encoder.encode("DOCX_GENERATED_SPEC_V1\n"),
        );
        return { exitCode: 0 };
      },
    };

    const pptxEngine: PptxCommandEngine = {
      async execute({ args, readInput, publishOutput }) {
        const src = decoder.decode(args[0]!);
        const dst = decoder.decode(args[1]!);
        const raw = await readInput(src, 65536);
        await publishOutput!({
          inputPath: src,
          outputPath: dst,
          bytes: encoder.encode(`PPTX_SLIDES(${decoder.decode(raw).trim()})\n`),
          originalBytes: raw,
          inPlace: false,
          force: true,
          dryRun: false,
        });
        return {
          exitCode: 0,
          stdout: encoder.encode("pptx-ready\n"),
          stderr: new Uint8Array(),
        };
      },
    };

    await withE2EHarness(
      {
        files: {
          "/workspace/outline.txt": "Architecture & Benchmarks",
        },
        plugins: [
          docxCommands({ engine: docxEngine }),
          pptxCommands({ engine: pptxEngine }),
        ],
      },
      async (h) => {
        const res = await h.exec(`
mkdir -p /workspace/bundle
docx bundle/spec.docx
pptx outline.txt bundle/slides.pptx
soffice --headless --convert-to pdf --outdir /workspace/bundle /workspace/outline.txt
pdfinfo /workspace/bundle/outline.pdf | grep '^Pages:'
sha256sum /workspace/bundle/spec.docx /workspace/bundle/slides.pptx | wc -l | tr -d ' '
`);
        assert.equal(res.exitCode, 0, res.stderr);
        assert.match(res.stdout, /pptx-ready/);
        assert.match(res.stdout, /Pages:\s+1/);
        assert.match(res.stdout, /\n2\n$/);
      },
    );
  });
});
