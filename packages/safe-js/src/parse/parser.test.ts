import { describe, expect, it } from "vitest";

import { DisallowedSyntaxError, parse } from "../parse.js";
import { ParseError } from "./format-error.js";
import { parseModule } from "./parser.js";

describe("parse", () => {
  it.each([
    "callback = () => 1;",
    "callback = value => value;",
    "callback = async () => await task();",
    "callback = async value => value;",
    "first = second = () => 1;",
    "callback ||= () => 1;",
    "callback &&= () => 1;",
    "callback ??= () => 1;",
    "const callback = condition ? () => 1 : () => 2;",
    "const callback = condition ? first = () => 1 : second = () => 2;",
    "[callback = () => 1] = [];",
    "({ callback = () => 1 } = {});",
    "({ callback: callback = () => 1 } = {});",
    "function* callbacks() { yield () => 1; }"
  ])("accepts arrows in assignment-expression positions: %s", (source) => {
    expect(() => parseModule(source)).not.toThrow();
  });

  it("accepts byte-zero hashbangs and leading byte order marks", () => {
    expect(parse("#!/usr/bin/env bun\n1")).toMatchObject({
      type: "NumericLiteral",
      raw: "1",
      value: 1
    });

    expect(parse("\uFEFF1")).toMatchObject({
      type: "NumericLiteral",
      raw: "1",
      value: 1
    });

    expect(parseModule("#!/usr/bin/env node\nreturn 1;").body[0]).toMatchObject({
      type: "ReturnStatement"
    });
  });

  it("tracks closing delimiters in empty arrays and objects", () => {
    expect(parse("[]")).toEqual({
      type: "ArrayExpression",
      elements: [],
      span: {
        start: { line: 1, column: 1, offset: 0 },
        end: { line: 1, column: 3, offset: 2 }
      }
    });

    expect(parse("{}")).toEqual({
      type: "ObjectExpression",
      properties: [],
      span: {
        start: { line: 1, column: 1, offset: 0 },
        end: { line: 1, column: 3, offset: 2 }
      }
    });
  });

  it("parses bare identifiers and primitive literals with spans", () => {
    expect(parse("agentName")).toEqual({
      type: "Identifier",
      name: "agentName",
      span: {
        start: { line: 1, column: 1, offset: 0 },
        end: { line: 1, column: 10, offset: 9 }
      }
    });

    expect(parse("0x1f")).toEqual({
      type: "NumericLiteral",
      raw: "0x1f",
      value: 31,
      span: {
        start: { line: 1, column: 1, offset: 0 },
        end: { line: 1, column: 5, offset: 4 }
      }
    });

    expect(parse("'line\\nvalue'")).toEqual({
      type: "StringLiteral",
      raw: "'line\\nvalue'",
      value: "line\nvalue",
      span: {
        start: { line: 1, column: 1, offset: 0 },
        end: { line: 1, column: 14, offset: 13 }
      }
    });

    expect(parse("false")).toEqual({
      type: "BooleanLiteral",
      raw: "false",
      value: false,
      span: {
        start: { line: 1, column: 1, offset: 0 },
        end: { line: 1, column: 6, offset: 5 }
      }
    });

    expect(parse("null")).toEqual({
      type: "NullLiteral",
      raw: "null",
      value: null,
      span: {
        start: { line: 1, column: 1, offset: 0 },
        end: { line: 1, column: 5, offset: 4 }
      }
    });

    expect(parse("undefined")).toEqual({
      type: "UndefinedLiteral",
      raw: "undefined",
      value: undefined,
      span: {
        start: { line: 1, column: 1, offset: 0 },
        end: { line: 1, column: 10, offset: 9 }
      }
    });
  });

  it("parses arrays with nested literals and spread elements", () => {
    expect(parse("[1, user, ...rest, { done: true }]")).toEqual({
      type: "ArrayExpression",
      elements: [
        {
          type: "NumericLiteral",
          raw: "1",
          value: 1,
          span: {
            start: { line: 1, column: 2, offset: 1 },
            end: { line: 1, column: 3, offset: 2 }
          }
        },
        {
          type: "Identifier",
          name: "user",
          span: {
            start: { line: 1, column: 5, offset: 4 },
            end: { line: 1, column: 9, offset: 8 }
          }
        },
        {
          type: "SpreadElement",
          argument: {
            type: "Identifier",
            name: "rest",
            span: {
              start: { line: 1, column: 14, offset: 13 },
              end: { line: 1, column: 18, offset: 17 }
            }
          },
          span: {
            start: { line: 1, column: 11, offset: 10 },
            end: { line: 1, column: 18, offset: 17 }
          }
        },
        {
          type: "ObjectExpression",
          properties: [
            {
              type: "Property",
              computed: false,
              shorthand: false,
              key: {
                type: "Identifier",
                name: "done",
                span: {
                  start: { line: 1, column: 22, offset: 21 },
                  end: { line: 1, column: 26, offset: 25 }
                }
              },
              value: {
                type: "BooleanLiteral",
                raw: "true",
                value: true,
                span: {
                  start: { line: 1, column: 28, offset: 27 },
                  end: { line: 1, column: 32, offset: 31 }
                }
              },
              span: {
                start: { line: 1, column: 22, offset: 21 },
                end: { line: 1, column: 32, offset: 31 }
              }
            }
          ],
          span: {
            start: { line: 1, column: 20, offset: 19 },
            end: { line: 1, column: 34, offset: 33 }
          }
        }
      ],
      span: {
        start: { line: 1, column: 1, offset: 0 },
        end: { line: 1, column: 35, offset: 34 }
      }
    });
  });

  it("accepts trailing commas in arrays and objects", () => {
    expect(parse("[1, ...rest,]")).toEqual({
      type: "ArrayExpression",
      elements: [
        {
          type: "NumericLiteral",
          raw: "1",
          value: 1,
          span: {
            start: { line: 1, column: 2, offset: 1 },
            end: { line: 1, column: 3, offset: 2 }
          }
        },
        {
          type: "SpreadElement",
          argument: {
            type: "Identifier",
            name: "rest",
            span: {
              start: { line: 1, column: 8, offset: 7 },
              end: { line: 1, column: 12, offset: 11 }
            }
          },
          span: {
            start: { line: 1, column: 5, offset: 4 },
            end: { line: 1, column: 12, offset: 11 }
          }
        }
      ],
      span: {
        start: { line: 1, column: 1, offset: 0 },
        end: { line: 1, column: 14, offset: 13 }
      }
    });

    expect(parse("{ user, ...rest, }")).toEqual({
      type: "ObjectExpression",
      properties: [
        {
          type: "Property",
          computed: false,
          shorthand: true,
          key: {
            type: "Identifier",
            name: "user",
            span: {
              start: { line: 1, column: 3, offset: 2 },
              end: { line: 1, column: 7, offset: 6 }
            }
          },
          value: {
            type: "Identifier",
            name: "user",
            span: {
              start: { line: 1, column: 3, offset: 2 },
              end: { line: 1, column: 7, offset: 6 }
            }
          },
          span: {
            start: { line: 1, column: 3, offset: 2 },
            end: { line: 1, column: 7, offset: 6 }
          }
        },
        {
          type: "SpreadElement",
          argument: {
            type: "Identifier",
            name: "rest",
            span: {
              start: { line: 1, column: 12, offset: 11 },
              end: { line: 1, column: 16, offset: 15 }
            }
          },
          span: {
            start: { line: 1, column: 9, offset: 8 },
            end: { line: 1, column: 16, offset: 15 }
          }
        }
      ],
      span: {
        start: { line: 1, column: 1, offset: 0 },
        end: { line: 1, column: 19, offset: 18 }
      }
    });
  });

  it("parses objects with computed keys, shorthand properties, and spread", () => {
    expect(parse("{ [key]: `hi ${name}`, user, ...rest }")).toEqual({
      type: "ObjectExpression",
      properties: [
        {
          type: "Property",
          computed: true,
          shorthand: false,
          key: {
            type: "Identifier",
            name: "key",
            span: {
              start: { line: 1, column: 4, offset: 3 },
              end: { line: 1, column: 7, offset: 6 }
            }
          },
          value: {
            type: "TemplateLiteral",
            expressions: [
              {
                type: "Identifier",
                name: "name",
                span: {
                  start: { line: 1, column: 16, offset: 15 },
                  end: { line: 1, column: 20, offset: 19 }
                }
              }
            ],
            quasis: [
              {
                type: "TemplateElement",
                tail: false,
                value: {
                  raw: "hi ",
                  cooked: "hi "
                },
                span: {
                  start: { line: 1, column: 11, offset: 10 },
                  end: { line: 1, column: 14, offset: 13 }
                }
              },
              {
                type: "TemplateElement",
                tail: true,
                value: {
                  raw: "",
                  cooked: ""
                },
                span: {
                  start: { line: 1, column: 21, offset: 20 },
                  end: { line: 1, column: 21, offset: 20 }
                }
              }
            ],
            span: {
              start: { line: 1, column: 10, offset: 9 },
              end: { line: 1, column: 22, offset: 21 }
            }
          },
          span: {
            start: { line: 1, column: 3, offset: 2 },
            end: { line: 1, column: 22, offset: 21 }
          }
        },
        {
          type: "Property",
          computed: false,
          shorthand: true,
          key: {
            type: "Identifier",
            name: "user",
            span: {
              start: { line: 1, column: 24, offset: 23 },
              end: { line: 1, column: 28, offset: 27 }
            }
          },
          value: {
            type: "Identifier",
            name: "user",
            span: {
              start: { line: 1, column: 24, offset: 23 },
              end: { line: 1, column: 28, offset: 27 }
            }
          },
          span: {
            start: { line: 1, column: 24, offset: 23 },
            end: { line: 1, column: 28, offset: 27 }
          }
        },
        {
          type: "SpreadElement",
          argument: {
            type: "Identifier",
            name: "rest",
            span: {
              start: { line: 1, column: 33, offset: 32 },
              end: { line: 1, column: 37, offset: 36 }
            }
          },
          span: {
            start: { line: 1, column: 30, offset: 29 },
            end: { line: 1, column: 37, offset: 36 }
          }
        }
      ],
      span: {
        start: { line: 1, column: 1, offset: 0 },
        end: { line: 1, column: 39, offset: 38 }
      }
    });
  });

  it("parses object method shorthand as function-valued properties", () => {
    const result = parse("{ reset() { return 1; }, async load(value) { return value; } }");

    expect(result).toMatchObject({
      type: "ObjectExpression",
      properties: [
        {
          type: "Property",
          computed: false,
          shorthand: false,
          key: { type: "Identifier", name: "reset" },
          value: {
            type: "FunctionExpression",
            async: false,
            generator: false,
            id: undefined,
            params: [],
            body: { type: "BlockStatement" }
          }
        },
        {
          type: "Property",
          computed: false,
          shorthand: false,
          key: { type: "Identifier", name: "load" },
          value: {
            type: "FunctionExpression",
            async: true,
            generator: false,
            id: undefined,
            params: [{ type: "Identifier", name: "value" }],
            body: { type: "BlockStatement" }
          }
        }
      ]
    });
  });

  it("parses shorthand methods with all supported property name forms", () => {
    const result = parse(
      "{ default() { return 1; }, async() { return 2; }, ['load']() { return 3; }, 4() { return 4; } }"
    );

    expect(result).toMatchObject({
      type: "ObjectExpression",
      properties: [
        {
          computed: false,
          key: { type: "Identifier", name: "default" },
          value: { type: "FunctionExpression", async: false }
        },
        {
          computed: false,
          key: { type: "Identifier", name: "async" },
          value: { type: "FunctionExpression", async: false }
        },
        {
          computed: true,
          key: { type: "StringLiteral", value: "load" },
          value: { type: "FunctionExpression", async: false }
        },
        {
          computed: false,
          key: { type: "NumericLiteral", value: 4 },
          value: { type: "FunctionExpression", async: false }
        }
      ]
    });
  });

  it("does not parse async method shorthand across a line break", () => {
    expect(() => parse("{ async\nload() {} }")).toThrow();
  });

  it.each([
    ["async generator", "{ async *gen() {} }", "Generator shorthand methods are not supported"],
    ["getter", "{ get value(next) { return 1; } }", "A getter cannot have parameters"],
    ["computed getter", "{ get [value](next) {} }", "A getter cannot have parameters"],
    ["setter", "{ set value() {} }", "A setter must have exactly one non-rest parameter"],
    ["literal setter", "{ set 'value'(...next) {} }", "A setter must have exactly one non-rest parameter"]
  ])("rejects invalid or unsupported %s object method syntax", (_syntax, source, message) => {
    expect(() => parse(source)).toThrowError(message);
  });

  it("parses template literals with nested expressions and exact spans", () => {
    expect(parse("`Hello ${user}, ${['x', data]}`")).toEqual({
      type: "TemplateLiteral",
      expressions: [
        {
          type: "Identifier",
          name: "user",
          span: {
            start: { line: 1, column: 10, offset: 9 },
            end: { line: 1, column: 14, offset: 13 }
          }
        },
        {
          type: "ArrayExpression",
          elements: [
            {
              type: "StringLiteral",
              raw: "'x'",
              value: "x",
              span: {
                start: { line: 1, column: 20, offset: 19 },
                end: { line: 1, column: 23, offset: 22 }
              }
            },
            {
              type: "Identifier",
              name: "data",
              span: {
                start: { line: 1, column: 25, offset: 24 },
                end: { line: 1, column: 29, offset: 28 }
              }
            }
          ],
          span: {
            start: { line: 1, column: 19, offset: 18 },
            end: { line: 1, column: 30, offset: 29 }
          }
        }
      ],
      quasis: [
        {
          type: "TemplateElement",
          tail: false,
          value: {
            raw: "Hello ",
            cooked: "Hello "
          },
          span: {
            start: { line: 1, column: 2, offset: 1 },
            end: { line: 1, column: 8, offset: 7 }
          }
        },
        {
          type: "TemplateElement",
          tail: false,
          value: {
            raw: ", ",
            cooked: ", "
          },
          span: {
            start: { line: 1, column: 15, offset: 14 },
            end: { line: 1, column: 17, offset: 16 }
          }
        },
        {
          type: "TemplateElement",
          tail: true,
          value: {
            raw: "",
            cooked: ""
          },
          span: {
            start: { line: 1, column: 31, offset: 30 },
            end: { line: 1, column: 31, offset: 30 }
          }
        }
      ],
      span: {
        start: { line: 1, column: 1, offset: 0 },
        end: { line: 1, column: 32, offset: 31 }
      }
    });
  });

  it("parses tagged template expressions", () => {
    expect(parse("String.raw`a\\nb${value}`")).toMatchObject({
      type: "TaggedTemplateExpression",
      tag: {
        type: "MemberExpression",
        computed: false,
        object: {
          type: "Identifier",
          name: "String"
        },
        property: {
          type: "Identifier",
          name: "raw"
        }
      },
      quasi: {
        type: "TemplateLiteral",
        expressions: [
          {
            type: "Identifier",
            name: "value"
          }
        ],
        quasis: [
          {
            type: "TemplateElement",
            tail: false,
            value: {
              raw: "a\\nb",
              cooked: "a\nb"
            }
          },
          {
            type: "TemplateElement",
            tail: true,
            value: {
              raw: "",
              cooked: ""
            }
          }
        ]
      }
    });
  });

  it("allows malformed escapes in tagged templates but rejects them in bare templates", () => {
    expect(parse("String.raw`\\uc1`")).toMatchObject({
      type: "TaggedTemplateExpression",
      quasi: {
        quasis: [
          {
            value: {
              raw: "\\uc1",
              cooked: undefined
            }
          }
        ]
      }
    });

    expect(parse("String.raw`/\\1`")).toMatchObject({
      type: "TaggedTemplateExpression",
      quasi: {
        quasis: [
          {
            value: {
              raw: "/\\1",
              cooked: undefined
            }
          }
        ]
      }
    });

    expect(() => parse("`\\uc1`")).toThrowError("Invalid unicode escape");
    expect(() => parse("`/\\1`")).toThrowError("Legacy octal escape sequences are not supported");
  });

  it("rebases spans for multiline template expressions", () => {
    expect(parse("`A\\n${\n  { value, list: [1, ...rest] }\n}Z`")).toEqual({
      type: "TemplateLiteral",
      expressions: [
        {
          type: "ObjectExpression",
          properties: [
            {
              type: "Property",
              computed: false,
              shorthand: true,
              key: {
                type: "Identifier",
                name: "value",
                span: {
                  start: { line: 2, column: 5, offset: 11 },
                  end: { line: 2, column: 10, offset: 16 }
                }
              },
              value: {
                type: "Identifier",
                name: "value",
                span: {
                  start: { line: 2, column: 5, offset: 11 },
                  end: { line: 2, column: 10, offset: 16 }
                }
              },
              span: {
                start: { line: 2, column: 5, offset: 11 },
                end: { line: 2, column: 10, offset: 16 }
              }
            },
            {
              type: "Property",
              computed: false,
              shorthand: false,
              key: {
                type: "Identifier",
                name: "list",
                span: {
                  start: { line: 2, column: 12, offset: 18 },
                  end: { line: 2, column: 16, offset: 22 }
                }
              },
              value: {
                type: "ArrayExpression",
                elements: [
                  {
                    type: "NumericLiteral",
                    raw: "1",
                    value: 1,
                    span: {
                      start: { line: 2, column: 19, offset: 25 },
                      end: { line: 2, column: 20, offset: 26 }
                    }
                  },
                  {
                    type: "SpreadElement",
                    argument: {
                      type: "Identifier",
                      name: "rest",
                      span: {
                        start: { line: 2, column: 25, offset: 31 },
                        end: { line: 2, column: 29, offset: 35 }
                      }
                    },
                    span: {
                      start: { line: 2, column: 22, offset: 28 },
                      end: { line: 2, column: 29, offset: 35 }
                    }
                  }
                ],
                span: {
                  start: { line: 2, column: 18, offset: 24 },
                  end: { line: 2, column: 30, offset: 36 }
                }
              },
              span: {
                start: { line: 2, column: 12, offset: 18 },
                end: { line: 2, column: 30, offset: 36 }
              }
            }
          ],
          span: {
            start: { line: 2, column: 3, offset: 9 },
            end: { line: 2, column: 32, offset: 38 }
          }
        }
      ],
      quasis: [
        {
          type: "TemplateElement",
          tail: false,
          value: {
            raw: "A\\n",
            cooked: "A\n"
          },
          span: {
            start: { line: 1, column: 2, offset: 1 },
            end: { line: 1, column: 5, offset: 4 }
          }
        },
        {
          type: "TemplateElement",
          tail: true,
          value: {
            raw: "Z",
            cooked: "Z"
          },
          span: {
            start: { line: 3, column: 2, offset: 40 },
            end: { line: 3, column: 3, offset: 41 }
          }
        }
      ],
      span: {
        start: { line: 1, column: 1, offset: 0 },
        end: { line: 3, column: 4, offset: 42 }
      }
    });
  });

  it("parses operator precedence and associativity like JavaScript", () => {
    expect(parse("2 + 3 * 4")).toMatchObject({
      type: "BinaryExpression",
      operator: "+",
      left: {
        type: "NumericLiteral",
        value: 2
      },
      right: {
        type: "BinaryExpression",
        operator: "*",
        left: {
          type: "NumericLiteral",
          value: 3
        },
        right: {
          type: "NumericLiteral",
          value: 4
        }
      }
    });

    expect(parse("2 ** 3 ** 2")).toMatchObject({
      type: "BinaryExpression",
      operator: "**",
      left: {
        type: "NumericLiteral",
        value: 2
      },
      right: {
        type: "BinaryExpression",
        operator: "**",
        left: {
          type: "NumericLiteral",
          value: 3
        },
        right: {
          type: "NumericLiteral",
          value: 2
        }
      }
    });

    expect(parse("a + b * c ** d")).toMatchObject({
      type: "BinaryExpression",
      operator: "+",
      left: {
        type: "Identifier",
        name: "a"
      },
      right: {
        type: "BinaryExpression",
        operator: "*",
        left: {
          type: "Identifier",
          name: "b"
        },
        right: {
          type: "BinaryExpression",
          operator: "**",
          left: {
            type: "Identifier",
            name: "c"
          },
          right: {
            type: "Identifier",
            name: "d"
          }
        }
      }
    });

    expect(parse("a ? b : c ? d : e")).toMatchObject({
      type: "ConditionalExpression",
      test: {
        type: "Identifier",
        name: "a"
      },
      consequent: {
        type: "Identifier",
        name: "b"
      },
      alternate: {
        type: "ConditionalExpression",
        test: {
          type: "Identifier",
          name: "c"
        },
        consequent: {
          type: "Identifier",
          name: "d"
        },
        alternate: {
          type: "Identifier",
          name: "e"
        }
      }
    });

    expect(() => parseModule(createNestedConditionalModule(500), "generated.ajs")).toThrow(
      ParseError
    );
    expect(() => parseModule(createNestedConditionalModule(500), "generated.ajs")).toThrow(
      "Conditional expression nesting limit exceeded"
    );

    expect(parse("a || b && c")).toMatchObject({
      type: "LogicalExpression",
      operator: "||",
      left: {
        type: "Identifier",
        name: "a"
      },
      right: {
        type: "LogicalExpression",
        operator: "&&",
        left: {
          type: "Identifier",
          name: "b"
        },
        right: {
          type: "Identifier",
          name: "c"
        }
      }
    });

    expect(parse("!flag || left && right")).toMatchObject({
      type: "LogicalExpression",
      operator: "||",
      left: {
        type: "UnaryExpression",
        operator: "!",
        prefix: true,
        argument: {
          type: "Identifier",
          name: "flag"
        }
      },
      right: {
        type: "LogicalExpression",
        operator: "&&",
        left: {
          type: "Identifier",
          name: "left"
        },
        right: {
          type: "Identifier",
          name: "right"
        }
      }
    });

    expect(parse("a = b = c")).toMatchObject({
      type: "AssignmentExpression",
      operator: "=",
      left: {
        type: "Identifier",
        name: "a"
      },
      right: {
        type: "AssignmentExpression",
        operator: "=",
        left: {
          type: "Identifier",
          name: "b"
        },
        right: {
          type: "Identifier",
          name: "c"
        }
      }
    });

    expect(parse("!a++")).toMatchObject({
      type: "UnaryExpression",
      operator: "!",
      argument: {
        type: "UpdateExpression",
        operator: "++",
        prefix: false,
        argument: {
          type: "Identifier",
          name: "a"
        }
      }
    });

    expect(parse("typeof a + b")).toMatchObject({
      type: "BinaryExpression",
      operator: "+",
      left: {
        type: "UnaryExpression",
        operator: "typeof",
        argument: {
          type: "Identifier",
          name: "a"
        }
      },
      right: {
        type: "Identifier",
        name: "b"
      }
    });

    expect(parse("typeof value")).toMatchObject({
      type: "UnaryExpression",
      operator: "typeof",
      prefix: true,
      argument: {
        type: "Identifier",
        name: "value"
      }
    });

    expect(parse("value in fallback || ready")).toMatchObject({
      type: "LogicalExpression",
      operator: "||",
      left: {
        type: "BinaryExpression",
        operator: "in",
        left: {
          type: "Identifier",
          name: "value"
        },
        right: {
          type: "Identifier",
          name: "fallback"
        }
      },
      right: {
        type: "Identifier",
        name: "ready"
      }
    });

    expect(parse("left + right in source")).toMatchObject({
      type: "BinaryExpression",
      operator: "in",
      left: {
        type: "BinaryExpression",
        operator: "+",
        left: {
          type: "Identifier",
          name: "left"
        },
        right: {
          type: "Identifier",
          name: "right"
        }
      },
      right: {
        type: "Identifier",
        name: "source"
      }
    });
  });

  it("parses comma sequence expressions only where expression grammar permits them", () => {
    expect(parseModule("a, b, c")).toMatchObject({
      type: "Module",
      body: [
        {
          type: "ExpressionStatement",
          expression: {
            type: "SequenceExpression",
            expressions: [
              { type: "Identifier", name: "a" },
              { type: "Identifier", name: "b" },
              { type: "Identifier", name: "c" }
            ]
          }
        }
      ]
    });

    expect(parse("for (let i = 0, j = 0; i < n; i++, j++) {}")).toMatchObject({
      type: "ForStatement",
      init: {
        type: "VariableDeclaration",
        declarations: [
          { id: { type: "Identifier", name: "i" } },
          { id: { type: "Identifier", name: "j" } }
        ]
      },
      update: {
        type: "SequenceExpression",
        expressions: [
          {
            type: "UpdateExpression",
            operator: "++",
            prefix: false,
            argument: { type: "Identifier", name: "i" }
          },
          {
            type: "UpdateExpression",
            operator: "++",
            prefix: false,
            argument: { type: "Identifier", name: "j" }
          }
        ]
      }
    });
  });

  it("rejects ambiguous or invalid precedence edge cases", () => {
    expect(() => parse("-2 ** 2")).toThrowError(
      "Unary expressions cannot be used as the left-hand side of '**' without parentheses"
    );

    expect(() => parse("a ?? b || c")).toThrowError(
      "Cannot mix '??' with '&&' or '||' without parentheses"
    );

    expect(() => parse("++a++")).toThrowError("Invalid update target");
  });

  it("parses left-associative nullish coalescing chains", () => {
    expect(parse("a ?? b ?? c")).toMatchObject({
      type: "LogicalExpression",
      operator: "??",
      left: {
        type: "LogicalExpression",
        operator: "??",
        left: { type: "Identifier", name: "a" },
        right: { type: "Identifier", name: "b" }
      },
      right: { type: "Identifier", name: "c" }
    });
  });

  it("parses member access, calls, and optional chaining", () => {
    expect(parse("service.api?.getUser(userId)?.(fallback)")).toMatchObject({
      type: "CallExpression",
      optional: true,
      callee: {
        type: "CallExpression",
        optional: false,
        callee: {
          type: "MemberExpression",
          optional: true,
          computed: false,
          object: {
            type: "MemberExpression",
            optional: false,
            computed: false,
            object: {
              type: "Identifier",
              name: "service"
            },
            property: {
              type: "Identifier",
              name: "api"
            }
          },
          property: {
            type: "Identifier",
            name: "getUser"
          }
        },
        arguments: [
          {
            type: "Identifier",
            name: "userId"
          }
        ]
      },
      arguments: [
        {
          type: "Identifier",
          name: "fallback"
        }
      ]
    });

    expect(parse("user?.profile[role]")).toMatchObject({
      type: "MemberExpression",
      optional: false,
      computed: true,
      object: {
        type: "MemberExpression",
        optional: true,
        computed: false,
        object: {
          type: "Identifier",
          name: "user"
        },
        property: {
          type: "Identifier",
          name: "profile"
        }
      },
      property: {
        type: "Identifier",
        name: "role"
      }
    });

    expect(parse("user?.[role](fallback)")).toMatchObject({
      type: "CallExpression",
      optional: false,
      callee: {
        type: "MemberExpression",
        optional: true,
        computed: true,
        object: {
          type: "Identifier",
          name: "user"
        },
        property: {
          type: "Identifier",
          name: "role"
        }
      },
      arguments: [
        {
          type: "Identifier",
          name: "fallback"
        }
      ]
    });

    expect(parse("service.api[method](user, ...extraArgs)")).toMatchObject({
      type: "CallExpression",
      optional: false,
      callee: {
        type: "MemberExpression",
        optional: false,
        computed: true,
        object: {
          type: "MemberExpression",
          optional: false,
          computed: false,
          object: {
            type: "Identifier",
            name: "service"
          },
          property: {
            type: "Identifier",
            name: "api"
          }
        },
        property: {
          type: "Identifier",
          name: "method"
        }
      },
      arguments: [
        {
          type: "Identifier",
          name: "user"
        },
        {
          type: "SpreadElement",
          argument: {
            type: "Identifier",
            name: "extraArgs"
          }
        }
      ]
    });

    expect(parse("service?.api?.[method]?.(...args, tail)")).toMatchObject({
      type: "CallExpression",
      optional: true,
      callee: {
        type: "MemberExpression",
        optional: true,
        computed: true,
        object: {
          type: "MemberExpression",
          optional: true,
          computed: false,
          object: {
            type: "Identifier",
            name: "service"
          },
          property: {
            type: "Identifier",
            name: "api"
          }
        },
        property: {
          type: "Identifier",
          name: "method"
        }
      },
      arguments: [
        {
          type: "SpreadElement",
          argument: {
            type: "Identifier",
            name: "args"
          }
        },
        {
          type: "Identifier",
          name: "tail"
        }
      ]
    });
  });

  it("parses arrow functions with concise expression bodies", () => {
    expect(parse("x => x")).toEqual({
      type: "ArrowFunctionExpression",
      async: false,
      expression: true,
      params: [
        {
          type: "Identifier",
          name: "x",
          span: {
            start: { line: 1, column: 1, offset: 0 },
            end: { line: 1, column: 2, offset: 1 }
          }
        }
      ],
      body: {
        type: "Identifier",
        name: "x",
        span: {
          start: { line: 1, column: 6, offset: 5 },
          end: { line: 1, column: 7, offset: 6 }
        }
      },
      span: {
        start: { line: 1, column: 1, offset: 0 },
        end: { line: 1, column: 7, offset: 6 }
      }
    });

    expect(parse("(x = 1, ...rest) => ({ value: x, rest })")).toMatchObject({
      type: "ArrowFunctionExpression",
      async: false,
      expression: true,
      params: [
        {
          type: "AssignmentPattern",
          left: {
            type: "Identifier",
            name: "x"
          },
          right: {
            type: "NumericLiteral",
            value: 1
          }
        },
        {
          type: "RestElement",
          argument: {
            type: "Identifier",
            name: "rest"
          }
        }
      ],
      body: {
        type: "ObjectExpression",
        properties: [
          {
            type: "Property",
            shorthand: false,
            key: {
              type: "Identifier",
              name: "value"
            },
            value: {
              type: "Identifier",
              name: "x"
            }
          },
          {
            type: "Property",
            shorthand: true,
            key: {
              type: "Identifier",
              name: "rest"
            },
            value: {
              type: "Identifier",
              name: "rest"
            }
          }
        ]
      }
    });

    expect(parse("({ value }, [first, second]) => first ?? value")).toMatchObject({
      type: "ArrowFunctionExpression",
      async: false,
      expression: true,
      params: [
        {
          type: "ObjectPattern",
          properties: [
            {
              type: "AssignmentProperty",
              shorthand: true,
              key: {
                type: "Identifier",
                name: "value"
              },
              value: {
                type: "Identifier",
                name: "value"
              }
            }
          ]
        },
        {
          type: "ArrayPattern",
          elements: [
            {
              type: "Identifier",
              name: "first"
            },
            {
              type: "Identifier",
              name: "second"
            }
          ]
        }
      ],
      body: {
        type: "LogicalExpression",
        operator: "??"
      }
    });
  });

  it("parses documented arrow function parameter and body edges", () => {
    expect(parse("() => 1")).toMatchObject({
      type: "ArrowFunctionExpression",
      async: false,
      expression: true,
      params: [],
      body: {
        type: "NumericLiteral",
        value: 1
      }
    });

    expect(parse("x => x")).toMatchObject({
      type: "ArrowFunctionExpression",
      async: false,
      params: [{ type: "Identifier", name: "x" }],
      body: { type: "Identifier", name: "x" }
    });

    expect(parse("(x) => x")).toMatchObject({
      type: "ArrowFunctionExpression",
      async: false,
      params: [{ type: "Identifier", name: "x" }],
      body: { type: "Identifier", name: "x" }
    });

    expect(parse("(x,) => x")).toMatchObject({
      type: "ArrowFunctionExpression",
      async: false,
      params: [{ type: "Identifier", name: "x" }],
      body: { type: "Identifier", name: "x" }
    });

    expect(parse("(x = 1) => x")).toMatchObject({
      type: "ArrowFunctionExpression",
      async: false,
      params: [
        {
          type: "AssignmentPattern",
          left: { type: "Identifier", name: "x" },
          right: { type: "NumericLiteral", value: 1 }
        }
      ],
      body: { type: "Identifier", name: "x" }
    });

    expect(parse("(...rest) => rest")).toMatchObject({
      type: "ArrowFunctionExpression",
      async: false,
      params: [{ type: "RestElement", argument: { type: "Identifier", name: "rest" } }],
      body: { type: "Identifier", name: "rest" }
    });

    expect(parse("(a, b, ...rest) => rest")).toMatchObject({
      type: "ArrowFunctionExpression",
      async: false,
      params: [
        { type: "Identifier", name: "a" },
        { type: "Identifier", name: "b" },
        { type: "RestElement", argument: { type: "Identifier", name: "rest" } }
      ],
      body: { type: "Identifier", name: "rest" }
    });

    expect(parse("({ a, b }) => a + b")).toMatchObject({
      type: "ArrowFunctionExpression",
      async: false,
      params: [
        {
          type: "ObjectPattern",
          properties: [
            { type: "AssignmentProperty", shorthand: true, key: { name: "a" } },
            { type: "AssignmentProperty", shorthand: true, key: { name: "b" } }
          ]
        }
      ],
      body: { type: "BinaryExpression", operator: "+" }
    });

    expect(parse("([a, b]) => a + b")).toMatchObject({
      type: "ArrowFunctionExpression",
      async: false,
      params: [
        {
          type: "ArrayPattern",
          elements: [
            { type: "Identifier", name: "a" },
            { type: "Identifier", name: "b" }
          ]
        }
      ],
      body: { type: "BinaryExpression", operator: "+" }
    });

    expect(parse("async (x) => x")).toMatchObject({
      type: "ArrowFunctionExpression",
      async: true,
      params: [{ type: "Identifier", name: "x" }],
      body: { type: "Identifier", name: "x" }
    });

    expect(parse("async x => x")).toMatchObject({
      type: "ArrowFunctionExpression",
      async: true,
      params: [{ type: "Identifier", name: "x" }],
      body: { type: "Identifier", name: "x" }
    });

    expect(parse("async => x")).toMatchObject({
      type: "ArrowFunctionExpression",
      async: false,
      params: [{ type: "Identifier", name: "async" }],
      body: { type: "Identifier", name: "x" }
    });

    expect(parse("() => {}")).toMatchObject({
      type: "ArrowFunctionExpression",
      async: false,
      expression: false,
      params: [],
      body: {
        type: "BlockStatement",
        body: []
      }
    });

    expect(parse("() => ({ a: 1 })")).toMatchObject({
      type: "ArrowFunctionExpression",
      async: false,
      expression: true,
      body: {
        type: "ObjectExpression",
        properties: [
          {
            type: "Property",
            key: { type: "Identifier", name: "a" },
            value: { type: "NumericLiteral", value: 1 }
          }
        ]
      }
    });

    expect(parse("() => { return; }")).toMatchObject({
      type: "ArrowFunctionExpression",
      async: false,
      expression: false,
      body: {
        type: "BlockStatement",
        body: [{ type: "ReturnStatement", argument: undefined }]
      }
    });
  });

  it("parses async arrow functions and block bodies", () => {
    expect(parse("async ({ value = 1 }, ...rest) => { return value + rest[0]; }")).toMatchObject({
      type: "ArrowFunctionExpression",
      async: true,
      expression: false,
      params: [
        {
          type: "ObjectPattern",
          properties: [
            {
              type: "AssignmentProperty",
              shorthand: true,
              key: {
                type: "Identifier",
                name: "value"
              },
              value: {
                type: "AssignmentPattern",
                left: {
                  type: "Identifier",
                  name: "value"
                },
                right: {
                  type: "NumericLiteral",
                  value: 1
                }
              }
            }
          ]
        },
        {
          type: "RestElement",
          argument: {
            type: "Identifier",
            name: "rest"
          }
        }
      ],
      body: {
        type: "BlockStatement",
        body: [
          {
            type: "ReturnStatement",
            argument: {
              type: "BinaryExpression",
              operator: "+",
              left: {
                type: "Identifier",
                name: "value"
              },
              right: {
                type: "MemberExpression",
                computed: true,
                object: {
                  type: "Identifier",
                  name: "rest"
                },
                property: {
                  type: "NumericLiteral",
                  value: 0
                }
              }
            }
          }
        ]
      }
    });
  });

  it("parses control-flow statements in block bodies", () => {
    expect(
      parse(
        "() => { if (ready) { return value; } else { while (pending) { continue; } } do { tick(); } while (pending); for (let index = 0; index < total; index = index + 1) work(index); for (const item of items) { break; } }"
      )
    ).toMatchObject({
      type: "ArrowFunctionExpression",
      async: false,
      expression: false,
      body: {
        type: "BlockStatement",
        body: [
          {
            type: "IfStatement",
            test: {
              type: "Identifier",
              name: "ready"
            },
            consequent: {
              type: "BlockStatement",
              body: [
                {
                  type: "ReturnStatement",
                  argument: {
                    type: "Identifier",
                    name: "value"
                  }
                }
              ]
            },
            alternate: {
              type: "BlockStatement",
              body: [
                {
                  type: "WhileStatement",
                  test: {
                    type: "Identifier",
                    name: "pending"
                  },
                  body: {
                    type: "BlockStatement",
                    body: [
                      {
                        type: "ContinueStatement"
                      }
                    ]
                  }
                }
              ]
            }
          },
          {
            type: "DoWhileStatement",
            body: {
              type: "BlockStatement",
              body: [
                {
                  type: "ExpressionStatement",
                  expression: {
                    type: "CallExpression"
                  }
                }
              ]
            },
            test: {
              type: "Identifier",
              name: "pending"
            }
          },
          {
            type: "ForStatement",
            init: {
              type: "VariableDeclaration",
              kind: "let"
            },
            test: {
              type: "BinaryExpression",
              operator: "<"
            },
            update: {
              type: "AssignmentExpression",
              operator: "="
            },
            body: {
              type: "ExpressionStatement",
              expression: {
                type: "CallExpression"
              }
            }
          },
          {
            type: "ForOfStatement",
            left: {
              type: "VariableDeclaration",
              kind: "const"
            },
            right: {
              type: "Identifier",
              name: "items"
            },
            body: {
              type: "BlockStatement",
              body: [
                {
                  type: "BreakStatement"
                }
              ]
            }
          }
        ]
      }
    });
  });

  it("parses statement edge cases users will hit in scripts", () => {
    expect(
      parse(
        "() => { if (ready) return; else return value; for (;;) { break; } for ({ item } of items) continue; }"
      )
    ).toMatchObject({
      type: "ArrowFunctionExpression",
      expression: false,
      body: {
        type: "BlockStatement",
        body: [
          {
            type: "IfStatement",
            consequent: {
              type: "ReturnStatement",
              argument: undefined
            },
            alternate: {
              type: "ReturnStatement",
              argument: {
                type: "Identifier",
                name: "value"
              }
            }
          },
          {
            type: "ForStatement",
            init: undefined,
            test: undefined,
            update: undefined,
            body: {
              type: "BlockStatement",
              body: [
                {
                  type: "BreakStatement"
                }
              ]
            }
          },
          {
            type: "ForOfStatement",
            left: {
              type: "ObjectPattern",
              properties: [
                {
                  type: "AssignmentProperty",
                  shorthand: true,
                  key: {
                    type: "Identifier",
                    name: "item"
                  },
                  value: {
                    type: "Identifier",
                    name: "item"
                  }
                }
              ]
            },
            right: {
              type: "Identifier",
              name: "items"
            },
            body: {
              type: "ContinueStatement"
            }
          }
        ]
      }
    });

    expect(parse("() => { outer: for (;;) { break outer; continue outer; } }")).toMatchObject({
      type: "ArrowFunctionExpression",
      body: {
        type: "BlockStatement",
        body: [
          {
            type: "ForStatement",
            label: "outer",
            body: {
              type: "BlockStatement",
              body: [
                {
                  type: "BreakStatement",
                  label: "outer"
                },
                {
                  type: "ContinueStatement",
                  label: "outer"
                }
              ]
            }
          }
        ]
      }
    });

    expect(
      parse("() => { outer: inner: for (;;) { break outer; continue inner; } }")
    ).toMatchObject({
      type: "ArrowFunctionExpression",
      body: {
        type: "BlockStatement",
        body: [
          {
            type: "ForStatement",
            label: "inner",
            labels: ["outer", "inner"],
            body: {
              type: "BlockStatement",
              body: [
                {
                  type: "BreakStatement",
                  label: "outer"
                },
                {
                  type: "ContinueStatement",
                  label: "inner"
                }
              ]
            }
          }
        ]
      }
    });

    expect(parse("() => { return\nvalue; }")).toMatchObject({
      type: "ArrowFunctionExpression",
      body: {
        type: "BlockStatement",
        body: [
          {
            type: "ReturnStatement",
            argument: undefined
          },
          {
            type: "ExpressionStatement",
            expression: {
              type: "Identifier",
              name: "value"
            }
          }
        ]
      }
    });
  });

  it("parses statement-level edge cases explicitly", () => {
    expect(parseModule(";;;")).toMatchObject({
      body: [{ type: "EmptyStatement" }, { type: "EmptyStatement" }, { type: "EmptyStatement" }]
    });

    expect(parseModule("for (;;) {}")).toMatchObject({
      body: [
        {
          type: "ForStatement",
          init: undefined,
          test: undefined,
          update: undefined,
          body: { type: "BlockStatement", body: [] }
        }
      ]
    });

    expect(parseModule("for (const x of arr) {}")).toMatchObject({
      body: [
        {
          type: "ForOfStatement",
          left: {
            type: "VariableDeclaration",
            kind: "const",
            declarations: [{ id: { type: "Identifier", name: "x" } }]
          },
          right: { type: "Identifier", name: "arr" },
          body: { type: "BlockStatement", body: [] }
        }
      ]
    });

    expect(parseModule("if (a) b; else c;")).toMatchObject({
      body: [
        {
          type: "IfStatement",
          consequent: { type: "ExpressionStatement", expression: { name: "b" } },
          alternate: { type: "ExpressionStatement", expression: { name: "c" } }
        }
      ]
    });

    expect(parseModule("if (a) if (b) c; else d;")).toMatchObject({
      body: [
        {
          type: "IfStatement",
          alternate: undefined,
          consequent: {
            type: "IfStatement",
            consequent: { type: "ExpressionStatement", expression: { name: "c" } },
            alternate: { type: "ExpressionStatement", expression: { name: "d" } }
          }
        }
      ]
    });

    expect(() => parseModule(createElseIfChain(3_000), "branches.ajs")).toThrow(ParseError);
    expect(() => parseModule(createElseIfChain(3_000), "branches.ajs")).toThrow(
      "If statement nesting limit exceeded"
    );

    expect(parseModule("try { a; } catch { b; }")).toMatchObject({
      body: [
        {
          type: "TryStatement",
          handler: {
            type: "CatchClause",
            param: undefined,
            body: { type: "BlockStatement", body: [{ type: "ExpressionStatement" }] }
          }
        }
      ]
    });

    expect(parseModule("try { a; } catch (e) { b; }")).toMatchObject({
      body: [
        {
          type: "TryStatement",
          handler: {
            type: "CatchClause",
            param: { type: "Identifier", name: "e" }
          }
        }
      ]
    });

    expect(parseModule("try { a; } finally { b; }")).toMatchObject({
      body: [
        {
          type: "TryStatement",
          handler: undefined,
          finalizer: { type: "BlockStatement", body: [{ type: "ExpressionStatement" }] }
        }
      ]
    });

    expect(parse("() => { return 1; }")).toMatchObject({
      type: "ArrowFunctionExpression",
      body: {
        type: "BlockStatement",
        body: [{ type: "ReturnStatement", argument: { type: "NumericLiteral", value: 1 } }]
      }
    });
  });

  it("parses try/catch, try/finally, and throw statements", () => {
    expect(parse("try { work(); } catch { throw error; }")).toMatchObject({
      type: "TryStatement",
      block: {
        type: "BlockStatement",
        body: [
          {
            type: "ExpressionStatement",
            expression: {
              type: "CallExpression",
              callee: {
                type: "Identifier",
                name: "work"
              }
            }
          }
        ]
      },
      handler: {
        type: "CatchClause",
        param: undefined,
        body: {
          type: "BlockStatement",
          body: [
            {
              type: "ThrowStatement",
              argument: {
                type: "Identifier",
                name: "error"
              }
            }
          ]
        }
      },
      finalizer: undefined
    });

    expect(parse("try { work(); } catch (e) { handle(e); }")).toMatchObject({
      type: "TryStatement",
      handler: {
        type: "CatchClause",
        param: {
          type: "Identifier",
          name: "e"
        },
        body: {
          type: "BlockStatement",
          body: [
            {
              type: "ExpressionStatement",
              expression: {
                type: "CallExpression",
                callee: {
                  type: "Identifier",
                  name: "handle"
                },
                arguments: [
                  {
                    type: "Identifier",
                    name: "e"
                  }
                ]
              }
            }
          ]
        }
      },
      finalizer: undefined
    });

    expect(parse("try { work(); } finally { cleanup(); }")).toMatchObject({
      type: "TryStatement",
      handler: undefined,
      finalizer: {
        type: "BlockStatement",
        body: [
          {
            type: "ExpressionStatement",
            expression: {
              type: "CallExpression",
              callee: {
                type: "Identifier",
                name: "cleanup"
              }
            }
          }
        ]
      }
    });
  });

  it("parses try/catch/finally with identifier and destructured catch bindings", () => {
    expect(parse("try { work(); } catch (e) { handle(e); } finally { cleanup(); }")).toMatchObject({
      type: "TryStatement",
      handler: {
        type: "CatchClause",
        param: {
          type: "Identifier",
          name: "e"
        }
      },
      finalizer: {
        type: "BlockStatement",
        body: [
          {
            type: "ExpressionStatement",
            expression: {
              type: "CallExpression",
              callee: {
                type: "Identifier",
                name: "cleanup"
              }
            }
          }
        ]
      }
    });

    expect(parse("try { work(); } catch ({ message }) { handle(message); }")).toMatchObject({
      type: "TryStatement",
      handler: {
        type: "CatchClause",
        param: {
          type: "ObjectPattern",
          properties: [
            {
              type: "AssignmentProperty",
              shorthand: true,
              key: {
                type: "Identifier",
                name: "message"
              },
              value: {
                type: "Identifier",
                name: "message"
              }
            }
          ]
        }
      }
    });

    expect(parse("try { work(); } catch ([error]) { handle(error); }")).toMatchObject({
      type: "TryStatement",
      handler: {
        type: "CatchClause",
        param: {
          type: "ArrayPattern",
          elements: [
            {
              type: "Identifier",
              name: "error"
            }
          ]
        }
      }
    });
  });

  it("parses destructuring in let/const declarations", () => {
    expect(
      parse(
        "const { [key]: renamed = 1, nested: { value }, list: [head, ...tail], ...rest } = source"
      )
    ).toMatchObject({
      type: "VariableDeclaration",
      kind: "const",
      declarations: [
        {
          type: "VariableDeclarator",
          id: {
            type: "ObjectPattern",
            properties: [
              {
                type: "AssignmentProperty",
                computed: true,
                key: {
                  type: "Identifier",
                  name: "key"
                },
                value: {
                  type: "AssignmentPattern",
                  left: {
                    type: "Identifier",
                    name: "renamed"
                  },
                  right: {
                    type: "NumericLiteral",
                    value: 1
                  }
                }
              },
              {
                type: "AssignmentProperty",
                computed: false,
                key: {
                  type: "Identifier",
                  name: "nested"
                },
                value: {
                  type: "ObjectPattern",
                  properties: [
                    {
                      type: "AssignmentProperty",
                      shorthand: true,
                      key: {
                        type: "Identifier",
                        name: "value"
                      },
                      value: {
                        type: "Identifier",
                        name: "value"
                      }
                    }
                  ]
                }
              },
              {
                type: "AssignmentProperty",
                computed: false,
                key: {
                  type: "Identifier",
                  name: "list"
                },
                value: {
                  type: "ArrayPattern",
                  elements: [
                    {
                      type: "Identifier",
                      name: "head"
                    },
                    {
                      type: "RestElement",
                      argument: {
                        type: "Identifier",
                        name: "tail"
                      }
                    }
                  ]
                }
              },
              {
                type: "RestElement",
                argument: {
                  type: "Identifier",
                  name: "rest"
                }
              }
            ]
          },
          init: {
            type: "Identifier",
            name: "source"
          }
        }
      ]
    });
  });

  it("parses import.meta as a standard expression", () => {
    expect(parse("import.meta")).toMatchObject({
      type: "MetaProperty",
      meta: {
        type: "Identifier",
        name: "import"
      },
      property: {
        type: "Identifier",
        name: "meta"
      }
    });

    expect(parse("import.meta.body")).toMatchObject({
      type: "MemberExpression",
      object: {
        type: "MetaProperty"
      },
      property: {
        type: "Identifier",
        name: "body"
      }
    });

    expect(parse("const { body } = import.meta")).toMatchObject({
      type: "VariableDeclaration",
      declarations: [
        {
          id: {
            type: "ObjectPattern"
          },
          init: {
            type: "MetaProperty"
          }
        }
      ]
    });

    expect(parseModule("const m = import.meta; m.body")).toMatchObject({
      type: "Module",
      body: [
        {
          type: "VariableDeclaration",
          declarations: [
            {
              init: {
                type: "MetaProperty"
              }
            }
          ]
        },
        {
          type: "ExpressionStatement",
          expression: {
            type: "MemberExpression",
            object: {
              type: "Identifier",
              name: "m"
            },
            property: {
              type: "Identifier",
              name: "body"
            }
          }
        }
      ]
    });

    expect(parse("import.meta()")).toMatchObject({
      type: "CallExpression",
      callee: {
        type: "MetaProperty"
      }
    });
  });

  it.each([
    "+=",
    "-=",
    "*=",
    "/=",
    "%=",
    "**=",
    "&=",
    "|=",
    "^=",
    "<<=",
    ">>=",
    ">>>=",
    "&&=",
    "||=",
    "??="
  ])("parses assignment operator %s", (operator) => {
    expect(parse(`x ${operator} 1`)).toMatchObject({
      type: "AssignmentExpression",
      operator,
      left: {
        type: "Identifier",
        name: "x"
      },
      right: {
        type: "NumericLiteral",
        value: 1
      }
    });
  });

  it("parses array pattern elisions across declarations, params, and assignments", () => {
    expect(parse("const [, second = fallback, ...rest] = values")).toMatchObject({
      type: "VariableDeclaration",
      declarations: [
        {
          id: {
            type: "ArrayPattern",
            elements: [
              null,
              {
                type: "AssignmentPattern",
                left: {
                  type: "Identifier",
                  name: "second"
                },
                right: {
                  type: "Identifier",
                  name: "fallback"
                }
              },
              {
                type: "RestElement",
                argument: {
                  type: "Identifier",
                  name: "rest"
                }
              }
            ]
          }
        }
      ]
    });

    expect(parse("([, second = fallback, ...rest]) => second")).toMatchObject({
      type: "ArrowFunctionExpression",
      params: [
        {
          type: "ArrayPattern",
          elements: [
            null,
            {
              type: "AssignmentPattern",
              left: {
                type: "Identifier",
                name: "second"
              },
              right: {
                type: "Identifier",
                name: "fallback"
              }
            },
            {
              type: "RestElement",
              argument: {
                type: "Identifier",
                name: "rest"
              }
            }
          ]
        }
      ]
    });

    expect(parse("([, second = fallback, ...rest] = values)")).toMatchObject({
      type: "AssignmentExpression",
      left: {
        type: "ArrayPattern",
        elements: [
          null,
          {
            type: "AssignmentPattern",
            left: {
              type: "Identifier",
              name: "second"
            },
            right: {
              type: "Identifier",
              name: "fallback"
            }
          },
          {
            type: "RestElement",
            argument: {
              type: "Identifier",
              name: "rest"
            }
          }
        ]
      },
      right: {
        type: "Identifier",
        name: "values"
      }
    });
  });

  it("parses destructuring declaration edge cases", () => {
    expect(parse("const {} = obj;")).toMatchObject({
      type: "VariableDeclaration",
      declarations: [
        {
          id: {
            type: "ObjectPattern",
            properties: []
          },
          init: {
            type: "Identifier",
            name: "obj"
          }
        }
      ]
    });

    expect(parse("const [] = arr;")).toMatchObject({
      type: "VariableDeclaration",
      declarations: [
        {
          id: {
            type: "ArrayPattern",
            elements: []
          },
          init: {
            type: "Identifier",
            name: "arr"
          }
        }
      ]
    });

    expect(parse("const [a, , c] = arr;")).toMatchObject({
      type: "VariableDeclaration",
      declarations: [
        {
          id: {
            type: "ArrayPattern",
            elements: [
              {
                type: "Identifier",
                name: "a"
              },
              null,
              {
                type: "Identifier",
                name: "c"
              }
            ]
          }
        }
      ]
    });

    expect(parse("const [, , c] = arr;")).toMatchObject({
      type: "VariableDeclaration",
      declarations: [
        {
          id: {
            type: "ArrayPattern",
            elements: [
              null,
              null,
              {
                type: "Identifier",
                name: "c"
              }
            ]
          }
        }
      ]
    });

    expect(parse("const { a: { b: { c } } } = x;")).toMatchObject({
      type: "VariableDeclaration",
      declarations: [
        {
          id: {
            type: "ObjectPattern",
            properties: [
              {
                type: "AssignmentProperty",
                key: {
                  type: "Identifier",
                  name: "a"
                },
                value: {
                  type: "ObjectPattern",
                  properties: [
                    {
                      type: "AssignmentProperty",
                      key: {
                        type: "Identifier",
                        name: "b"
                      },
                      value: {
                        type: "ObjectPattern",
                        properties: [
                          {
                            type: "AssignmentProperty",
                            key: {
                              type: "Identifier",
                              name: "c"
                            },
                            value: {
                              type: "Identifier",
                              name: "c"
                            }
                          }
                        ]
                      }
                    }
                  ]
                }
              }
            ]
          }
        }
      ]
    });

    expect(parse("const { [key]: value } = obj;")).toMatchObject({
      type: "VariableDeclaration",
      declarations: [
        {
          id: {
            type: "ObjectPattern",
            properties: [
              {
                type: "AssignmentProperty",
                computed: true,
                key: {
                  type: "Identifier",
                  name: "key"
                },
                value: {
                  type: "Identifier",
                  name: "value"
                }
              }
            ]
          }
        }
      ]
    });

    expect(parse("const { [a + b]: value } = obj;")).toMatchObject({
      type: "VariableDeclaration",
      declarations: [
        {
          id: {
            type: "ObjectPattern",
            properties: [
              {
                type: "AssignmentProperty",
                computed: true,
                key: {
                  type: "BinaryExpression",
                  operator: "+",
                  left: {
                    type: "Identifier",
                    name: "a"
                  },
                  right: {
                    type: "Identifier",
                    name: "b"
                  }
                },
                value: {
                  type: "Identifier",
                  name: "value"
                }
              }
            ]
          }
        }
      ]
    });

    expect(parse("const { a = 1, b = a } = obj;")).toMatchObject({
      type: "VariableDeclaration",
      declarations: [
        {
          id: {
            type: "ObjectPattern",
            properties: [
              {
                type: "AssignmentProperty",
                value: {
                  type: "AssignmentPattern",
                  left: {
                    type: "Identifier",
                    name: "a"
                  },
                  right: {
                    type: "NumericLiteral",
                    value: 1
                  }
                }
              },
              {
                type: "AssignmentProperty",
                value: {
                  type: "AssignmentPattern",
                  left: {
                    type: "Identifier",
                    name: "b"
                  },
                  right: {
                    type: "Identifier",
                    name: "a"
                  }
                }
              }
            ]
          }
        }
      ]
    });

    expect(parse("const { a: { b } = {} } = obj;")).toMatchObject({
      type: "VariableDeclaration",
      declarations: [
        {
          id: {
            type: "ObjectPattern",
            properties: [
              {
                type: "AssignmentProperty",
                key: {
                  type: "Identifier",
                  name: "a"
                },
                value: {
                  type: "AssignmentPattern",
                  left: {
                    type: "ObjectPattern",
                    properties: [
                      {
                        type: "AssignmentProperty",
                        key: {
                          type: "Identifier",
                          name: "b"
                        },
                        value: {
                          type: "Identifier",
                          name: "b"
                        }
                      }
                    ]
                  },
                  right: {
                    type: "ObjectExpression",
                    properties: []
                  }
                }
              }
            ]
          }
        }
      ]
    });

    expect(parse("const [a = 1, b = 2] = arr;")).toMatchObject({
      type: "VariableDeclaration",
      declarations: [
        {
          id: {
            type: "ArrayPattern",
            elements: [
              {
                type: "AssignmentPattern",
                left: {
                  type: "Identifier",
                  name: "a"
                },
                right: {
                  type: "NumericLiteral",
                  value: 1
                }
              },
              {
                type: "AssignmentPattern",
                left: {
                  type: "Identifier",
                  name: "b"
                },
                right: {
                  type: "NumericLiteral",
                  value: 2
                }
              }
            ]
          }
        }
      ]
    });

    expect(parse("const { 0: first, 1: second } = arr;")).toMatchObject({
      type: "VariableDeclaration",
      declarations: [
        {
          id: {
            type: "ObjectPattern",
            properties: [
              {
                type: "AssignmentProperty",
                key: {
                  type: "NumericLiteral",
                  value: 0
                },
                value: {
                  type: "Identifier",
                  name: "first"
                }
              },
              {
                type: "AssignmentProperty",
                key: {
                  type: "NumericLiteral",
                  value: 1
                },
                value: {
                  type: "Identifier",
                  name: "second"
                }
              }
            ]
          }
        }
      ]
    });
  });

  it("rejects invalid destructuring rest placement with clear spans", () => {
    expect(() => parse("const { a, ...rest, b } = obj;")).toThrowError(
      "Rest element must be the last property in an object pattern at line 1, column 19."
    );
    expect(() => parse("const { ...a, ...b } = obj;")).toThrowError(
      "Object pattern can contain only one rest element at line 1, column 15."
    );
    expect(() => parse("const [...rest, last] = arr;")).toThrowError(
      "Rest element must be the last element in an array pattern at line 1, column 15."
    );
  });

  it("parses destructuring assignment targets", () => {
    expect(parse("({ a } = obj);")).toMatchObject({
      type: "AssignmentExpression",
      operator: "=",
      left: {
        type: "ObjectPattern",
        properties: [
          {
            type: "AssignmentProperty",
            key: {
              type: "Identifier",
              name: "a"
            },
            value: {
              type: "Identifier",
              name: "a"
            }
          }
        ]
      },
      right: {
        type: "Identifier",
        name: "obj"
      }
    });

    expect(
      parse("({ [key]: renamed = 1, nested: { value }, list: [head, ...tail], ...rest } = source)")
    ).toMatchObject({
      type: "AssignmentExpression",
      operator: "=",
      left: {
        type: "ObjectPattern",
        properties: [
          {
            type: "AssignmentProperty",
            computed: true,
            key: {
              type: "Identifier",
              name: "key"
            },
            value: {
              type: "AssignmentPattern",
              left: {
                type: "Identifier",
                name: "renamed"
              },
              right: {
                type: "NumericLiteral",
                value: 1
              }
            }
          },
          {
            type: "AssignmentProperty",
            computed: false,
            key: {
              type: "Identifier",
              name: "nested"
            },
            value: {
              type: "ObjectPattern"
            }
          },
          {
            type: "AssignmentProperty",
            computed: false,
            key: {
              type: "Identifier",
              name: "list"
            },
            value: {
              type: "ArrayPattern"
            }
          },
          {
            type: "RestElement",
            argument: {
              type: "Identifier",
              name: "rest"
            }
          }
        ]
      },
      right: {
        type: "Identifier",
        name: "source"
      }
    });
  });

  it("parses empty parameter lists and trailing commas before the arrow", () => {
    expect(parse("() => 1")).toMatchObject({
      type: "ArrowFunctionExpression",
      async: false,
      expression: true,
      params: [],
      body: {
        type: "NumericLiteral",
        value: 1
      }
    });

    expect(parse("(value,) => value")).toMatchObject({
      type: "ArrowFunctionExpression",
      async: false,
      expression: true,
      params: [
        {
          type: "Identifier",
          name: "value"
        }
      ],
      body: {
        type: "Identifier",
        name: "value"
      }
    });
  });

  it("rejects invalid arrow parameter edge cases", () => {
    expect(() => parse("(...rest, value) => value")).toThrowError(
      "Rest element must be the last parameter at line 1, column 9."
    );
    expect(() => parse("(...rest,) => rest")).toThrowError(
      "Unexpected token ',' at line 1, column 9."
    );
    expect(() => parse("([head, ...tail, last]) => last")).toThrowError(
      "Rest element must be the last element in an array pattern at line 1, column 16."
    );
    expect(() => parse("({ ...rest, value }) => value")).toThrowError(
      "Rest element must be the last property in an object pattern at line 1, column 11."
    );
    expect(() => parse("({ ...{ value } }) => value")).toThrowError(
      "Object rest element must bind to an identifier at line 1, column 7."
    );
    expect(parse("({ [key + suffix]: value }) => value")).toMatchObject({
      type: "ArrowFunctionExpression",
      params: [
        {
          type: "ObjectPattern",
          properties: [
            {
              type: "AssignmentProperty",
              computed: true,
              key: {
                type: "BinaryExpression",
                operator: "+"
              }
            }
          ]
        }
      ]
    });
    expect(() => parse("x\n=> x")).toThrowError(
      "Unexpected line break before '=>' at line 2, column 1."
    );
    expect(() => parse("(x)\n=> x")).toThrowError(
      "Unexpected line break before '=>' at line 2, column 1."
    );
    expect(() => parse("async\n(x) => x")).toThrowError(
      "Unexpected line break after 'async' at line 2, column 1."
    );
  });

  it("parses bare-specifier import declarations", () => {
    expect(parse('import { x } from "name"')).toMatchObject({
      type: "ImportDeclaration",
      specifiers: [
        {
          type: "ImportSpecifier",
          imported: {
            type: "Identifier",
            name: "x"
          },
          local: {
            type: "Identifier",
            name: "x"
          }
        }
      ],
      source: {
        type: "StringLiteral",
        value: "name"
      }
    });

    expect(parse('import { x as y } from "name"')).toMatchObject({
      type: "ImportDeclaration",
      specifiers: [
        {
          type: "ImportSpecifier",
          imported: {
            type: "Identifier",
            name: "x"
          },
          local: {
            type: "Identifier",
            name: "y"
          }
        }
      ],
      source: {
        type: "StringLiteral",
        value: "name"
      }
    });

    expect(
      parse('import { default as fallback, from as source, x as y, z, } from "name"')
    ).toMatchObject({
      type: "ImportDeclaration",
      specifiers: [
        {
          type: "ImportSpecifier",
          imported: {
            type: "Identifier",
            name: "default"
          },
          local: {
            type: "Identifier",
            name: "fallback"
          }
        },
        {
          type: "ImportSpecifier",
          imported: {
            type: "Identifier",
            name: "from"
          },
          local: {
            type: "Identifier",
            name: "source"
          }
        },
        {
          type: "ImportSpecifier",
          imported: {
            type: "Identifier",
            name: "x"
          },
          local: {
            type: "Identifier",
            name: "y"
          }
        },
        {
          type: "ImportSpecifier",
          imported: {
            type: "Identifier",
            name: "z"
          },
          local: {
            type: "Identifier",
            name: "z"
          }
        }
      ],
      source: {
        type: "StringLiteral",
        value: "name"
      }
    });

    expect(parse('import x from "name"')).toMatchObject({
      type: "ImportDeclaration",
      specifiers: [
        {
          type: "ImportDefaultSpecifier",
          local: {
            type: "Identifier",
            name: "x"
          }
        }
      ],
      source: {
        type: "StringLiteral",
        value: "name"
      }
    });

    expect(parse('import * as ns from "name"')).toMatchObject({
      type: "ImportDeclaration",
      specifiers: [
        {
          type: "ImportNamespaceSpecifier",
          local: {
            type: "Identifier",
            name: "ns"
          }
        }
      ],
      source: {
        type: "StringLiteral",
        value: "name"
      }
    });

    expect(parse('import { x } from "name";')).toMatchObject({
      type: "ImportDeclaration",
      specifiers: [
        {
          type: "ImportSpecifier",
          imported: {
            type: "Identifier",
            name: "x"
          },
          local: {
            type: "Identifier",
            name: "x"
          }
        }
      ],
      source: {
        type: "StringLiteral",
        value: "name"
      }
    });

    expect(parse('import { x } from "pulls.reviews"')).toMatchObject({
      type: "ImportDeclaration",
      source: {
        type: "StringLiteral",
        value: "pulls.reviews"
      }
    });
  });

  it("rejects non-bare import specifiers with the bad value in the message", () => {
    expect(() => parse('import { x } from "./name"')).toThrowError(
      "Invalid import specifier './name' at line 1, column 19."
    );
    expect(() => parse('import { x } from "../name"')).toThrowError(
      "Invalid import specifier '../name' at line 1, column 19."
    );
    expect(() => parse('import { x } from "https://example.com/mod"')).toThrowError(
      "Invalid import specifier 'https://example.com/mod' at line 1, column 19."
    );
    expect(() => parse('import { x } from "node:fs"')).toThrowError(
      "Invalid import specifier 'node:fs' at line 1, column 19."
    );
    expect(() => parse('import { x } from "name.js"')).toThrowError(
      "Invalid import specifier 'name.js' at line 1, column 19."
    );
    expect(() => parse('import x from "pkg/name"')).toThrowError(
      "Invalid import specifier 'pkg/name' at line 1, column 15."
    );
    expect(() => parse('import * as ns from "name:subpath"')).toThrowError(
      "Invalid import specifier 'name:subpath' at line 1, column 21."
    );
  });

  it("rejects unsupported or malformed import clauses", () => {
    expect(() => parse('import {} from "name"')).toThrowError(
      "Unexpected token '}' at line 1, column 9."
    );
    expect(() => parse('import { x as } from "name"')).toThrowError(
      "Unexpected token '}' at line 1, column 15."
    );
    expect(() => parse('import { x as return } from "name"')).toThrowError(
      "Unexpected token 'return' at line 1, column 15."
    );
    expect(() => parse('import * from "name"')).toThrowError("Expected 'as' at line 1, column 10.");
    expect(() => parse('import x, { y } from "name"')).toThrowError(
      "Expected 'from' at line 1, column 9."
    );
  });

  it("parses expression computed property sources in declarations and assignments", () => {
    expect(parse("const { [key + suffix]: value } = source")).toMatchObject({
      type: "VariableDeclaration",
      declarations: [
        {
          id: {
            type: "ObjectPattern",
            properties: [
              {
                type: "AssignmentProperty",
                computed: true,
                key: {
                  type: "BinaryExpression",
                  operator: "+"
                }
              }
            ]
          }
        }
      ]
    });
    expect(parse("({ [key + suffix]: value } = source)")).toMatchObject({
      type: "AssignmentExpression",
      left: {
        type: "ObjectPattern",
        properties: [
          {
            type: "AssignmentProperty",
            computed: true,
            key: {
              type: "BinaryExpression",
              operator: "+"
            }
          }
        ]
      }
    });
  });

  it("keeps unsupported function syntaxes rejected", () => {
    expect(() => parse("function (value) { return value; }")).toThrowError(
      "Unexpected token '(' at line 1, column 10."
    );
    expect(() => parse("*value => value")).toThrowError(
      "Unexpected token '*' at line 1, column 1."
    );
    expect(() => parse("({ method() {} }) => method")).toThrowError(
      "Expected '}' at line 1, column 10."
    );
  });

  it("rejects nullish coalescing mixed with logical operators without parentheses", () => {
    expect(() => parse("a ?? b && c")).toThrowError(
      "Cannot mix '??' with '&&' or '||' without parentheses"
    );

    expect(() => parse("a || b ?? c")).toThrowError(
      "Cannot mix '??' with '&&' or '||' without parentheses"
    );

    expect(() => parse("a && b ?? c")).toThrowError(
      "Cannot mix '??' with '&&' or '||' without parentheses"
    );
  });

  it("accepts parenthesized nullish and exponentiation edge cases", () => {
    expect(parse("a ?? (b && c)")).toMatchObject({
      type: "LogicalExpression",
      operator: "??",
      left: {
        type: "Identifier",
        name: "a"
      },
      right: {
        type: "LogicalExpression",
        operator: "&&",
        left: {
          type: "Identifier",
          name: "b"
        },
        right: {
          type: "Identifier",
          name: "c"
        }
      }
    });

    expect(parse("(-a) ** b")).toMatchObject({
      type: "BinaryExpression",
      operator: "**",
      left: {
        type: "UnaryExpression",
        operator: "-",
        argument: {
          type: "Identifier",
          name: "a"
        }
      },
      right: {
        type: "Identifier",
        name: "b"
      }
    });

    expect(() => parse("-a ** b")).toThrowError(
      "Unary expressions cannot be used as the left-hand side of '**' without parentheses at line 1, column 4."
    );

    expect(parse("a && (b ?? c)")).toMatchObject({
      type: "LogicalExpression",
      operator: "&&",
      left: {
        type: "Identifier",
        name: "a"
      },
      right: {
        type: "LogicalExpression",
        operator: "??",
        left: {
          type: "Identifier",
          name: "b"
        },
        right: {
          type: "Identifier",
          name: "c"
        }
      }
    });

    expect(parse("a ? b ?? c : d && e")).toMatchObject({
      type: "ConditionalExpression",
      test: {
        type: "Identifier",
        name: "a"
      },
      consequent: {
        type: "LogicalExpression",
        operator: "??",
        left: {
          type: "Identifier",
          name: "b"
        },
        right: {
          type: "Identifier",
          name: "c"
        }
      },
      alternate: {
        type: "LogicalExpression",
        operator: "&&",
        left: {
          type: "Identifier",
          name: "d"
        },
        right: {
          type: "Identifier",
          name: "e"
        }
      }
    });
  });

  it("rejects regex literals with a parse-time error", () => {
    expect(() => parse("/foo/")).toThrowError(
      "Regular expression literals are not supported at line 1, column 1."
    );

    expect(() => parse("{ value: /foo/ }")).toThrowError(
      "Regular expression literals are not supported at line 1, column 10."
    );

    expect(() => parse("`${/foo/}`")).toThrowError(
      "Regular expression literals are not supported at line 1, column 4."
    );
  });

  it("locates invalid regex flags in parser diagnostics", () => {
    expect(() => parseModule("const pattern = /a/u;")).toThrowError(
      "Unsupported regex flag 'u' at line 1, column 20."
    );
  });

  it("parses new expressions with identifier and member callees", () => {
    expect(parse("+new Date")).toMatchObject({
      type: "UnaryExpression", operator: "+", argument: {
        type: "NewExpression", arguments: [], callee: { type: "Identifier", name: "Date" }
      }
    });
    expect(parse("new services.Service")).toMatchObject({
      type: "NewExpression", arguments: [], callee: { type: "MemberExpression" }
    });
    expect(() => parse("new Service?.()")).toThrow();
    expect(parse("new Service(1)")).toMatchObject({
      type: "NewExpression",
      callee: { type: "Identifier", name: "Service" },
      arguments: [{ type: "NumericLiteral", value: 1 }]
    });

    expect(parse("new services.Service()")).toMatchObject({
      type: "NewExpression",
      callee: {
        type: "MemberExpression",
        object: { type: "Identifier", name: "services" },
        property: { type: "Identifier", name: "Service" }
      },
      arguments: []
    });

    expect(() => parse("new.target")).toThrowError(DisallowedSyntaxError);

    expect(parse("service.this")).toMatchObject({
      type: "MemberExpression",
      object: {
        type: "Identifier",
        name: "service"
      },
      property: {
        type: "Identifier",
        name: "this"
      }
    });
  });

  it("parses this as a dedicated expression node", () => {
    expect(parse("this")).toMatchObject({
      type: "ThisExpression"
    });

    expect(parse("this.value")).toMatchObject({
      type: "MemberExpression",
      object: {
        type: "ThisExpression"
      },
      property: {
        type: "Identifier",
        name: "value"
      }
    });

    expect(parse("`${this}`")).toMatchObject({
      type: "TemplateLiteral",
      expressions: [
        {
          type: "ThisExpression"
        }
      ]
    });
  });

  it("rejects assignments to import.meta and its properties", () => {
    expect(() => parse("import.meta = x")).toThrowError(DisallowedSyntaxError);
    expect(() => parse("import.meta.x = 1")).toThrowError(DisallowedSyntaxError);
    expect(() => parse("[import.meta] = [x]")).toThrowError(DisallowedSyntaxError);
  });

  it("rejects assignments to import.meta through parenthesized, computed, and nested targets", () => {
    expect(() => parse("(import.meta) = x")).toThrowError(DisallowedSyntaxError);
    expect(() => parse("(import.meta.x) = 1")).toThrowError(DisallowedSyntaxError);
    expect(() => parse("import.meta[key] = 1")).toThrowError(DisallowedSyntaxError);
    expect(() => parse("[import.meta.x] = [x]")).toThrowError(DisallowedSyntaxError);
    expect(() => parse("({ body: import.meta } = x)")).toThrowError(DisallowedSyntaxError);
    expect(() => parse("for (import.meta of xs) {}")).toThrowError(DisallowedSyntaxError);
  });

  it("rejects disallowed statement syntax", () => {
    expect(
      parse("() => { switch (value) { case 1: break; default: return value; } }")
    ).toMatchObject({
      expression: false,
      body: {
        body: [{ type: "SwitchStatement" }]
      }
    });

    expect(parse("() => { for (item in items) work(item); }")).toMatchObject({
      expression: false,
      body: {
        body: [{ type: "ForInStatement", left: { type: "Identifier", name: "item" } }]
      }
    });

    expect(() => parse("() => { label: work(); }")).toThrowError(DisallowedSyntaxError);
    expect(() => parse("() => { label: work(); }")).toThrowError(
      "Disallowed syntax 'label' at line 1, column 9."
    );

    expect(parseModule("for (const x in obj) {}")).toMatchObject({
      body: [
        {
          type: "ForInStatement",
          left: {
            type: "VariableDeclaration",
            kind: "const",
            declarations: [{ id: { type: "Identifier", name: "x" } }]
          },
          right: { type: "Identifier", name: "obj" }
        }
      ]
    });

    expect(() => parseModule("for (const [key] in obj) {}")).toThrowError(
      "for...in keys are strings; destructure inside the body"
    );
    expect(() => parseModule("for ({ key } in obj) {}")).toThrowError(
      "for...in keys are strings; destructure inside the body"
    );

    expect(() => parseModule("break;")).toThrowError(
      "Illegal break statement outside a loop or switch at line 1, column 1."
    );
    expect(() => parseModule("continue;")).toThrowError(
      "Illegal continue statement outside a loop at line 1, column 1."
    );

    expect(() => parseModule("return;")).toThrowError(
      "Top-level return statements must return a value at line 1, column 1."
    );

    expect(() => parseModule("}")).toThrowError("Unexpected token '}' at line 1, column 1.");

    expect(() => parseModule("const a = 1; const a = 2;")).toThrowError(
      "Cannot redeclare binding 'a' at line 1, column 20."
    );

    expect(() => parseModule("{ a;")).toThrowError("Unterminated block at line 1, column 1.");
  });

  it("rejects invalid try/catch/finally forms and invalid throw statements", () => {
    expect(() => parse("try { work(); }")).toThrowError("Expected 'catch' or 'finally'");
    expect(() => parse("try { work(); } catch () { cleanup(); }")).toThrowError(
      "Unexpected token ')'"
    );
    expect(() => parse("try { work(); } catch (error = fallback) { cleanup(); }")).toThrowError(
      "Expected ')'"
    );
    expect(() => parse("throw;")).toThrowError("Unexpected token ';'");
    expect(() => parse("throw\nerror;")).toThrowError("Illegal newline after throw");
  });

  it("rethrows generic parser failures as structured parse diagnostics", () => {
    try {
      parse(
        ["() => {", "  const alpha = 1;", "  const beta = );", "  const delta = 4;", "}"].join(
          "\n"
        ),
        "flow.agent.ts"
      );
      throw new Error("Expected parse to fail.");
    } catch (error) {
      expect(error).toMatchObject({
        kind: "ParseError",
        filename: "flow.agent.ts",
        line: 3,
        column: 16,
        message: "Unexpected token ')' at line 3, column 16.",
        excerpt: [
          "1 | () => {",
          "2 |   const alpha = 1;",
          "3 |   const beta = );",
          "4 |   const delta = 4;"
        ].join("\n"),
        caret: "  |                ^"
      });
    }
  });

  it("formats parser diagnostics at file boundaries and keeps tab-aligned carets", () => {
    try {
      parse(
        [
          "() => {",
          "  step1();",
          "  step2();",
          "  step3();",
          "  step4();",
          "  step5();",
          "  step6();",
          "  step7();",
          "  step8();",
          "\t\tvalue = );",
          "}"
        ].join("\n"),
        "flow.agent.ts"
      );
      throw new Error("Expected parse to fail.");
    } catch (error) {
      expect(error).toMatchObject({
        kind: "ParseError",
        filename: "flow.agent.ts",
        line: 10,
        column: 11,
        excerpt: [" 8 |   step7();", " 9 |   step8();", "10 | \t\tvalue = );", "11 | }"].join("\n"),
        caret: "   | \t\t        ^"
      });
    }

    try {
      parse("throw", "flow.agent.ts");
      throw new Error("Expected parse to fail.");
    } catch (error) {
      expect(error).toMatchObject({
        kind: "ParseError",
        filename: "flow.agent.ts",
        line: 1,
        column: 6,
        excerpt: "1 | throw",
        caret: "  |      ^"
      });
    }
  });

  it("parses sync and async function declarations", () => {
    expect(parse("function add(value = 1, ...rest) { return value + rest.length; }")).toMatchObject(
      {
        type: "FunctionDeclaration",
        async: false,
        generator: false,
        id: {
          type: "Identifier",
          name: "add"
        },
        params: [
          {
            type: "AssignmentPattern",
            left: {
              type: "Identifier",
              name: "value"
            }
          },
          {
            type: "RestElement",
            argument: {
              type: "Identifier",
              name: "rest"
            }
          }
        ],
        body: {
          type: "BlockStatement"
        }
      }
    );

    expect(parse("async function load() { return await task(); }")).toMatchObject({
      type: "FunctionDeclaration",
      async: true,
      generator: false,
      id: {
        name: "load"
      }
    });
  });

  it("parses anonymous and named function expressions", () => {
    expect(parse("const f = function () {};")).toMatchObject({
      type: "VariableDeclaration",
      declarations: [
        {
          init: {
            type: "FunctionExpression",
            async: false,
            generator: false,
            id: undefined,
            params: [],
            body: { type: "BlockStatement" }
          }
        }
      ]
    });

    expect(parse("const f = async function check(n) { return check(n - 1); };")).toMatchObject({
      declarations: [
        {
          init: {
            type: "FunctionExpression",
            async: true,
            generator: false,
            id: { type: "Identifier", name: "check" },
            params: [{ type: "Identifier", name: "n" }]
          }
        }
      ]
    });
  });

  it("rejects duplicate function declarations in one scope", () => {
    expect(() => parse("if (true) { function work() {} function work() {} }")).toThrowError(
      "Cannot redeclare binding 'work'"
    );
  });

  it("parses sync generator declarations and rejects async generators", () => {
    expect(parse("function* values() {}")).toMatchObject({
      type: "FunctionDeclaration",
      async: false,
      generator: true
    });
    expect(() => parse("async function* values() {}")).toThrowError(
      "async function* is not supported"
    );
  });

  it("does not treat async followed by a line break as an async function declaration", () => {
    expect(() => parse("async\nfunction load() {}")).toThrow();
  });
  it("parses var declarations in statements and loops", () => {
    expect(parse("var value = 1")).toMatchObject({
      type: "VariableDeclaration",
      kind: "var"
    });
    expect(parse("for (var index = 0; index < 1; index++) {}")).toMatchObject({
      type: "ForStatement",
      init: {
        type: "VariableDeclaration",
        kind: "var"
      }
    });
  });
});

function createNestedConditionalModule(depth: number): string {
  let expression = "0";
  for (let index = 0; index < depth; index += 1) {
    expression = `a ? 0 : (${expression})`;
  }
  return `function validate() { return ${expression}; }`;
}

function createElseIfChain(depth: number): string {
  let source = "";
  for (let index = 0; index < depth; index += 1) {
    source += `if (0) { return ${index}; } else `;
  }
  return `${source}{ return ""; }`;
}
