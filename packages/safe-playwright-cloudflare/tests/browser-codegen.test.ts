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

test("oversized action data is refused before native generation", () => {
	expect(() =>
		generateBrowserActionCode({
			language: "python",
			action: {
				name: "fill",
				selector: "textarea",
				text: "a".repeat(1024 * 1024),
			},
		}),
	).toThrow("input limit exceeded");
});
