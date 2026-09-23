import { PlaywrightResourceLimitError } from './resource-limit.js';

// Guest call arguments are control data, independent of browser result budgets.
const maxParameterBytes = 1024 * 1024;
const maxParameterNodes = 10000;
const maxParameterDepth = 64;

/** Bound allocation before JSON.parse; property names also consume the node budget. */
export function parseWebMCPParams(source: string, commandMaxBytes = maxParameterBytes): Record<string, unknown> {
  const maxBytes = Math.min(commandMaxBytes, maxParameterBytes);
  if (source.length > maxBytes || new TextEncoder().encode(source).byteLength > maxBytes) throw new PlaywrightResourceLimitError('WebMCP parameter byte limit exceeded');
  let nodes = 0, depth = 0;
  for (let index = 0; index < source.length;) {
    const char = source[index]!;
    if (' \n\r\t,:'.includes(char)) { index++; continue; }
    if (char === ']' || char === '}') { depth--; index++; continue; }
    if (++nodes > maxParameterNodes) throw new PlaywrightResourceLimitError('WebMCP parameter node limit exceeded');
    if (char === '[' || char === '{') {
      if (++depth > maxParameterDepth) throw new PlaywrightResourceLimitError('WebMCP parameter nesting limit exceeded');
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
