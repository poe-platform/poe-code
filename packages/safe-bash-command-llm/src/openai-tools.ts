import {openAiRecord} from './openai-http.js';
import type {LlmTool, LlmToolCall, LlmOption} from './types.js';

export function openAiTools(tools: readonly LlmTool[] | undefined): Record<string, unknown> {
  return tools?.length ? {tools:tools.map(tool=>({type:'function',function:{name:tool.name,description:tool.description || null,parameters:tool.inputSchema}}))} : {};
}

/** Aggregate tool control storage is admitted before retaining each delta.
 * Insertion order follows the reference even for interleaved call indices. */
export class OpenAiToolCalls {
  private readonly calls = new Map<number,{id?:string;name?:string;arguments:string}>();
  private bytes = 0;
  constructor(private readonly limit: number) {
    if (limit !== Infinity && (!Number.isSafeInteger(limit) || limit < 0)) throw new RangeError('Invalid tool call byte limit');
  }
  add(value: unknown, streamed: boolean): void {
    if (value === undefined || value === null) return;
    if (!Array.isArray(value)) throw new TypeError('OpenAI tool_calls must be an array');
    for (let position=0;position<value.length;position++) {
      const item: unknown = value[position];
      if (!openAiRecord(item) || !openAiRecord(item.function) || item.type !== undefined && item.type !== 'function') throw new TypeError('OpenAI returned a malformed tool call');
      const index = streamed ? item.index : position;
      if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0) throw new TypeError('OpenAI returned an invalid tool call index');
      const call = this.calls.get(index) ?? {arguments:''};
      for (const [key, input] of [['id',item.id],['name',item.function.name],['arguments',item.function.arguments]] as const) {
        if (input === undefined || input === null) continue;
        if (typeof input !== 'string') throw new TypeError('OpenAI tool call fields must be strings');
        // Charge UTF-8 without allocating another copy of a potentially large delta.
        for (const character of input) {
          const code = character.codePointAt(0)!;
          this.bytes += code < 128 ? 1 : code < 2048 ? 2 : code < 65536 ? 3 : 4;
          if (this.bytes > this.limit) throw new RangeError('OpenAI tool call byte limit exceeded');
        }
        if (key === 'arguments') call.arguments += input;
        else if (call[key] === undefined) call[key] = input;
        else if (call[key] !== input) throw new TypeError('OpenAI changed a tool call identity');
      }
      // Even empty deltas must not permit unbounded call-count storage.
      if (!this.calls.has(index)) {
        if (++this.bytes > this.limit) throw new RangeError('OpenAI tool call byte limit exceeded');
        this.calls.set(index,call);
      }
    }
  }
  finish(): readonly LlmToolCall[] | undefined {
    if (!this.calls.size) return undefined;
    return Array.from(this.calls.values(),call=>{
      if (!call.name || !call.id) throw new TypeError('OpenAI tool call is missing a name or id');
      let args: LlmOption;
      try { args=JSON.parse(call.arguments, (_key, value: unknown) => {
        if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError('Nonfinite tool argument');
        return value;
      }) as LlmOption; }
      catch { throw new TypeError('OpenAI tool call arguments are not valid JSON'); }
      return {id:call.id,name:call.name,arguments:args};
    });
  }
}
