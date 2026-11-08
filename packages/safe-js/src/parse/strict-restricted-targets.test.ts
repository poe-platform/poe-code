import { expect, it } from "vitest";
import { parseDynamicFunction } from "./parser.js";

it.each(["eval", "arguments"])("rejects strict binding and assignment targets named %s", name => {
  for (const body of [
    `var {${name}}=obj`, `var {${name}=3}=obj`,
    `({${name}}=obj)`, `({${name}=3}=obj)`, `({key:${name}}=obj)`,
    `[${name}]=obj`, `({...${name}}=obj)`, `[...${name}]=obj`,
    `${name}=3`, `${name}+=3`, `${name}&&=3`, `${name}++`, `++${name}`,
    `for(${name} of obj){}`, `for({${name}} of obj){}`, `for(${name} in obj){}`
  ]) {
    const source = `"use strict";${body}`;
    expect(() => Function(source)).toThrow(SyntaxError);
    expect(() => parseDynamicFunction("normal", "", source)).toThrow();
  }
});

it.each(["eval", "arguments"])("preserves reads, member writes and non-strict writes to %s", name => {
  for (const source of [
    `"use strict";return ${name}`, `"use strict";return {${name}}`,
    `"use strict";obj.${name}=3`, `"use strict";({${name}:obj.value}=obj)`,
    `${name}=3`, `var {${name}}=obj`, `({${name}}=obj)`
  ]) {
    expect(() => Function(source)).not.toThrow();
    expect(() => parseDynamicFunction("normal", "", source)).not.toThrow();
  }
});
