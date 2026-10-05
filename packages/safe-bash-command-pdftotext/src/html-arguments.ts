export const SUPPORTED_ENCODINGS = new Set([
  "ASCII7",
  "Latin1",
  "UTF-8",
  "UCS-2",
  "Symbol",
  "ZapfDingbats"
]);

export interface HtmlPlan {
  readonly inputPath: string; readonly outPath: string; readonly imageDirectory: string;
  readonly xmlMode: boolean; readonly stdoutOutput: boolean; readonly ignoreImages: boolean; readonly dataUrls: boolean;
  readonly firstPage: number; readonly lastPage: number; readonly zoom: number;
  readonly imageFmt: "png" | "jpg"; readonly encoding: string; readonly password: string;
}
export function parseHtmlArguments(argv: readonly string[], hasStdin = false): HtmlPlan | { exitCode: number; stdout: string; stderr: string } {
    let xmlMode = false;
    let toStdout = false;
    let ignoreImages = false;
    let dataUrls = false;
    let firstPage = 1;
    let lastPage = 0;
    let zoom = 1;
    let imageFmt: "png" | "jpg" = "png";
    let encoding = "UTF-8";
    let password = "";
    const positionals: string[] = [];
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]!;
        if (arg === "--") {
            positionals.push(...argv.slice(i + 1));
            break;
        }
        if (arg === "-v" || arg === "--version") {
            return { exitCode: 0, stdout: "pdftohtml version 24.08.0\n", stderr: "" };
        }
        if (arg === "-h" || arg === "-help" || arg === "--help" || arg === "-?") {
            return {
                exitCode: 0,
                stdout: "Usage: pdftohtml [options] <PDF-file> [<html-file>|<xml-file>]\n  -xml / -stdout / -s / -i / -noframes / -c / -f <int> / -l <int>\n",
                stderr: ""
            };
        }
        if (arg === "-xml")
            xmlMode = true;
        else if (arg === "-stdout")
            toStdout = true;
        else if (arg === "-i")
            ignoreImages = true;
        else if (arg === "-dataurls")
            dataUrls = true;
        else if (arg === "-f")
            firstPage = Math.max(1, Number(argv[++i] ?? "1") || 1);
        else if (arg === "-l")
            lastPage = Math.max(0, Number(argv[++i] ?? "0") || 0);
        else if (arg === "-zoom") {
            const z = Number.parseFloat(argv[++i] ?? "1");
            if (Number.isFinite(z) && z > 0)
                zoom = z;
        }
        else if (arg === "-fmt") {
            const fmtVal = (argv[++i] ?? "").toLowerCase();
            if (fmtVal === "png")
                imageFmt = "png";
            else if (fmtVal === "jpg" || fmtVal === "jpeg")
                imageFmt = "jpg";
            else {
                return { exitCode: 99, stdout: "", stderr: `Command Line Error: Invalid image format '${fmtVal}'\n` };
            }
        }
        else if (arg === "-enc") {
            const nextEnc = argv[++i] ?? "";
            if (!SUPPORTED_ENCODINGS.has(nextEnc)) {
                return { exitCode: 99, stdout: "", stderr: `Command Line Error: Unknown encoding '${nextEnc}'\n` };
            }
            encoding = nextEnc;
        }
        else if (arg === "-upw" || arg === "-opw")
            password = argv[++i] ?? "";
        else if (arg === "-s" ||
            arg === "-noframes" ||
            arg === "-c" ||
            arg === "-p" ||
            arg === "-q" ||
            arg === "-hidden" ||
            arg === "-nomerge" ||
            arg === "-nodrm") {
            // Flag options
        }
        else if (!arg.startsWith("-") || arg === "-") {
            positionals.push(arg);
        }
    }
    const inputPath = positionals[0] ?? (hasStdin ? "-" : undefined);
    if (!inputPath) {
        return { exitCode: 99, stdout: "", stderr: "Usage: pdftohtml [options] <PDF-file> [<html-file>]\n" };
    }
    const explicitOut = positionals[1];
    const stdoutOutput = toStdout || explicitOut === "-" || (inputPath === "-" && !explicitOut);
    const defaultExt = xmlMode ? ".xml" : ".html";
    const inputStem = inputPath.toLowerCase().endsWith(".pdf") ? inputPath.slice(0, -4) : inputPath;
    const outPath = explicitOut
        ? explicitOut.endsWith(".html") || explicitOut.endsWith(".xml")
            ? explicitOut
            : `${explicitOut}${defaultExt}`
        : inputStem + defaultExt;
    const imageDirectory = outPath.slice(0, outPath.lastIndexOf("/") + 1);
    return { inputPath, outPath, imageDirectory, xmlMode, stdoutOutput, ignoreImages, dataUrls, firstPage, lastPage, zoom, imageFmt, encoding, password };
}
