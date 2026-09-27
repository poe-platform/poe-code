import { PlaywrightResourceLimitError, type PlaywrightStructureLimits } from './resource-limit.js';

/** Bound allocation before JSON.parse; property names also consume the node budget. */
export function parseWebMCPParams(source: string, commandMaxBytes = Infinity, limits: PlaywrightStructureLimits = {}): Record<string, unknown> {
  const maxBytes = Math.min(commandMaxBytes, limits.maxWebMCPParameterBytes ?? Infinity);
  if (source.length > maxBytes || maxBytes !== Infinity && new TextEncoder().encode(source).byteLength > maxBytes) throw new PlaywrightResourceLimitError('WebMCP parameter byte limit exceeded');
  let nodes = 0, depth = 0;
  for (let index = 0; index < source.length;) {
    const char = source[index]!;
    if (' \n\r\t,:'.includes(char)) { index++; continue; }
    if (char === ']' || char === '}') { depth--; index++; continue; }
    if (++nodes > (limits.maxWebMCPParameterNodes ?? Infinity)) throw new PlaywrightResourceLimitError('WebMCP parameter node limit exceeded');
    if (char === '[' || char === '{') {
      if (++depth > (limits.maxWebMCPParameterDepth ?? Infinity)) throw new PlaywrightResourceLimitError('WebMCP parameter nesting limit exceeded');
      index++;
    } else if (char === '"') {
      index++;
      while (index < source.length) {
        const next = source[index++];
        if (next === '\\') index++;
        else if (next === '"') break;
      }
    } else {
      do { index++; } while (index < source.length && !' \n\r\t,:[]{}"'.includes(source[index]!));
    }
  }
  const params: unknown = JSON.parse(source);
  if (!params || typeof params !== 'object' || Array.isArray(params)) throw new Error('WebMCP parameters must be a JSON object');
  return params as Record<string, unknown>;
}
