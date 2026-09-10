/** Internal operation fault; guest exception objects are constructed by the runtime. */
export type PythonOSErrorName = "OSError" | "FileNotFoundError" | "FileExistsError" | "PermissionError" | "NotADirectoryError" | "IsADirectoryError" | "BlockingIOError" | "InterruptedError" | "BrokenPipeError" | "TimeoutError";

export class PythonRuntimeError extends Error {
  constructor(name: PythonOSErrorName | "ZeroDivisionError" | "OverflowError" | "ValueError" | "IndexError" | "KeyError" | "UnicodeDecodeError" | "UnicodeEncodeError" | "MemoryError" | "BufferError" | "TypeError" | "AttributeError" | "RuntimeError" | "NameError" | "UnboundLocalError" | "RecursionError" | "StopIteration" | "SystemError", message: string) {
    super(message);
    this.name = name;
  }
}
