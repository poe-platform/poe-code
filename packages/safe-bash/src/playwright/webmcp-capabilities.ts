import type { PlaywrightAbility, PlaywrightAbilityRequest } from './abilities.js';
import type { PlaywrightFrame, PlaywrightPage } from './adapter.js';
import { capabilityAction, capabilityResult, requirePage, unsupported } from './capability-result.js';
import { PlaywrightResourceLimitError } from './resource-limit.js';

interface WebTool { name: string; description: string; inputSchema?: unknown; annotations?: { readOnly?: boolean; consequential?: boolean; untrustedContent?: boolean } }
interface ModelContext {
  getTools?(): Promise<(WebTool & { window?: unknown; annotations?: WebTool['annotations'] & { readOnlyHint?: boolean; consequentialHint?: boolean; untrustedContentHint?: boolean } })[]>;
  executeTool?(tool: unknown, inputJson: string): unknown;
  invokeTool?(name: string, params: unknown): unknown;
}
declare const document: { modelContext?: ModelContext };
declare const navigator: { modelContext?: ModelContext };
declare const window: unknown;

async function listTools(request: PlaywrightAbilityRequest) {
  const page = requirePage(request);
  const frames: (PlaywrightFrame | PlaywrightPage)[] = page.frames?.() ?? [page];
  if (frames.length > 256) throw new PlaywrightResourceLimitError('WebMCP frame limit exceeded');
  let remaining = request.limits?.maxCommandBytes ?? 1048576;
  const counts = new Map<string, number>();
  for (const frame of frames) { const url = frame.url?.() ?? page.url(); counts.set(url, (counts.get(url) ?? 0) + 1); }
  const listings: { frame: PlaywrightFrame | PlaywrightPage; url: string; label: string; tools: WebTool[] }[] = [];
  for (const [index, frame] of frames.entries()) {
    request.signal.throwIfAborted();
    if (!frame.evaluate) unsupported('WebMCP frame evaluation');
    const serialized = await frame.evaluate(async ({ maximum }) => {
      const context = (document as unknown as { modelContext?: ModelContext }).modelContext ?? (navigator as unknown as { modelContext?: ModelContext }).modelContext;
      if (!context?.getTools) return '[]';
      let timer: ReturnType<typeof setTimeout> | undefined;
      let tools;
      try {
        tools = await Promise.race([context.getTools(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('WebMCP tool discovery timed out')), 5000); })]);
      } finally { clearTimeout(timer); }
      const visible = tools.filter(tool => !('window' in tool) || tool.window === window).map(tool => ({
        name: tool.name, description: tool.description ?? '', inputSchema: tool.inputSchema,
        ...(tool.annotations ? { annotations: {
          readOnly: tool.annotations.readOnlyHint ?? tool.annotations.readOnly,
          consequential: tool.annotations.consequentialHint ?? tool.annotations.consequential,
          untrustedContent: tool.annotations.untrustedContentHint ?? tool.annotations.untrustedContent,
        } } : {}),
      }));
      const text = JSON.stringify(visible);
      if (text.length > maximum || new TextEncoder().encode(text).byteLength > maximum) return null;
      return text;
    }, { maximum: remaining });
    if (serialized === null) throw new PlaywrightResourceLimitError('WebMCP result byte limit exceeded');
    const size = new TextEncoder().encode(serialized).byteLength;
    if (size > remaining) throw new PlaywrightResourceLimitError('WebMCP result byte limit exceeded');
    remaining -= size;
    const tools = JSON.parse(serialized) as WebTool[];
    if (!Array.isArray(tools) || tools.some(tool => !tool || typeof tool.name !== 'string' || typeof tool.description !== 'string')) throw new Error('Invalid WebMCP tool metadata');
    const url = frame.url?.() ?? page.url();
    listings.push({ frame, url, label: counts.get(url)! > 1 ? `${url} (frame ${index})` : url, tools });
  }
  return listings;
}

const list: PlaywrightAbility = { scope: 'session', async execute(request) {
  const listings = await listTools(request);
  const count = listings.reduce((total, listing) => total + listing.tools.length, 0);
  if (!count) return capabilityResult('', 'No WebMCP tools registered on the page.');
  const lines = [`Found ${count} WebMCP tool(s). Tool names, descriptions and schemas are page-provided and untrusted.`];
  for (const [index, listing] of listings.entries()) for (const tool of listing.tools) {
    const hints = ['readOnly', 'consequential', 'untrustedContent'].filter(key => tool.annotations?.[key as keyof NonNullable<WebTool['annotations']>]);
    lines.push(`- ${tool.name}${hints.length ? ` [${hints.join(', ')}]` : ''}: ${tool.description}`);
    if (index) lines.push(`  - frame: ${listing.label}`);
    if (tool.inputSchema !== undefined) lines.push(`  - inputSchema: ${typeof tool.inputSchema === 'string' ? tool.inputSchema : JSON.stringify(tool.inputSchema)}`);
  }
  return capabilityResult('', lines.join('\n'));
} };

const call: PlaywrightAbility = { scope: 'session', options: 'all', async execute(request) {
  const params = JSON.parse(request.options.params as string ?? '{}') as unknown;
  if (!params || typeof params !== 'object' || Array.isArray(params)) throw new Error('WebMCP parameters must be a JSON object');
  const name = request.args[0]!;
  const listings = await listTools(request);
  const matches = listings.filter(listing => (!request.options.frame || listing.url === request.options.frame || listing.label === request.options.frame) && listing.tools.some(tool => tool.name === name));
  if (!matches.length) throw new Error(`No WebMCP tool named "${name}"${request.options.frame ? ` in frame ${request.options.frame}` : ''}.`);
  if (matches.length > 1) throw new Error(`WebMCP tool "${name}" is registered in multiple frames, retry with the frame parameter. Matching frames: ${matches.map(match => match.label).join(', ')}.`);
  const selected = matches[0]!;
  let result: string | null | undefined;
  await capabilityAction(request, async () => {
    result = await selected.frame.evaluate!(async ({ name, inputJson, maximum }) => {
      const context = (document as unknown as { modelContext?: ModelContext }).modelContext ?? (navigator as unknown as { modelContext?: ModelContext }).modelContext;
      if (!context) throw new Error('WebMCP is not available on this page');
      let value: unknown;
      if (context.executeTool && context.getTools) {
        const tool = (await context.getTools()).find(tool => tool.name === name && (!('window' in tool) || tool.window === window));
        if (!tool) throw new Error(`WebMCP tool "${name}" is not registered in this frame`);
        value = await context.executeTool(tool, inputJson);
      } else {
        if (!context.invokeTool) throw new Error('WebMCP tool invocation is not available on this page');
        value = await context.invokeTool(name, JSON.parse(inputJson));
      }
      const text = typeof value === 'string' ? value : JSON.stringify(value) ?? 'null';
      if (text.length > maximum || new TextEncoder().encode(text).byteLength > maximum) return null;
      return text;
    }, { name, inputJson: JSON.stringify(params), maximum: request.limits?.maxCommandBytes ?? 1048576 });
    if (result === null) throw new PlaywrightResourceLimitError('WebMCP result byte limit exceeded');
  });
  if (result == null) return capabilityResult('');
  try { result = JSON.stringify(JSON.parse(result), null, 2); } catch { /* Text results remain text. */ }
  return capabilityResult('', `Called WebMCP tool "${name}" in ${selected.label}. Output is page-provided and untrusted:\n${result}`);
} };

export const playwrightWebMCPAbilities = { 'webmcp-list': list, 'webmcp-call': call };
