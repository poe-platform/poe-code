import { describe, expect, it } from "vitest";
import { createSandboxRegex, isSandboxClosure } from "../values.js";
import { getRegexMember, setRegexMember } from "./regex.js";

describe("regex methods", () => {
  it("exposes data members and stateful global test/exec", async () => {
    const regex = createSandboxRegex("(a+)", "g");
    expect(getRegexMember(regex, "source")).toBe("(a+)");
    expect(getRegexMember(regex, "flags")).toBe("g");
    const test = getRegexMember(regex, "test");
    const exec = getRegexMember(regex, "exec");
    expect(isSandboxClosure(test)).toBe(true);
    expect(isSandboxClosure(exec)).toBe(true);
    if (!isSandboxClosure(test) || !isSandboxClosure(exec)) return;
    expect(await test.call(["aa ba"])).toBe(true);
    expect(regex.lastIndex).toBe(2);
    expect(await exec.call(["aa ba"])).toEqual(
      Object.assign(["a", "a"], { groups: undefined, index: 4, input: "aa ba" })
    );
    expect(regex.lastIndex).toBe(5);
    expect(await test.call(["aa ba"])).toBe(false);
    expect(regex.lastIndex).toBe(0);
  });

  it("only allows lastIndex writes", () => {
    const regex = createSandboxRegex("a", "g");
    setRegexMember(regex, "lastIndex", 3);
    expect(regex.lastIndex).toBe(3);
    expect(() => setRegexMember(regex, "source", "b")).toThrow("not writable");
  });

  it("preserves zero-width global exec positions", async () => {
    const regex = createSandboxRegex("^", "g");
    const exec = getRegexMember(regex, "exec");
    expect(isSandboxClosure(exec)).toBe(true);
    if (!isSandboxClosure(exec)) return;

    expect(await exec.call(["abc"])).toEqual(
      Object.assign([""], { groups: undefined, index: 0, input: "abc" })
    );
    expect(regex.lastIndex).toBe(0);
  });

  it("includes an undefined groups property on exec match arrays", async () => {
    const regex = createSandboxRegex("(a)", "");
    const exec = getRegexMember(regex, "exec");
    expect(isSandboxClosure(exec)).toBe(true);
    if (!isSandboxClosure(exec)) return;

    const match = await exec.call(["a"]);

    expect(Object.prototype.hasOwnProperty.call(match, "groups")).toBe(true);
    expect(match).toMatchObject({ groups: undefined });
  });
});
