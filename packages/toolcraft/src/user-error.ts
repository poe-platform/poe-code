export class UserError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "UserError";
  }
}

export class ToolcraftBugError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolcraftBugError";
  }
}
