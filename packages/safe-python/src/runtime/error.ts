/** Internal operation fault; guest exception objects are constructed by the runtime. */
export class PythonRuntimeError extends Error {
  constructor(name: "ZeroDivisionError" | "OverflowError" | "ValueError" | "IndexError" | "UnicodeDecodeError" | "UnicodeEncodeError" | "MemoryError", message: string) {
    super(message);
    this.name = name;
  }
}
