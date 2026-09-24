import { expect, test } from "vitest";
import { generateBrowserActionCode } from "../src/browser-codegen";

const click = {
	name: "click" as const,
	selector: 'internal:role=button[name="Save"s]',
	button: "left" as const,
	modifiers: 0,
	clickCount: 1,
};

test.each([
	[
		"typescript",
		"await page.getByRole('button', { name: 'Save', exact: true }).click();",
	],
	["python", 'page.get_by_role("button", name="Save", exact=True).click()'],
	[
		"java",
		'page.getByRole(AriaRole.BUTTON, new Page.GetByRoleOptions().setName("Save").setExact(true)).click();',
	],
	[
		"csharp",
		'await page.GetByRole(AriaRole.Button, new() { Name = "Save", Exact = true }).ClickAsync();',
	],
] as const)("native %s code keeps semantic role and exactness", (language, expected) => {
	expect(generateBrowserActionCode({ language, action: click })).toBe(expected);
});

test("native Python generation owns modifier formatting and string escaping", () => {
	expect(
		generateBrowserActionCode({
			language: "python",
			action: {
				name: "press",
				selector: 'input[name="query"]',
				key: "Enter",
				modifiers: 2,
			},
		}),
	).toBe(
		'page.locator("input[name=\\"query\\"]").press("ControlOrMeta+Enter")',
	);
	expect(
		generateBrowserActionCode({
			language: "python",
			action: {
				name: "fill",
				selector: "textarea",
				text: 'say "hello"\nworld',
			},
		}),
	).toBe('page.locator("textarea").fill("say \\"hello\\"\\nworld")');
});

test.each([
	["large input", "a".repeat(1024 * 1024)],
	["large generated output", "\u0000".repeat(2 * 1024 * 1024)],
])("native generation accepts %s without an implicit byte cap", (_, text) => {
	const code = generateBrowserActionCode({
		language: "python",
		action: { name: "fill", selector: "textarea", text },
	});
	expect(code).toContain('page.locator("textarea").fill(');
	expect(code.length).toBeGreaterThan(text.length);
});
