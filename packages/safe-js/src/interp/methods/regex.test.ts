import { describe, expect, it } from "vitest";
import { Budget } from "../budget.js";
import { createSandboxRegex, isSandboxClosure } from "../values.js";
import { getRegexMember, setRegexMember } from "./regex.js";

describe("regex methods", () => {
  it("exposes data members and stateful global test/exec", async () => {
    const budget = new Budget();
    const regex = createSandboxRegex("(a+)", "g");
    expect(getRegexMember(regex, "source", budget)).toBe("(a+)");
    expect(getRegexMember(regex, "flags", budget)).toBe("g");
    const test = getRegexMember(regex, "test", budget);
    const exec = getRegexMember(regex, "exec", budget);
    expect(isSandboxClosure(test)).toBe(true);
    expect(isSandboxClosure(exec)).toBe(true);
    if (!isSandboxClosure(test) || !isSandboxClosure(exec)) return;
    expect(await test.call(["aa ba"], { stack: [], thisValue: regex })).toBe(true);
    expect(regex.lastIndex).toBe(2);
    expect(await exec.call(["aa ba"], { stack: [], thisValue: regex })).toEqual(
      Object.assign(["a", "a"], { groups: undefined, index: 4, input: "aa ba" })
    );
    expect(regex.lastIndex).toBe(5);
    expect(await test.call(["aa ba"], { stack: [], thisValue: regex })).toBe(false);
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
    const exec = getRegexMember(regex, "exec", new Budget());
    expect(isSandboxClosure(exec)).toBe(true);
    if (!isSandboxClosure(exec)) return;

    expect(await exec.call(["abc"], { stack: [], thisValue: regex })).toEqual(
      Object.assign([""], { groups: undefined, index: 0, input: "abc" })
    );
    expect(regex.lastIndex).toBe(0);
  });

  it("includes an undefined groups property on exec match arrays", async () => {
    const regex = createSandboxRegex("(a)", "");
    const exec = getRegexMember(regex, "exec", new Budget());
    expect(isSandboxClosure(exec)).toBe(true);
    if (!isSandboxClosure(exec)) return;

    const match = await exec.call(["a"], { stack: [], thisValue: regex });

    expect(Object.prototype.hasOwnProperty.call(match, "groups")).toBe(true);
    expect(match).toMatchObject({ groups: undefined });
  });
});
