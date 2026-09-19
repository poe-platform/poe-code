import { CsvkitBlocked, CsvkitDiagnostic } from "../errors.js";
import { repr } from "../cli/parser.js";
import { stripWhitespace } from "../python-text.js";
import { PythonException } from './exception.js';
export { PythonException, type PythonFrame, type PythonTraceback } from './exception.js';

/** SystemExit/parser and csvclean reports bypass the uncaught exception hook. */
export function diagnosticReport(failure: CsvkitDiagnostic, verbose: boolean, encoding: string): { readonly status: number; readonly stderr: string } {
  let text = failure instanceof PythonException ? `${failure.exceptionClass}: ${failure.detail}` : failure.message;
  if (!(failure instanceof CsvkitBlocked) && failure.status === 1) {
    if (verbose) {
      if (!(failure instanceof PythonException) || !failure.traceback?.profile || !failure.traceback.frames.length ||
        failure.traceback.frames.some(frame => !frame.path || !frame.function || !Number.isSafeInteger(frame.line) || frame.line < 1))
        return { status: 78, stderr: "csvkit: unsupported or unqualified: frozen Python traceback frames and deployment identity\n" };
      text = "Traceback (most recent call last):\n";
      for (const frame of failure.traceback.frames) {
        text += `  File "${frame.path}", line ${frame.line}, in ${frame.function}\n`;
        const source = frame.source === undefined ? "" : stripWhitespace(frame.source);
        if (source) text += `    ${source}\n`;
      }
      text += `${failure.exceptionClass}: ${failure.detail}`;
    } else if (failure instanceof PythonException && failure.exceptionClass === "UnicodeDecodeError") {
      text = `Your file is not "${encoding}" encoded. Please specify the correct encoding with the --encoding flag. Use the -v flag to see the complete error.`;
    }
  }
  // Python's handler appends one newline even when the exception message has one.
  return { status: failure.status, stderr: text + "\n" };
}

/** Translate known POSIX errno identities, at the file access boundary. */
export function fileException(failure: unknown, path: string): unknown {
  if (failure instanceof CsvkitDiagnostic || typeof failure !== "object" || failure === null) return failure;
  const code = (failure as { readonly code?: unknown }).code;
  const identities: Readonly<Record<string, readonly [string, number, string]>> = {
    ENOENT: ["FileNotFoundError", 2, "No such file or directory"],
    EACCES: ["PermissionError", 13, "Permission denied"],
    EPERM: ["PermissionError", 1, "Operation not permitted"],
    EISDIR: ["IsADirectoryError", 21, "Is a directory"],
    ENOTDIR: ["NotADirectoryError", 20, "Not a directory"]
  };
  const identity = typeof code === "string" && Object.hasOwn(identities, code) ? identities[code] : undefined;
  return identity ? new PythonException(identity[0], `[Errno ${identity[1]}] ${identity[2]}: ${repr(path)}`) : failure;
}

export interface PythonWarning {
  readonly category: string;
  readonly message: string;
  readonly path: string;
  readonly line: number;
  readonly source?: string;
}

/** Callers await each warning write in source order and own filtering policy. */
export function warningText(warning: PythonWarning): string {
  return `${warning.path}:${warning.line}: ${warning.category}: ${warning.message}\n` +
    (warning.source ? `  ${stripWhitespace(warning.source)}\n` : "");
}
