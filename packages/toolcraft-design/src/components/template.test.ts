import { describe, expect, it } from "vitest";
import { renderTemplate } from "./template.js";

type View = Record<string, unknown>;

describe("unit", () => {
  const cases: Array<{
    name: string;
    template: string;
    view: View;
    expected: string;
  }> = [
    {
      name: "interpolation",
      template: "Hello {{name}}",
      view: { name: "K" },
      expected: "Hello K"
    },
    {
      name: "escaping",
      template: "{{name}}",
      view: { name: "<K> & /" },
      expected: "&lt;K&gt; &amp; &#x2F;"
    },
    {
      name: "unescaped interpolation",
      template: "{{{name}}} {{&name}}",
      view: { name: "<K>" },
      expected: "<K> <K>"
    },
    {
      name: "sections",
      template: "{{#items}}[{{name}}/{{repo}}]{{/items}}",
      view: { repo: "acme-app", items: [{ name: "one" }, { name: "two" }] },
      expected: "[one/acme-app][two/acme-app]"
    },
    {
      name: "object section scope with parent fallback",
      template: "{{#issue}}{{title}}/{{repo}}{{/issue}}",
      view: { repo: "acme/app", issue: { title: "Bug" } },
      expected: "Bug/acme&#x2F;app"
    },
    {
      name: "inverted sections",
      template: "{{^items}}none{{/items}}{{^missing}} missing{{/missing}}",
      view: { items: [] },
      expected: "none missing"
    },
    {
      name: "comments",
      template: "a{{! hidden\nstill hidden }}b",
      view: {},
      expected: "ab"
    },
    {
      name: "dotted paths",
      template: "{{issue.title}}/{{issue.missing.value}}/{{repo.name}}",
      view: { issue: { title: "Bug" }, repo: { name: "app" } },
      expected: "Bug//app"
    },
    {
      name: "implicit iterator",
      template: "{{#items}}[{{.}}]{{/items}}",
      view: { items: ["a", "b"] },
      expected: "[a][b]"
    },
    {
      name: "interpolation lambdas",
      template: "Hello {{name}}",
      view: { name: () => "K" },
      expected: "Hello K"
    },
    {
      name: "section lambdas",
      template: "{{#bold}}Hi {{name}}{{/bold}}",
      view: {
        name: "K",
        bold: () => (text: string, render: (template: string) => string) => `<b>${render(text)}</b>`
      },
      expected: "<b>Hi K</b>"
    },
    {
      name: "standalone-tag whitespace",
      template: "A\n  {{#items}}\n  {{! comment }}\n- {{name}}\n  {{/items}}\nB\n",
      view: { items: [{ name: "one" }, { name: "two" }] },
      expected: "A\n- one\n- two\nB\n"
    },
    {
      name: "falsy rules",
      template: [
        "{{#falseValue}}false{{/falseValue}}{{^falseValue}}no-false{{/falseValue}}",
        "{{#nullValue}}null{{/nullValue}}{{^nullValue}} no-null{{/nullValue}}",
        "{{#zero}} zero{{/zero}}{{^zero}} no-zero{{/zero}}",
        "{{#emptyString}} empty{{/emptyString}}{{^emptyString}} no-empty{{/emptyString}}",
        "{{#emptyArray}} array{{/emptyArray}}{{^emptyArray}} no-array{{/emptyArray}}",
        "{{#emptyObject}} object{{/emptyObject}}{{^emptyObject}} no-object{{/emptyObject}}"
      ].join(""),
      view: {
        falseValue: false,
        nullValue: null,
        zero: 0,
        emptyString: "",
        emptyArray: [],
        emptyObject: {}
      },
      expected: "no-false no-null no-zero no-empty no-array object"
    }
  ];

  it.each(cases)("renders $name", ({ template, view, expected }) => {
    expect(renderTemplate(template, view)).toBe(expected);
  });

  it("throws a useful error for unbalanced sections", () => {
    expect(() => renderTemplate("{{#items}}x", { items: [] })).toThrow('Unclosed section "items"');
    expect(() => renderTemplate("{{/items}}", {})).toThrow('Closing unopened section "items"');
    expect(() => renderTemplate("{{#a}}{{/b}}", {})).toThrow(
      'Unclosed section "a" before closing "b"'
    );
  });

  it("reports the tag, location and expected closing form for an unclosed tag", () => {
    expect(() => renderTemplate("line one\nhello {{ name\n", {})).toThrow(
      'Unclosed tag "{{ name": expected "}}" at line 2, column 7'
    );
    expect(() => renderTemplate("{{{ raw", {})).toThrow(
      'Unclosed tag "{{{ raw": expected "}}}" at line 1, column 1'
    );
  });

  it("does not render inherited view properties", () => {
    const inherited = Object.assign(Object.create({ secret: { value: "leaked" } }), {
      nested: {}
    }) as View;

    expect(
      renderTemplate("{{constructor}}/{{toString}}/{{nested.toString}}/{{secret.value}}", inherited)
    ).toBe("///");
  });
});

describe("representative templates", () => {
  const cases: Array<{ name: string; template: string; view: View; expected: string }> = [
    {
      name: "github-workflows run prompt",
      template: "Read {{url}} from {{comment.author}} in {{repo}}: {{comment.body}}",
      view: {
        url: "https://github.com/acme/app/issues/42",
        repo: "acme/app",
        comment: { author: "alice", body: "please fix this" }
      },
      expected:
        "Read https:&#x2F;&#x2F;github.com&#x2F;acme&#x2F;app&#x2F;issues&#x2F;42 from alice in acme&#x2F;app: please fix this"
    },
    {
      name: "github-workflows shared variables prompt",
      template: ["Repo from env: {{repo}}", "Style:", "{{response_style}}"].join("\n"),
      view: {
        repo: "acme/app",
        response_style: "- Use the repository house style.\n"
      },
      expected: "Repo from env: acme&#x2F;app\nStyle:\n- Use the repository house style.\n"
    },
    {
      name: "github-workflows pull request comment prompt",
      template:
        "Read {{url}} from {{comment.author}} on PR {{pr.number}} by {{pr.author}}: {{comment.body}}",
      view: {
        url: "https://github.com/acme/app/pull/42",
        comment: { author: "bob", body: "poe-code-agent please apply this" },
        pr: { number: "42", author: "alice" }
      },
      expected:
        "Read https:&#x2F;&#x2F;github.com&#x2F;acme&#x2F;app&#x2F;pull&#x2F;42 from bob on PR 42 by alice: poe-code-agent please apply this"
    },
    {
      name: "github-workflows prompt-preview prompt",
      template: [
        "Issue URL: {{url}}",
        "Rules:",
        "{{custom_project_rules}}",
        "{{response_style}}"
      ].join("\n"),
      view: {
        url: "https://github.com/acme/app/issues/188",
        custom_project_rules: "Check docs/internal.md first.\n",
        response_style: "- Start with a direct answer or decision.\n- Keep it concise.\n"
      },
      expected:
        "Issue URL: https:&#x2F;&#x2F;github.com&#x2F;acme&#x2F;app&#x2F;issues&#x2F;188\nRules:\nCheck docs&#x2F;internal.md first.\n\n- Start with a direct answer or decision.\n- Keep it concise.\n"
    },
    {
      name: "github-workflows sourced item prompt",
      template: "Fix {{dependency.package.name}}",
      view: { dependency: { package: { name: "lodash" } } },
      expected: "Fix lodash"
    },
    {
      name: "config-mutations templateWrite",
      template: "#!/bin/bash\necho {{name}}",
      view: { name: "myapp" },
      expected: "#!/bin/bash\necho myapp"
    },
    {
      name: "config-mutations templateMergeJson",
      template: ["{", '  "command": "{{command}}",', '  "enabled": {{enabled}}', "}"].join("\n"),
      view: { command: "poe-code", enabled: true },
      expected: ["{", '  "command": "poe-code",', '  "enabled": true', "}"].join("\n")
    },
    {
      name: "config-mutations templateMergeToml",
      template: ["[tools]", 'agent = "{{agent}}"', 'models = [{{#models}}"{{.}}"{{/models}}]'].join(
        "\n"
      ),
      view: { agent: "codex", models: ["gpt-5.4"] },
      expected: ["[tools]", 'agent = "codex"', 'models = ["gpt-5.4"]'].join("\n")
    },
    {
      name: "config-mutations template render arrays after preprocessing",
      template: ["Tasks:", "{{tasks}}", "Enabled: {{enabled}}"].join("\n"),
      view: { tasks: "lint\ntest", enabled: true },
      expected: "Tasks:\nlint\ntest\nEnabled: true"
    }
  ];

  it.each(cases)("renders $name", ({ template, view, expected }) => {
    expect(renderTemplate(template, view)).toBe(expected);
  });
});

describe("escape", () => {
  it("disables escaping for all interpolation forms", () => {
    const template = "{{name}} {{{name}}} {{&name}}";
    const view = { name: "<K> & /" };

    expect(renderTemplate(template, view, { escape: "none" })).toBe("<K> & / <K> & / <K> & /");
  });
});

describe("yield", () => {
  it("substitutes a yield token", () => {
    expect(renderTemplate("a {{yield}} b", {}, { yield: "X" })).toBe("a X b");
  });

  it("substitutes multiple yield tokens", () => {
    expect(renderTemplate("{{yield}} {{yield}}", {}, { yield: "X" })).toBe("X X");
  });

  it("renders mustache tags introduced by yield against the view", () => {
    expect(renderTemplate("hi {{yield}}", { name: "K" }, { yield: "{{name}}" })).toBe("hi K");
  });

  it("preserves unresolved tags during raw yield substitution", () => {
    expect(
      renderTemplate("Read {{url}}. {{yield}}", {}, { yield: "Focus on {{repo}}.", escape: "none" })
    ).toBe("Read {{url}}. Focus on {{repo}}.");
  });

  it("treats yield as a normal variable when the option is omitted", () => {
    expect(renderTemplate("a {{yield}} b", {})).toBe("a  b");
    expect(renderTemplate("a {{yield}} b", { yield: "Y" })).toBe("a Y b");
  });

  it("does not let yield substitution bypass section parsing", () => {
    expect(
      renderTemplate(
        "{{#show}}before {{yield}} after{{/show}}",
        { show: false },
        { yield: "{{name}}" }
      )
    ).toBe("");
    expect(
      renderTemplate(
        "{{#show}}before {{yield}} after{{/show}}",
        { show: true, name: "K" },
        { yield: "{{name}}" }
      )
    ).toBe("before K after");
  });

  it("does not throw on multiple or unresolved yield tokens", () => {
    expect(() => renderTemplate("{{yield}} {{yield}}", {}, { yield: "X" })).not.toThrow();
    expect(() => renderTemplate("{{yield}}", {})).not.toThrow();
    expect(renderTemplate("{{yield}}", {})).toBe("");
  });
});

describe("partials", () => {
  it("renders named partials against the parent view", () => {
    expect(
      renderTemplate(
        "Hello {{> greeting}}",
        { name: "K" },
        {
          partials: { greeting: "{{name}}" }
        }
      )
    ).toBe("Hello K");
  });

  it("renders nested partials", () => {
    expect(
      renderTemplate(
        "{{> outer}}",
        { name: "K" },
        {
          partials: {
            outer: "Before {{> inner}} after",
            inner: "{{name}}"
          }
        }
      )
    ).toBe("Before K after");
  });

  it("indents each line of a standalone partial", () => {
    expect(
      renderTemplate(
        "Items:\n  {{> items}}\nDone",
        {},
        {
          partials: { items: "one\ntwo\n" }
        }
      )
    ).toBe("Items:\n  one\n  two\nDone");
  });

  it("composes partials with yield", () => {
    expect(
      renderTemplate(
        "{{> rules}}\n{{yield}}",
        { name: "K" },
        {
          escape: "none",
          yield: "Hello {{name}}",
          partials: { rules: "Rules for {{name}}\n" }
        }
      )
    ).toBe("Rules for K\nHello K");
  });

  it("substitutes yield tokens inside partials", () => {
    expect(
      renderTemplate(
        "{{> layout}}",
        {},
        {
          escape: "none",
          yield: "Child",
          partials: { layout: "Before\n{{yield}}\nAfter" }
        }
      )
    ).toBe("Before\nChild\nAfter");
  });

  it("fails when a referenced partial is missing", () => {
    expect(() => renderTemplate("{{> missing}}", {}, { partials: {} })).toThrow(
      'Partial "missing" not found.'
    );
  });

  it("fails for missing partials inside inactive sections", () => {
    expect(() =>
      renderTemplate("{{#show}}{{> missing}}{{/show}}", { show: false }, { partials: {} })
    ).toThrow('Partial "missing" not found.');
  });

  it("fails when partial references are circular", () => {
    expect(() =>
      renderTemplate(
        "{{> one}}",
        {},
        {
          partials: { one: "{{> two}}", two: "{{> one}}" }
        }
      )
    ).toThrow("Circular partial reference detected: one -> two -> one.");
  });

  it("fails when partial references exceed the recursion limit", () => {
    const partials = Object.fromEntries(
      Array.from({ length: 102 }, (_, index) => [
        `partial-${index}`,
        index === 101 ? "done" : `{{> partial-${index + 1}}}`
      ])
    );

    expect(() => renderTemplate("{{> partial-0}}", {}, { partials })).toThrow(
      "Maximum partial depth exceeded (100)."
    );
  });

  it("validates unresolved variables when requested", () => {
    expect(() => renderTemplate("Hello {{name}}", {}, { validate: true })).toThrow(
      'Template variable "name" not found.'
    );
  });

  it("validates variables inside inactive sections", () => {
    expect(() =>
      renderTemplate("{{#show}}{{name}}{{/show}}", { show: false }, { validate: true })
    ).toThrow('Template variable "name" not found.');
  });
});
