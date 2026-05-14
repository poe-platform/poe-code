export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserError";
  }
}

export class ToolcraftBugError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolcraftBugError";
  }
}
