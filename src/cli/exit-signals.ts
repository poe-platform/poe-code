import { SilentError } from "./errors.js";

export class VersionExit extends SilentError {
  constructor() {
    super("", { isUserError: false });
    this.name = "VersionExit";
  }
}

