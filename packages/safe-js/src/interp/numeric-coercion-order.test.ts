import { expect, it } from "vitest";
import { run } from "../core.js";

const operators = ["**", "*", "/", "%", "-", "<<", ">>", ">>>", "&", "|", "^"];

it.each(operators.flatMap(operator => [operator, `${operator}=`]))(
  "%s rejects primitive Symbols but converts both operands before a BigInt mismatch",
  async operator => {
    for (const initial of ["Symbol()", "1n"]) {
      const source = `const trace=[];let left=${initial};
        const right={valueOf(){trace.push('right');return 2}};
        try { left ${operator} right } catch(error) { return [error.name,trace] }`;
      const expected = Function(source)();
      expect(expected).toEqual(["TypeError", initial === "Symbol()" ? [] : ["right"]]);
      expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
    }
  }
);

it.each(operators.flatMap(operator => [operator, `${operator}=`]))(
  "%s completes left numeric conversion before converting the right operand",
  async operator => {
    const source = `const trace=[];
      let left={valueOf(){trace.push('left');return Symbol()}};
      function rhs(){trace.push('evaluate right');return {valueOf(){trace.push('right');throw new Error('wrong error')}}}
      try { left ${operator} rhs() } catch(error) { return [error.name,trace] }`;
    const expected = Function(source)();
    expect(expected).toEqual(["TypeError", ["evaluate right", "left"]]);
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  }
);

it.each(["+", "+=", "<", ">", "<=", ">="])(
  "%s preserves conversion of both primitives before numeric conversion",
  async operator => {
    const source = `const trace=[];
      let left={valueOf(){trace.push('left');return Symbol()}};
      const right={valueOf(){trace.push('right');return 2}};
      try { left ${operator} right } catch(error) { return [error.name,trace] }`;
    const expected = Function(source)();
    expect(expected).toEqual(["TypeError", ["left", "right"]]);
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  }
);
