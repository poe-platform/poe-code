import type {ansiToCells} from './ansi-text.js';
export interface PreparedDetailContent {
  text: string;
  lines: ReturnType<typeof ansiToCells>[];
}
export declare function prepareDetailContent(content: string, width: number): PreparedDetailContent;
