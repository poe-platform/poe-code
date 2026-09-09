/** Internal operation fault; guest exception objects are constructed by the runtime. */
export class PythonRuntimeError extends Error {
  constructor(name: "ZeroDivisionError" | "OverflowError" | "ValueError" | "IndexError" | "KeyError" | "UnicodeDecodeError" | "UnicodeEncodeError" | "MemoryError" | "BufferError" | "TypeError" | "AttributeError" | "RuntimeError" | "NameError" | "UnboundLocalError" | "RecursionError" | "StopIteration", message: string) {
    super(message);
    this.name = name;
  }
}
