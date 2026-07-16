import { describe, expect, it } from "vitest";
import { UserError, isUserError } from "./index.js";

describe("UserError", () => {
  it("is an Error named UserError carrying the message", () => {
    const error = new UserError("Unknown agent \"clyde\". Try: claude, codex.");

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("UserError");
    expect(error.message).toBe("Unknown agent \"clyde\". Try: claude, codex.");
  });

  it("has no hint unless one is given", () => {
    expect(new UserError("bad input").hint).toBeUndefined();
  });

  it("carries an optional recovery hint", () => {
    const error = new UserError("No API key found.", {
      hint: "Get one at https://poe.com/api_key"
    });

    expect(error.hint).toBe("Get one at https://poe.com/api_key");
  });

  it("preserves the underlying cause", () => {
    const cause = new Error("ENOENT");
    expect(new UserError("Config not found.", { cause }).cause).toBe(cause);
  });
});

describe("isUserError", () => {
  it("recognises its own instances", () => {
    expect(isUserError(new UserError("bad input"))).toBe(true);
  });

  it("recognises a UserError from another bundle by name", () => {
    // toolcraft publishes its own UserError class; a cross-bundle instance
    // fails instanceof but must still be treated as a user error.
    const foreign = new Error("bad input");
    foreign.name = "UserError";

    expect(isUserError(foreign)).toBe(true);
  });

  it("rejects ordinary errors and non-errors", () => {
    expect(isUserError(new Error("kaboom"))).toBe(false);
    expect(isUserError(new TypeError("kaboom"))).toBe(false);
    expect(isUserError(undefined)).toBe(false);
    expect(isUserError(null)).toBe(false);
    expect(isUserError("UserError")).toBe(false);
    expect(isUserError({ name: "UserError" })).toBe(false);
  });
});
