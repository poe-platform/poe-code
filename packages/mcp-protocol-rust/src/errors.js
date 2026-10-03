export class ToolError extends Error {
  constructor(code, message, data) {
    if (!Number.isFinite(code)) throw new Error("ToolError code must be a finite number");
    super(message);
    this.name = "ToolError";
    this.code = code;
    this.data = data;
  }
}
