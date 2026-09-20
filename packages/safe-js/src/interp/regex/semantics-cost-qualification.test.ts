import { describe, expect, it, vi } from "vitest";
import { run } from "../../run.js";
import { SandboxError } from "../budget.js";
import { matchRegex } from "./engine.js";
import { parseRegex } from "./parse.js";
import { decodeReplayData, encodeReplayData } from "../../snapshot/replay-data.js";
import { createSandboxRegex, type SandboxObject } from "../values.js";
import { isSandboxRegExpIterator, restoreSandboxRegExpIterator } from "../regexp-iterator.js";
import { nextRegExpIterator } from "../methods/regexp-iterator.js";

// ECMA-262 edition 16, 22.2.2: explicit outcomes, not native-engine oracles.
const cases = [
  ["indices", "(a)", "d", "a", "b"],
  ["global", "a", "g", "a", "b"],
  ["ignoreCase", "a", "i", "A", "b"],
  ["multiline", "^a$", "m", "a", "b"],
  ["dotAll", ".", "s", "\n", ""],
  ["sticky", "a", "y", "a", "ba"],
  ["codePoint", "\\u{1F600}", "u", "😀", "\ud83d"],
  ["combining", "e\\p{Mark}", "u", "e\u0301", "é"],
  ["loneSurrogate", "\\uD800", "u", "\ud800", "\udc00"],
  ["property", "\\p{Script=Greek}", "u", "α", "a"],
  ["intersection", "[\\p{ASCII}&&\\p{Letter}]", "v", "a", "α"],
  ["subtraction", "[[a-z]--[aeiou]]", "v", "b", "a"],
  ["stringSet", "[\\q{ab|cd}]", "v", "ab", "ac"],
  ["stringProperty", "\\p{Basic_Emoji}", "v", "😀", "a"],
  ["numberedBackreference", "(a)\\1", "", "aa", "ab"],
  ["namedBackreference", "(?<x>a)\\k<x>", "u", "aa", "ab"],
  ["lookahead", "a(?=b)", "", "ab", "ac"],
  ["negativeLookahead", "a(?!b)", "", "ac", "ab"],
  ["lookbehind", "(?<=a)b", "", "ab", "cb"],
  ["negativeLookbehind", "(?<!a)b", "", "cb", "ab"],
  ["emptyAlternative", "(?:|a)b", "", "b", "c"],
  ["nestedQuantifier", "(a+)+b", "", "aab", "aac"],
  ["modifiers", "(?i:a)b", "", "Ab", "AB"]
] as const;

describe("independent edition-16 RegExp semantics and cost", () => {
  it.each(cases)("%s has positive and negative evidence", (_name, source, flags, positive, negative) => {
    const pattern = parseRegex(source, flags);
    expect(matchRegex(pattern, positive)).not.toBeNull();
    expect(matchRegex(pattern, negative)).toBeNull();
  });

  it.each(cases)("%s cannot escape the matcher ceiling in a failing alternative", (_name, source, flags) => {
    const pattern = parseRegex(`^(?:${source})$|^(a+)+Z$`, flags);
    expect(() => matchRegex(pattern, "a".repeat(24) + "!")).toThrow(SandboxError);
  });

  it("does not delegate catastrophic guest matching to native RegExp", () => {
    const pattern = parseRegex("^(a+)+Z$");
    const NativeRegExp = globalThis.RegExp;
    const native = vi.fn(function () { throw new Error("Unexpected native matcher"); });
    let failure: unknown;
    try {
      vi.stubGlobal("RegExp", native);
      try { matchRegex(pattern, "a".repeat(24) + "!"); } catch (error) { failure = error; }
    } finally { vi.stubGlobal("RegExp", NativeRegExp); }
    expect(failure).toBeInstanceOf(SandboxError);
    expect(native).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it.each(["match", "replace", "search", "split", "matchAll", "replaceAll"])(
    "%s keeps matcher rejection fatal through guest catch/finally", async method => {
      const argumentsSource = method === "replace" || method === "replaceAll" ? ", 'x'" : "";
      const source = `try { return [...'${"a".repeat(24)}!'.${method}(/^(a+)+Z$/g${argumentsSource})]; }
        catch (error) { return 'caught'; } finally { return 'finally'; }`;
      await expect(run(source)).rejects.toMatchObject({ code: "budgetExceeded", budget: "steps" });
    }
  );

  it.each([
    ["pinned S15.10.7_A2_T1 nonconstructor", "try{new /z/()}catch(e){return e instanceof TypeError}", true],
    ["constructor neighbor", "return new RegExp('z').test('z')", true],
    ["new property retains division", "return [({new:8}).new/2,({new:8})?.new/2]", [4, 4]],
    ["new literal inside template", "try{return `${new /z/()}`}catch(e){return e instanceof TypeError}", true],
    ["capture numbering", "return Array.from(/(a)(?<x>b)(c)?/d.exec('ab')).concat(/(a)(?<x>b)/d.exec('ab').groups.x)", ["ab", "a", "b", undefined, "b"]],
    ["zero-width Unicode progress", "return Array.from('😀'.matchAll(/(?:)/gu), x => x.index)", [0, 2]],
    ["zero-width UTF-16 progress", "return Array.from('😀'.matchAll(/(?:)/g), x => x.index)", [0, 1, 2]],
    ["sticky failure resets cursor", "const r=/a/y;r.lastIndex=1;return [r.exec('aba'),r.lastIndex]", [null, 0]],
    ["search restores cursor", "const r=/a/g;r.lastIndex=2;return ['aba'.search(r),r.lastIndex]", [0, 2]],
    ["lastIndex descriptor", "const d=Object.getOwnPropertyDescriptor(/a/,'lastIndex');return [d.value,d.writable,d.enumerable,d.configurable]", [0, true, false, false]],
    ["frozen lastIndex failure", "const r=/a/g;Object.freeze(r);try{r.exec('a')}catch(e){return e.name}", "TypeError"],
    ["replacement captures", "return 'ab'.replace(/(?<x>a)(b)/, '$2$<x>$1')", "baa"],
    ["split captures", "return 'ab'.split(/(a)|(b)/)", ["", "a", undefined, "", undefined, "b", ""]],
    ["invalid species", "const r=/a/g;r.constructor={[Symbol.species]:7};try{r[Symbol.matchAll]('a')}catch(e){return e.name}", "TypeError"],
    ["species flags", "const seen=[];const r=/a/g;r.constructor={[Symbol.species]:function(p,f){seen.push(p===r,f);return /b/g}};return [Array.from(r[Symbol.matchAll]('ab'),m=>m.index),seen]", [[1], [true, "g"]]],
    ["bound replacement owner", "const owner={n:0};function f(m,c,i,s){this.n++;return c+i+s.length}const r='aa'.replace(/(a)/g,f.bind(owner));return [r,owner.n]", ["a02a12", 2]]
  ])("%s uses a specification-derived result", async (_name, source, expected) => {
    expect(await run(String(source))).toMatchObject({ ok: true, returnValue: expected });
  });

  it("restores the same regex iterator graph repeatedly without sharing advancement", () => {
    const iterator = restoreSandboxRegExpIterator({ matcher: createSandboxRegex("(?:)", "gu"), input: "😀", exhausted: false });
    expect(nextRegExpIterator(iterator)).toMatchObject({ done: false, value: { index: 0 } });
    const bytes = JSON.stringify(encodeReplayData({ iterator, alias: iterator }));
    for (let attempt = 0; attempt < 3; attempt++) {
      const graph = decodeReplayData(JSON.parse(bytes)) as SandboxObject;
      expect(graph.iterator).toBe(graph.alias);
      if (!isSandboxRegExpIterator(graph.iterator)) throw new Error("Lost iterator brand");
      expect(nextRegExpIterator(graph.iterator)).toMatchObject({ done: false, value: { index: 2 } });
      expect(nextRegExpIterator(graph.iterator)).toEqual({ done: true, value: undefined });
      expect(JSON.stringify(encodeReplayData({ iterator, alias: iterator }))).toBe(bytes);
    }
    expect(nextRegExpIterator(iterator)).toMatchObject({ done: false, value: { index: 2 } });
  });
});
