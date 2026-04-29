import { describe, expect, it } from "vitest";

import { parse } from "../parse.js";

describe("parse", () => {
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
});
