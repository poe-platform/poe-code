export interface SourceSnippetOptions {
  source: string;
  line: number;
  column?: number;
  context?: number;
  filePath?: string;
}

export declare function renderSourceSnippet(opts: SourceSnippetOptions): string;
