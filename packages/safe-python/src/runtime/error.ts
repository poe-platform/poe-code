import type { ExecutionMeter } from "./execution-budget.js";

/** Internal operation fault; guest exception objects are constructed by the runtime. */
export type PythonOSErrorName = "OSError" | "FileNotFoundError" | "FileExistsError" | "PermissionError" | "NotADirectoryError" | "IsADirectoryError" | "BlockingIOError" | "InterruptedError" | "BrokenPipeError" | "TimeoutError";

/** Explicit guest exception chaining for package-owned native operations. */
export interface PythonExceptionChaining {
  readonly context: PythonRuntimeError;
  readonly suppressContext?: boolean;
}

export class PythonRuntimeError extends Error {
  #notes?: string[];
  // An omitted message represents zero guest arguments; an explicit empty
  // string remains one argument even though both have the same Error.message.
  constructor(name: PythonOSErrorName | "ImportError" | "ModuleNotFoundError" | "EOFError" | "ZeroDivisionError" | "OverflowError" | "ValueError" | "IndexError" | "KeyError" | "LookupError" | "UnicodeError" | "UnicodeDecodeError" | "UnicodeEncodeError" | "MemoryError" | "BufferError" | "TypeError" | "AttributeError" | "RuntimeError" | "NameError" | "UnboundLocalError" | "RecursionError" | "StopIteration" | "SystemError" | "SyntaxError", readonly argumentMessage?: string, readonly chaining?: PythonExceptionChaining) {
    super(argumentMessage);
    this.name = name;
  }

  get notes(): readonly string[] | undefined { return this.#notes; }

  /** Runtime-generated PEP 678 notes; guest add_note validation is separate. */
  addNote(note: string, meter: ExecutionMeter): void {
    meter.checkpoint(1, (this.#notes === undefined ? 32 : 8) + note.length * 2);
    this.#notes ??= [];
    this.#notes.push(note);
  }
}
