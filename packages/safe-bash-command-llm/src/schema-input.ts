import { FsError, type CommandContext } from 'safe-bash-contracts';
import { pathOf } from 'safe-bash-contracts/path';
import { fileSource } from './file-source.js';
import { parseLlmSchemaDsl } from './schemas.js';
import type { LlmTemplate } from './templates.js';

export interface LlmSchemaInputOptions {
  readonly multi?: boolean;
  readonly maxBytes?: number;
  readonly admitBytes?: (size: number) => void;
  readonly loadTemplate: (name: string) => Promise<LlmTemplate>;
  readonly loadSchema?: (id: string) => Promise<Record<string, unknown> | undefined>;
}

/** Schemas are provider control objects; file reads retain identity and obey caller admission. */
export async function resolveLlmSchemaInput(
  context: Pick<CommandContext, 'fs' | 'cwd' | 'signal'>,
  input: string,
  options: LlmSchemaInputOptions,
): Promise<Record<string, unknown>> {
  context.signal.throwIfAborted();
  let schema: unknown;
  const trimmed = input.trim();
  if (trimmed.startsWith('t:')) {
    const name = trimmed.slice(2);
    const template = await options.loadTemplate(name);
    schema = template.schema_object;
    if (!schema) throw new Error("Template '" + name + "' has no schema");
  } else {
    if (trimmed.startsWith('{')) {
      try { schema = JSON.parse(input); } catch { /* Reference falls through to DSL/path resolution. */ }
    }
    if (schema === undefined && (trimmed.includes(' ') || input.includes(','))) schema = parseLlmSchemaDsl(input);
    if (schema === undefined) {
      const path = pathOf(context, input);
      let stat;
      try { stat = await context.fs.stat(path, {signal: context.signal}); }
      catch (error) { if (!(error instanceof FsError) || error.code !== 'ENOENT') throw error; }
      if (stat) {
        const source = await fileSource({fs: context.fs, path, signal: context.signal, maxBytes: options.maxBytes ?? Infinity, expectedStat: stat});
        let text = '';
        const decoder = new TextDecoder('utf-8', {fatal: true});
        try {
          for await (const bytes of source.bytes) {
            options.admitBytes?.(bytes.byteLength);
            text += decoder.decode(bytes, {stream: true});
          }
          text += decoder.decode();
        } finally { await source.dispose(); }
        try { schema = JSON.parse(text); }
        catch { throw new Error('Schema file contained invalid JSON'); }
      } else schema = await options.loadSchema?.(input);
    }
  }
  context.signal.throwIfAborted();
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) throw new Error('Invalid schema');
  return options.multi
    ? {type: 'object', properties: {items: {type: 'array', items: schema}}, required: ['items']}
    : schema as Record<string, unknown>;
}
