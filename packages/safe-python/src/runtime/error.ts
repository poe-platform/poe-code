import type { ExecutionMeter } from "./execution-budget.js";

/** Internal operation fault; guest exception objects are constructed by the runtime. */
export type PythonOSErrorName = "OSError" | "FileNotFoundError" | "FileExistsError" | "PermissionError" | "NotADirectoryError" | "IsADirectoryError" | "BlockingIOError" | "InterruptedError" | "BrokenPipeError" | "TimeoutError";

export class PythonRuntimeError extends Error {
  #notes?: string[];
  constructor(name: PythonOSErrorName | "ZeroDivisionError" | "OverflowError" | "ValueError" | "IndexError" | "KeyError" | "UnicodeDecodeError" | "UnicodeEncodeError" | "MemoryError" | "BufferError" | "TypeError" | "AttributeError" | "RuntimeError" | "NameError" | "UnboundLocalError" | "RecursionError" | "StopIteration" | "SystemError", message: string) {
    super(message);
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
