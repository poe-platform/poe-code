import { describe, expect, it } from "vitest";
import { lint } from "./index.js";
import { AS003 } from "./rules/AS003.js";
import { AS_UNUSED_IMPORT } from "./rules/AS-unused-import.js";
import { AS_UNREACHABLE } from "./rules/AS-unreachable.js";
import { AS_UNBOUNDED_LOOP } from "./rules/AS-unbounded-loop.js";
import { AS_ASYNC_NOT_NEEDED } from "./rules/AS-async-not-needed.js";
import { AS006_007 } from "./rules/AS006-007.js";
import { AS009 } from "./rules/AS009.js";
import { AS_SHADOW_GLOBAL } from "./rules/AS-shadow-global.js";

describe("class lint traversal", () => {
  it("admits supported class construction", () => {
    expect(lint('class A { read() { return 7; } } class B extends A { read() { return super.read(); } } return new B().read();')).toEqual([]);
  });
  it.each([
    'class C extends missing {}',
    'class C { [missing]() {} }',
    'class C { read() { return missing; } }',
    'class C { value = missing; }',
    'class C { static { missing; } }',
    'const C = class { read() { return missing; } };'
  ])("reports unresolved references in %s", source => {
    expect(AS003(source)).toEqual(expect.arrayContaining([expect.objectContaining({ code: "AS003" })]));
  });
  it("binds class names without leaking named expressions", () => {
    const source = 'class C { read() { return C; } } const D = class Inner { read() { return Inner; } }; return [C,D,Inner];';
    expect(AS003(source)).toHaveLength(1);
    expect(AS003(source)[0]?.span.start.offset).toBe(source.lastIndexOf("Inner"));
  });
  it("recognizes imports used only in class elements", () => {
    expect(AS_UNUSED_IMPORT('import { value } from "api"; class C { read() { return value; } }')).toEqual([]);
  });
  it("preserves import shadowing by a named class expression", () => {
    expect(AS_UNUSED_IMPORT('import { Inner } from "api"; const C = class Inner { read() { return Inner; } };')).toHaveLength(1);
  });
  it("visits method and static block control flow", () => {
    expect(AS_UNREACHABLE('class C { read() { return 7; missing; } static { throw 7; missing; } }')).toHaveLength(2);
    expect(AS_UNBOUNDED_LOOP('class C { read() { while(true){} } }')).toHaveLength(1);
  });
  it("checks async methods without attributing their await to the outer function", () => {
    expect(AS_ASYNC_NOT_NEEDED('async function outer(){class C{async read(){return await 7;}}return C;}')).toHaveLength(1);
    expect(AS_ASYNC_NOT_NEEDED('class C{async read(){return 7;}}')).toHaveLength(1);
  });
  it("attributes computed-key await to the defining function", () => {
    expect(AS_ASYNC_NOT_NEEDED('async function outer(){class C{[await 7](){}}return C;}')).toEqual([]);
  });
  it("hoists static block vars without leaking them", () => {
    const source = 'class C{static{if(true){var x=7;}this.x=x;}}return x;';
    expect(AS003(source)).toHaveLength(1);
    expect(AS003(source)[0]?.span.start.offset).toBe(source.lastIndexOf('x'));
  });
  it("does not count named class self-reference as reading an outer binding", () => {
    const diagnostics = AS006_007('const Inner=7;const C=class Inner{read(){return Inner;}};return C;');
    expect(diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ message: expect.stringContaining("Inner") })]));
  });
  it("does not treat a named class as a host import", () => {
    expect(AS009('import { Parent } from "api";const C=class Parent{async read(){return Parent();}};return C;')).toEqual([]);
  });
  it("reports class names shadowing built-ins", () => {
    expect(AS_SHADOW_GLOBAL('class Number{};const C=class String{};')).toHaveLength(2);
  });
});
