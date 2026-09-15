import { describe, expect, it } from "vitest";
import { analyzeModule } from "./analysis.js";

function attributes(body: string) { return [...analyzeModule(`class C:\n ${body.split("\n").join("\n ")}`).staticAttributes.values()]; }

describe("class static attribute metadata", () => {
  it("collects unique sorted stores to the literal self receiver", () => {
    expect(attributes("def method(this):\n self.z=0\n self.a=self.z=1\n this.x=2\n other.self.y=3\n self.child.x=4")).toEqual([["a", "z"]]);
  });
  it("excludes direct class-body stores", () => { expect(attributes("self.x=1")).toEqual([[]]); });
  it("retains private attribute spelling and normalizes identifiers", () => {
    expect(attributes("def f(self):\n self.__private=1\n self.K=2")).toEqual([["K", "__private"]]);
  });
  it("excludes augmented stores, deletes, loads and annotation-only targets", () => {
    expect(attributes("def f(self):\n self.a+=1\n del self.b\n x=self.c\n self.d: int\n self.e: int=1")).toEqual([["e"]]);
  });
  it("includes tuple/list unpacking, loop and with targets", () => {
    expect(attributes("def f(self):\n self.a,[self.b,*self.c]=value\n for self.d in []: pass\n with value as self.e: pass")).toEqual([["a", "b", "c", "d", "e"]]);
  });
  it("retains syntactically compiled stores even in unreachable suites", () => {
    expect(attributes("def f(self):\n if False: self.a=1\n return\n self.b=1")).toEqual([["a", "b"]]);
  });
  it("attributes nested class body stores to the enclosing class and methods to the nested class", () => {
    expect(attributes("class D:\n self.outer=1\n def f(self): self.inner=1")).toEqual([["outer"], ["inner"]]);
  });
  it("collects through deeply nested functions", () => {
    expect(attributes("def f():\n def g():\n  self.x=1")).toEqual([["x"]]);
  });
  it("distinguishes inlined and generator comprehension code scopes", () => {
    expect(attributes("x=[0 for self.inline in []]\ny=(0 for self.generator in [])")).toEqual([["generator"]]);
    expect(attributes("def f():\n x=[0 for self.inline in []]\n y=(0 for self.generator in [])")).toEqual([["generator", "inline"]]);
  });
  it("tracks outer iterable and nested comprehension scopes separately", () => {
    expect(attributes("x=[(0 for self.inner in []) for self.outer in (0 for self.iterable in [])]")).toEqual([["inner", "iterable"]]);
  });
  it("processes definition headers in their containing code scope", () => {
    expect(attributes("def f(x=[0 for self.inline in []], y=(0 for self.generator in [])): pass")).toEqual([["generator"]]);
  });
  it("sorts Unicode names by code point rather than UTF-16 units", () => {
    expect(attributes("def f():\n self.𐀀=1\n self.Ａ=2\n self.龘=3")).toEqual([["A", "龘", "𐀀"]]);
  });
  it("keys results by analyzed class identities and includes empty classes", () => {
    const analysis = analyzeModule("class C: pass\nclass C: pass");
    expect(analysis.staticAttributes.size).toBe(2);
    for (const child of analysis.scopes.children) expect(analysis.staticAttributes.get(child.scope)).toEqual([]);
  });
});
