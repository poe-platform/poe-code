/** Internal arithmetic fault; guest exception objects are constructed by the runtime. */
export class PythonNumericError extends Error {
  constructor(name: "ZeroDivisionError" | "OverflowError", message: string) {
    super(message);
    this.name = name;
  }
}
