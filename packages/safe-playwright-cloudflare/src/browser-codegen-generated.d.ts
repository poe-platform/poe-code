declare module "*browser-codegen.generated.js" {
	export function languageSet(): Set<{
		id: string;
		generateAction(input: {
			frame: { pageGuid: string; pageAlias: string; framePath: string[] };
			startTime: number;
			action: Parameters<
				import("@poe-platform/safe-bash/playwright").PlaywrightActionCodeGenerator
			>[0]["action"] & { signals: [] };
		}): string;
	}>;
}
