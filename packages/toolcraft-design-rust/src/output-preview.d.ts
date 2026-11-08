export declare const MAX_OUTPUT_PREVIEW_CHARS = 16384;
export declare const OUTPUT_TRUNCATION_NOTICE = "[Output truncated: showing latest text]\n";
export declare function createTerminalStringFilter(): { push(text: string): string };
export declare function limitOutputPreview(text: string): string;
export declare function retainOutputTail(text: string, maxChars: number): string;
export declare function createOutputPreviewBuffer(): { push(text: string): void; text(): string };
