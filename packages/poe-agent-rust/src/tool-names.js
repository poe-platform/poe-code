import { native } from "./native.js";
export const TOOL_NAME_PATTERN = Object.freeze({
  test: native.agentToolValid,
  toString() {
    return "/^[a-zA-Z0-9_-]+$/";
  }
});
export class InvalidToolNameError extends Error {
  constructor(name, contributor) {
    super(native.agentToolError(name, contributor));
    this.name = "InvalidToolNameError";
  }
}
export function assertValidToolName(name, contributor) {
  if (!native.agentToolValid(name)) throw new InvalidToolNameError(name, contributor);
}
