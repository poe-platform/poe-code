export type PlaywrightJsonValue = null | boolean | number | string | readonly PlaywrightJsonValue[] | { readonly [key: string]: PlaywrightJsonValue };

export interface PlaywrightResultSection {
  readonly title: 'Result' | 'Ran Playwright code' | 'Page' | 'Snapshot' | 'Events' | 'Open tabs' | 'Modal state' | 'Error';
  readonly content: string | { readonly json: PlaywrightJsonValue };
  readonly codeframe?: string;
}

export interface PlaywrightCommandResult {
  readonly sections: readonly PlaywrightResultSection[];
  readonly isError?: boolean;
  readonly rawErrorHeader?: boolean;
}

export class PlaywrightReportedError extends Error {
  override readonly name = 'PlaywrightReportedError';
}

export const playwrightCliCompatibilityVersion = '0.1.20';

export function serializePlaywrightResult(result: PlaywrightCommandResult, options: { readonly json: boolean; readonly raw: boolean }): string {
  const sections = options.raw ? result.sections.filter(section => ['Error', 'Result', 'Snapshot'].includes(section.title)) : result.sections;
  if (options.json) {
    const payload: { [key: string]: PlaywrightJsonValue } = {};
    if (result.isError || sections.some(section => section.title === 'Error')) payload.isError = true;
    for (const section of sections) {
      if (section.title === 'Ran Playwright code') continue;
      if (typeof section.content !== 'string') payload[section.title.toLowerCase()] = section.content.json;
      else if (section.content) {
        const prefix = '- [Snapshot](';
        payload[section.title.toLowerCase()] = section.title === 'Snapshot' && section.content.startsWith(prefix) && section.content.endsWith(')')
          ? { file: section.content.slice(prefix.length, -1) } : section.content;
      }
    }
    return JSON.stringify(payload, null, 2) + '\n';
  }
  const lines: string[] = [];
  for (const section of sections) {
    const text = typeof section.content === 'string' ? section.content : JSON.stringify(section.content.json, null, 2);
    if (!text) continue;
    if (!options.raw || result.rawErrorHeader && section.title === 'Error') {
      lines.push(`### ${section.title}`);
      if (!options.raw && section.codeframe) lines.push('```' + section.codeframe);
    }
    lines.push(text);
    if (!options.raw && section.codeframe) lines.push('```');
  }
  return lines.join('\n') + '\n';
}

/** ISO timestamps keep names portable; a per-controller suffix avoids same-tick collisions. */
export function playwrightArtifactName(prefix: string, extension: string, sequence: number): string {
  const timestamp = new Date().toISOString().split(':').join('-').split('.').join('-');
  return `.playwright-cli/${prefix}-${timestamp}-${sequence}.${extension}`;
}

export function playwrightCodeString(value: string): string {
  return "'" + value.split('\\').join('\\\\').split("'").join("\\'").split('\n').join('\\n').split('\r').join('\\r').split('\u2028').join('\\u2028').split('\u2029').join('\\u2029') + "'";
}
