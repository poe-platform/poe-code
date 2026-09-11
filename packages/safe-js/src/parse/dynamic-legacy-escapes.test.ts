import { expect, it } from "vitest";
import { parse, parseDynamicFunction } from "./parser.js";

const escapes = ["\\1", "\\7", "\\12", "\\141", "\\377", "\\400", "\\777", "\\08", "\\09", "\\8", "\\9", "\\018"];

it.each(escapes)("decodes non-strict string escape %s like native JavaScript", escape => {
  const body = `return "${escape}"`;
  expect(parseDynamicFunction("normal", "", body).body).toMatchObject({
    body: [{type: "ReturnStatement", argument: {type: "StringLiteral", value: Function(body)()}}]
  });
});

it.each(escapes)("rejects strict string escape %s, including earlier directives", escape => {
  expect(() => parse(`"${escape}"`)).toThrow();
  for (const body of [
    `"use strict";return "${escape}"`,
    `"${escape}";"use strict";return 1`,
    `return function(){"use strict";return "${escape}"}`,
    `return class {read(){return "${escape}"}}`,
    `"use strict";return \`${"${"}"${escape}"}\``
  ]) {
    expect(() => Function(body)).toThrow();
    expect(() => parseDynamicFunction("normal", "", body)).toThrow();
  }
});

it.each(["\\0", "\\x31", "\\u0031", "\\\\1"])("preserves strict valid escape %s", escape => {
  const body = `"use strict";return "${escape}"`;
  expect(() => parseDynamicFunction("normal", "", body)).not.toThrow();
  expect(() => parse(`"${escape}"`)).not.toThrow();
});

it.each([
  ["value='\\141'", "return value"],
  ["", "return `${'\\141'}`"],
  ["", "'\\141';0;'use strict';return 1"],
  ["", "'\\141';;'use strict';return 1"]
])("allows legacy escape outside strict grammar in %s / %s", (parameters, body) => {
  expect(() => Function(parameters, body)).not.toThrow();
  expect(() => parseDynamicFunction("normal", parameters, body)).not.toThrow();
});
