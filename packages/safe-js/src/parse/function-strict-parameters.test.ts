import { Script } from "node:vm";
import { expect, it } from "vitest";
import { parseExecutableModule } from "./parser.js";

it.each([
  "function f(a=1){'use strict';return a}",
  "(function(a=1){'use strict';return a})",
  "function f(...a){'use strict';return a}",
  "function f({a}){'use strict';return a}",
  "function f([a]){'use strict';return a}",
  "(a=1)=>{'use strict';return a}",
  "async (...a)=>{'use strict';return a}",
  "function* f(a=1){'use strict';yield a}",
  "async function f(a=1){'use strict';return a}",
  "async function* f(a=1){'use strict';yield a}",
  "({f(a=1){'use strict';return a}})",
  "class C{f(a=1){'use strict';return a}}",
  "({set f(a=1){'use strict'}})",
  "function f(a=1){'other';/* directive */\n'use strict'\nreturn a}"
])("rejects strict directives with non-simple parameters: %s", source => {
  expect(() => new Script(source)).toThrow(SyntaxError);
  expect(() => parseExecutableModule(source)).toThrow(/non-simple parameters/);
});

it.each([
  "function f(a){'use strict';return a}",
  "function f(){'use strict'}",
  "function f(a=1){return a}",
  "function f(a=1){('use strict');return a}",
  "function f(a=1){0;'use strict';return a}",
  "function f(a=1){'use\\x20strict';return a}",
  "function f(a=1){'other' + ''; 'use strict';return a}",
  "function f(a=1){return function(){'use strict'}}"
])("preserves valid directive and parameter combinations: %s", source => {
  expect(() => new Script(source)).not.toThrow();
  expect(() => parseExecutableModule(source)).not.toThrow();
});
