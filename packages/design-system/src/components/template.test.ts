import { describe, expect, it } from "vitest";
import Mustache from "mustache";
import { renderTemplate } from "./template.js";

describe("renderTemplate", () => {
  const parityCases: Array<{
    name: string;
    template: string;
    view: Record<string, unknown>;
  }> = [
    {
      name: "escapes interpolation by default",
      template: "Hello {{name}}",
      view: { name: "<K>" }
    },
    {
      name: "renders unescaped interpolation",
      template: "{{{name}}} {{&name}}",
      view: { name: "<K>" }
    },
    {
      name: "strips comments",
      template: "a{{! hidden\nstill hidden }}b",
      view: {}
    },
    {
      name: "resolves dotted paths and missing values",
      template: "{{user.name}} {{user.missing.value}}",
      view: { user: { name: "K" } }
    },
    {
      name: "uses the implicit iterator",
      template: "{{#items}}[{{.}}]{{/items}}",
      view: { items: ["a", "b"] }
    },
    {
      name: "pushes object section scope with parent fallback",
      template: "{{#user}}{{name}}/{{site}}{{/user}}",
      view: { site: "poe", user: { name: "K" } }
    },
    {
      name: "renders truthy and inverted sections",
      template: "{{#ok}}yes{{/ok}}{{^missing}} no{{/missing}}",
      view: { ok: true }
    },
    {
      name: "matches falsy section values",
      template: "{{#zero}}zero{{/zero}}{{^zero}}no-zero{{/zero}} {{#emptyArray}}array{{/emptyArray}}{{^emptyArray}}no-array{{/emptyArray}} {{#emptyObject}}object{{/emptyObject}}{{^emptyObject}}no-object{{/emptyObject}}",
      view: { zero: 0, emptyArray: [], emptyObject: {} }
    },
    {
      name: "handles standalone section and comment tags",
      template: "A\n  {{#items}}\n  {{! comment }}\n- {{name}}\n  {{/items}}\nB\n",
      view: { items: [{ name: "one" }, { name: "two" }] }
    },
    {
      name: "renders interpolation lambdas",
      template: "Hello {{name}}",
      view: { name: () => "K" }
    },
    {
      name: "renders section lambdas",
      template: "{{#bold}}Hi {{name}}{{/bold}}",
      view: {
        name: "K",
        bold: () => (text: string, render: (template: string) => string) => `<b>${render(text)}</b>`
      }
    },
    {
      name: "passes standalone section lambdas the raw source body",
      template: "A\n  {{#wrap}}\nHi {{name}}\n  {{/wrap}}\nB",
      view: {
        name: "K",
        wrap: () => (text: string, render: (template: string) => string) =>
          `${JSON.stringify(text)}|${render(text)}`
      }
    },
    {
      name: "resolves inherited properties",
      template: "{{name}}/{{user.name}}/{{user.label}}",
      view: {
        name: "own",
        user: Object.assign(Object.create({ name: "proto", label: () => "proto-fn" }), {})
      }
    }
  ];

  it.each(parityCases)("matches mustache.js for $name", ({ template, view }) => {
    expect(renderTemplate(template, view)).toBe(Mustache.render(template, view));
  });

  it("disables escaping globally with escape none", () => {
    expect(renderTemplate("{{name}} {{{name}}}", { name: "<K>" }, { escape: "none" })).toBe("<K> <K>");
  });

  it("substitutes yield before parsing the template", () => {
    expect(renderTemplate("a {{yield}} b", {}, { yield: "X" })).toBe("a X b");
    expect(renderTemplate("{{yield}} {{yield}}", {}, { yield: "X" })).toBe("X X");
  });

  it("renders mustache tags introduced by yield against the view", () => {
    expect(renderTemplate("hi {{yield}}", { name: "K" }, { yield: "{{name}}" })).toBe("hi K");
  });

  it("treats yield as a normal variable when the option is omitted", () => {
    expect(renderTemplate("a {{yield}} b", {})).toBe("a  b");
    expect(renderTemplate("a {{yield}} b", { yield: "Y" })).toBe("a Y b");
  });

  it("does not let yield substitution bypass section parsing", () => {
    expect(renderTemplate("{{#show}}{{yield}}{{/show}}", { show: false }, { yield: "{{name}}" })).toBe("");
    expect(renderTemplate("{{#show}}{{yield}}{{/show}}", { show: true, name: "K" }, { yield: "{{name}}" })).toBe("K");
  });

  it("throws a useful error for unbalanced sections", () => {
    expect(() => renderTemplate("{{#items}}x", { items: [] })).toThrow('Unclosed section "items"');
    expect(() => renderTemplate("{{/items}}", {})).toThrow('Closing unopened section "items"');
    expect(() => renderTemplate("{{#a}}{{/b}}", {})).toThrow('Unclosed section "a"');
  });
});
