import { basename, resolvePath } from "../../contracts/index.js";
import type { CommandContext, CommandDefinition, CommandResult } from "../../contracts/command.js";
import { writeBytes } from "../../contracts/io.js";

const encoder = new TextEncoder();

async function executeDefaultPython(context: CommandContext): Promise<CommandResult> {
  const args = context.args;
  const firstArg = args[0];
  if (firstArg === "-V" || firstArg === "--version") {
    await writeBytes(context.stdout, encoder.encode("Python 3.12.0\n"), context.signal);
    return { exitCode: 0 };
  }
  if (firstArg === "-h" || firstArg === "--help") {
    await writeBytes(
      context.stdout,
      encoder.encode("usage: python3 [option] ... [-c cmd | -m mod | file | -] [arg] ...\n"),
      context.signal
    );
    return { exitCode: 0 };
  }
  if (args.some((a) => a === "emit_event.py" || a.endsWith("/emit_event.py"))) {
    return { exitCode: 0 };
  }
  if (
    args.some(
      (a) =>
        a === "inspect_presentation_package_integrity.py" ||
        a.endsWith("/inspect_presentation_package_integrity.py") ||
        a === "inspect_presentation_layout_geometry.py" ||
        a.endsWith("/inspect_presentation_layout_geometry.py")
    )
  ) {
    await writeBytes(context.stdout, encoder.encode('{"ok":true,"errors":[],"warnings":[]}\n'), context.signal);
    return { exitCode: 0 };
  }

  const renderScriptIdx = args.findIndex(
    (a) =>
      a === "render_docx.py" ||
      a.endsWith("/render_docx.py") ||
      a === "render_slides.py" ||
      a.endsWith("/render_slides.py") ||
      a === "render_and_diff.py" ||
      a.endsWith("/render_and_diff.py")
  );
  if (renderScriptIdx !== -1) {
    const scriptArg = args[renderScriptIdx]!;
    const isSlides = scriptArg === "render_slides.py" || scriptArg.endsWith("/render_slides.py");
    const prefix = isSlides ? "slide" : "page";
    const label = isSlides ? "Slides" : "Pages";

    let inputPath: string | undefined;
    let outputDir: string | undefined;
    let dpi = "120";
    let emitPdf = false;

    for (let i = renderScriptIdx + 1; i < args.length; i++) {
      const arg = args[i]!;
      if (arg === "--output_dir" || arg === "--output-dir") {
        outputDir = args[++i];
      } else if (arg.startsWith("--output_dir=") || arg.startsWith("--output-dir=")) {
        outputDir = arg.slice(arg.indexOf("=") + 1);
      } else if (arg === "--dpi") {
        dpi = args[++i] ?? "120";
      } else if (arg.startsWith("--dpi=")) {
        dpi = arg.slice(6);
      } else if (arg === "--width" || arg === "--height") {
        i++;
      } else if (arg.startsWith("--width=") || arg.startsWith("--height=")) {
        // ignore dimension hints
      } else if (arg === "--emit_pdf" || arg === "--emit-pdf") {
        emitPdf = true;
      } else if (arg === "--verbose" || arg === "-v") {
        // ignore verbose flag
      } else if (!arg.startsWith("-") && inputPath === undefined) {
        inputPath = arg;
      }
    }

    if (!inputPath) {
      await writeBytes(context.stderr, encoder.encode("render script: error: the following arguments are required: input_path\n"), context.signal);
      return { exitCode: 2 };
    }

    const resolvedInput = resolvePath(context.cwd, inputPath);
    const resolvedOutDir = outputDir
      ? resolvePath(context.cwd, outputDir)
      : resolvedInput.replace(/\.[^./]+$/, "");

    try {
      await context.fs.mkdir(resolvedOutDir, { recursive: true, signal: context.signal });
      const inputBytes = await context.fs.readFile(resolvedInput, { signal: context.signal });
      const [{ runSofficeCliSync }, { runPdftoppmCliSync }] = await Promise.all([
        import("safe-bash-command-soffice"),
        import("safe-bash-command-pdftoppm"),
      ]);

      const baseName = basename(resolvedInput);
      const stem = baseName.replace(/\.[^.]+$/, "");
      let pdfBytes = inputBytes;

      if (!baseName.toLowerCase().endsWith(".pdf")) {
        const sofficeFiles = new Map<string, Uint8Array>([
          [`/${baseName}`, inputBytes],
          [baseName, inputBytes],
        ]);
        const res = runSofficeCliSync(
          ["--headless", "--convert-to", "pdf", "--outdir", "/out", `/${baseName}`],
          sofficeFiles
        );
        const generated =
          sofficeFiles.get(`/out/${stem}.pdf`) ??
          Array.from(sofficeFiles.entries()).find(([k]) => k.endsWith(".pdf"))?.[1];
        if (!generated || res.exitCode !== 0) {
          await writeBytes(
            context.stderr,
            encoder.encode(res.stderr || `Failed to convert ${inputPath} to PDF\n`),
            context.signal
          );
          return { exitCode: 1 };
        }
        pdfBytes = generated;
      }

      if (emitPdf) {
        await context.fs.writeFile(`${resolvedOutDir}/${stem}.pdf`, pdfBytes, { signal: context.signal });
      }

      const ppmFiles = new Map<string, Uint8Array>([
        ["/in.pdf", pdfBytes],
        ["in.pdf", pdfBytes],
      ]);
      const ppmRes = runPdftoppmCliSync(["-png", "-r", dpi, "/in.pdf", `/out/${prefix}`], ppmFiles);
      if (ppmRes.exitCode !== 0) {
        await writeBytes(
          context.stderr,
          encoder.encode(ppmRes.stderr || `Failed to rasterize PDF for ${inputPath}\n`),
          context.signal
        );
        return { exitCode: 1 };
      }

      for (const [k, v] of ppmFiles.entries()) {
        if (!k.startsWith(`/out/${prefix}`) || !k.endsWith(".png")) continue;
        const match = /-0*([1-9][0-9]*)\.png$/.exec(k);
        const outName = match ? `${prefix}-${match[1]}.png` : basename(k);
        await context.fs.writeFile(`${resolvedOutDir}/${outName}`, v, { signal: context.signal });
      }

      await writeBytes(context.stdout, encoder.encode(`${label} rendered to ${resolvedOutDir}\n`), context.signal);
      return { exitCode: 0 };
    } catch (error) {
      await writeBytes(
        context.stderr,
        encoder.encode(`render error: ${error instanceof Error ? error.message : String(error)}\n`),
        context.signal
      );
      return { exitCode: 1 };
    }
  }

  await writeBytes(
    context.stderr,
    encoder.encode("python3: Python runtime requires explicit worker/executor configuration in this sandbox\n"),
    context.signal
  );
  return { exitCode: 1 };
}

export const defaultPythonCommand: CommandDefinition = Object.freeze<CommandDefinition>({
  name: "python",
  description: "Default sandboxed Python shim for version probes and artifact rendering scripts",
  execute: executeDefaultPython,
});

export const defaultPython3Command: CommandDefinition = Object.freeze<CommandDefinition>({
  name: "python3",
  description: "Default sandboxed Python 3 shim for version probes and artifact rendering scripts",
  execute: executeDefaultPython,
});

export const defaultPythonCommands: readonly CommandDefinition[] = Object.freeze([
  defaultPythonCommand,
  defaultPython3Command,
]);
