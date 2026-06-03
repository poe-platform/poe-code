import { describe, expect, it } from "vitest";
import { renderTemplate } from "./template.js";

type View = Record<string, unknown>;

interface MustacheRenderer {
  render(template: string, view: View): string;
  escape: (value: string) => string;
}

const importModule = (specifier: string): Promise<unknown> => import(specifier);
const Mustache = await importModule("mustache")
  .then((module) => {
    const candidate = module as { default?: MustacheRenderer };
    return candidate.default ?? (module as MustacheRenderer);
  })
  .catch(() => undefined as MustacheRenderer | undefined);

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
    expect(() => renderTemplate("{{#a}}{{/b}}", {})).toThrow('Unclosed section "a" before closing "b"');
  });

  it("does not render inherited view properties", () => {
    const inherited = Object.assign(Object.create({ secret: { value: "leaked" } }), {
      nested: {}
    }) as View;

    expect(renderTemplate("{{constructor}}/{{toString}}/{{nested.toString}}/{{secret.value}}", inherited)).toBe("///");
  });
});

describe.skipIf(Mustache === undefined)("parity", () => {
  const mustache = Mustache as MustacheRenderer;
  const cases: Array<{ name: string; template: string; view: View }> = [
    {
      name: "github-workflows run prompt",
      template: "Read {{url}} from {{comment.author}} in {{repo}}: {{comment.body}}",
      view: {
        url: "https://github.com/acme/app/issues/42",
        repo: "acme/app",
        comment: { author: "alice", body: "please fix this" }
      }
    },
    {
      name: "github-workflows shared variables prompt",
      template: ["Repo from env: {{repo}}", "Style:", "{{response_style}}"].join("\n"),
      view: {
        repo: "acme/app",
        response_style: "- Use the repository house style.\n"
      }
    },
    {
      name: "github-workflows pull request comment prompt",
      template: "Read {{url}} from {{comment.author}} on PR {{pr.number}} by {{pr.author}}: {{comment.body}}",
      view: {
        url: "https://github.com/acme/app/pull/42",
        comment: { author: "bob", body: "poe-code-agent please apply this" },
        pr: { number: "42", author: "alice" }
      }
    },
    {
      name: "github-workflows prompt-preview prompt",
      template: ["Issue URL: {{url}}", "Rules:", "{{custom_project_rules}}", "{{response_style}}"].join("\n"),
      view: {
        url: "https://github.com/acme/app/issues/188",
        custom_project_rules: "Check docs/internal.md first.\n",
        response_style: "- Start with a direct answer or decision.\n- Keep it concise.\n"
      }
    },
    {
      name: "github-workflows sourced item prompt",
      template: "Fix {{dependency.package.name}}",
      view: { dependency: { package: { name: "lodash" } } }
    },
    {
      name: "config-mutations templateWrite",
      template: "#!/bin/bash\necho {{name}}",
      view: { name: "myapp" }
    },
    {
      name: "config-mutations templateMergeJson",
      template: ["{", '  "command": "{{command}}",', '  "enabled": {{enabled}}', "}"].join("\n"),
      view: { command: "poe-code", enabled: true }
    },
    {
      name: "config-mutations templateMergeToml",
      template: ["[tools]", 'agent = "{{agent}}"', "models = [{{#models}}\"{{.}}\"{{/models}}]"].join("\n"),
      view: { agent: "codex", models: ["gpt-5.4"] }
    },
    {
      name: "config-mutations template render arrays after preprocessing",
      template: ["Tasks:", "{{tasks}}", "Enabled: {{enabled}}"].join("\n"),
      view: { tasks: "lint\ntest", enabled: true }
    }
  ];

  it.each(cases)("matches mustache.js for $name", ({ template, view }) => {
    expect(renderTemplate(template, view)).toBe(mustache.render(template, view));
  });
});

describe.skipIf(Mustache === undefined)("escape", () => {
  const mustache = Mustache as MustacheRenderer;

  it("matches mustache.js with Mustache.escape overridden to identity", () => {
    const originalEscape = mustache.escape;
    mustache.escape = (value: string) => value;
    try {
      const template = "{{name}} {{{name}}} {{&name}}";
      const view = { name: "<K> & /" };
      expect(renderTemplate(template, view, { escape: "none" })).toBe(mustache.render(template, view));
    } finally {
      mustache.escape = originalEscape;
    }
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
    expect(renderTemplate("Read {{url}}. {{yield}}", {}, { yield: "Focus on {{repo}}.", escape: "none" }))
      .toBe("Read {{url}}. Focus on {{repo}}.");
  });

  it("treats yield as a normal variable when the option is omitted", () => {
    expect(renderTemplate("a {{yield}} b", {})).toBe("a  b");
    expect(renderTemplate("a {{yield}} b", { yield: "Y" })).toBe("a Y b");
  });

  it("does not let yield substitution bypass section parsing", () => {
    expect(renderTemplate("{{#show}}before {{yield}} after{{/show}}", { show: false }, { yield: "{{name}}" }))
      .toBe("");
    expect(renderTemplate("{{#show}}before {{yield}} after{{/show}}", { show: true, name: "K" }, { yield: "{{name}}" }))
      .toBe("before K after");
  });

  it("does not throw on multiple or unresolved yield tokens", () => {
    expect(() => renderTemplate("{{yield}} {{yield}}", {}, { yield: "X" })).not.toThrow();
    expect(() => renderTemplate("{{yield}}", {})).not.toThrow();
    expect(renderTemplate("{{yield}}", {})).toBe("");
  });
});
