import type { PlaywrightAbility } from './abilities.js';
import type { PlaywrightActionOptions, PlaywrightMouseButton } from './adapter.js';
import type { PlaywrightCommand } from './catalog.js';
import { capabilityAction, capabilityActionCode, capabilityArtifact, capabilityLocator, capabilityResult, numeric, requirePage, requireSession, unsupported } from './capability-result.js';
import { playwrightLocatorSelector } from './locator-selector.js';
import { playwrightStorageAbilities } from './storage-capabilities.js';
import { playwrightEventAbilities } from './capability-events.js';
import { playwrightTracingStart, playwrightTracingStop } from './tracing-capabilities.js';
import { playwrightModalAbilities } from './modal-capabilities.js';
import { playwrightDrop } from './drop-capability.js';
import { playwrightWebMCPAbilities } from './webmcp-capabilities.js';
import { playwrightRecordingAbilities } from './recording-capabilities.js';
import { playwrightRouteAbilities } from './route-capabilities.js';
import { PlaywrightResourceLimitError } from './resource-limit.js';

function button(value: string | undefined): PlaywrightMouseButton {
  if (value === undefined) return 'left';
  if (value !== 'left' && value !== 'right' && value !== 'middle') throw new Error(`Invalid mouse button: ${value}`);
  return value;
}

const navigation: PlaywrightAbility = { scope: 'session', async execute(request) {
  const page = requirePage(request);
  const method = request.command === 'go-back' ? 'goBack' : request.command === 'go-forward' ? 'goForward' : 'reload';
  if (!page[method]) unsupported(method);
  await requireSession(request).invalidateTargets?.();
  await capabilityAction(request, async () => { await page[method]!({ timeout: request.limits?.navigationTimeoutMs ?? 60000 }); });
  return capabilityResult(`await page.${method}();`);
} };

const keyboard: PlaywrightAbility = { scope: 'session', options: 'all', async execute(request) {
  const page = requirePage(request);
  const value = request.args[0]!;
  const method = request.command === 'keydown' ? 'down' : request.command === 'keyup' ? 'up' : 'insertText';
  if (!page.keyboard[method]) unsupported(`keyboard.${method}`);
  await capabilityAction(request, async () => {
    await page.keyboard[method]!(value);
    if (request.options.submit) await page.keyboard.press('Enter');
  });
  return capabilityResult(`await page.keyboard.${method}(${JSON.stringify(value)});${request.options.submit ? "\nawait page.keyboard.press('Enter');" : ''}`);
} };

const mouse: PlaywrightAbility = { scope: 'session', async execute(request) {
  const mouse = requirePage(request).mouse;
  if (!mouse) unsupported('mouse');
  const method = request.command.slice('mouse'.length);
  if (method === 'down' || method === 'up') {
    const options = { button: button(request.args[0]) };
    await capabilityAction(request, () => mouse[method](options));
    return capabilityResult(`await page.mouse.${method}(${JSON.stringify(options)});`);
  }
  const x = numeric(request.args[0], 'mouse coordinate');
  const y = numeric(request.args[1], 'mouse coordinate');
  await capabilityAction(request, () => method === 'move' ? mouse.move(x, y) : mouse.wheel(x, y));
  return capabilityResult(`await page.mouse.${method}(${x}, ${y});`);
} };

const element: PlaywrightAbility = { scope: 'session', options: 'all', async execute(request) {
  const session = requireSession(request);
  const target = await session.resolveTarget(request.args[0]!);
  const locator = capabilityLocator(request.args[0]!, request);
  const selector = session.generateActionCode && session.configuration?.codegen !== 'none'
    ? playwrightLocatorSelector(requirePage(request), locator.slice('page.'.length)) : request.args[0]!;
  const method = request.command as 'dblclick' | 'hover' | 'check' | 'uncheck' | 'select';
  if (method === 'select') {
    if (!target.selectOption) unsupported('selectOption');
    await capabilityAction(request, async () => { await target.selectOption!(request.args[1]!, { timeout: request.limits?.actionTimeoutMs ?? 30000 }); });
    return capabilityResult(capabilityActionCode(request, { name: 'select', selector, options: [request.args[1]!] }, `await ${locator}.selectOption(${JSON.stringify(request.args[1])});`));
  }
  if (!target[method]) unsupported(method);
  const options: PlaywrightActionOptions = { timeout: request.limits?.actionTimeoutMs ?? 30000 };
  if (method === 'dblclick') {
    options.button = button(request.args[1]);
    if (request.options.modifiers) {
      const modifiers = Array.isArray(request.options.modifiers) ? request.options.modifiers : [request.options.modifiers];
      if (modifiers.some(value => !['Alt', 'Control', 'ControlOrMeta', 'Meta', 'Shift'].includes(value as string))) throw new Error('Invalid click modifier');
      options.modifiers = modifiers as NonNullable<PlaywrightActionOptions['modifiers']>;
    }
  }
  await capabilityAction(request, () => target[method]!(options));
  const fallback = `await ${locator}.${method}(${method === 'dblclick' ? JSON.stringify({ button: options.button, ...(options.modifiers ? { modifiers: options.modifiers } : {}) }) : ''});`;
  if (method !== 'dblclick') return capabilityResult(capabilityActionCode(request, { name: method, selector }, fallback));
  const modifiers = options.modifiers ?? [];
  const mask = (modifiers.includes('Alt') ? 1 : 0) | (modifiers.includes('Control') || modifiers.includes('ControlOrMeta') ? 2 : 0) | (modifiers.includes('Meta') ? 4 : 0) | (modifiers.includes('Shift') ? 8 : 0);
  return capabilityResult(capabilityActionCode(request, { name: 'click', selector, button: options.button!, modifiers: mask, clickCount: 2 }, fallback));
} };

const drag: PlaywrightAbility = { scope: 'session', async execute(request) {
  const session = requireSession(request);
  const mouse = requirePage(request).mouse;
  if (!mouse) unsupported('mouse');
  const start = await session.resolveTarget(request.args[0]!);
  const end = await session.resolveTarget(request.args[1]!);
  if (!start.boundingBox || !end.boundingBox) unsupported('element boundingBox');
  const first = await start.boundingBox(), last = await end.boundingBox();
  if (!first || !last) throw new Error('Drag target is not visible');
  await capabilityAction(request, async () => {
    await mouse.move(first.x + first.width / 2, first.y + first.height / 2);
    await mouse.down();
    try {
      await mouse.move(last.x + last.width / 2, last.y + last.height / 2);
      await mouse.move(last.x + last.width / 2, last.y + last.height / 2);
    } finally { await mouse.up(); }
  });
  return capabilityResult(`await ${capabilityLocator(request.args[0]!, request)}.dragTo(${capabilityLocator(request.args[1]!, request)});`);
} };

const evaluate: PlaywrightAbility = { scope: 'session', options: 'all', async execute(request) {
  const page = requirePage(request);
  const expression = request.args[0]!;
  const maxBytes = request.limits?.maxCommandBytes ?? 1048576;
  const input = { expression, maxBytes };
  let serialized: string | null | undefined;
  await capabilityAction(request, async () => {
  if (request.args[1] !== undefined) {
    const element = await requireSession(request).resolveTarget(request.args[1]);
    serialized = await element.evaluate(async (element, { expression, maxBytes }) => {
      // This function executes in the isolated page, never in the host runtime.
      const value: unknown = eval(`(${expression})`);
      const result: unknown = await (typeof value === 'function' ? value(element) : value);
      const text = JSON.stringify(result, null, 2) ?? 'undefined';
      if (text.length > maxBytes || new TextEncoder().encode(text).length > maxBytes) return null;
      return text;
    }, input);
  } else {
    if (!page.evaluate) unsupported('evaluate');
    serialized = await page.evaluate(async ({ expression, maxBytes }) => {
      const value: unknown = eval(`(${expression})`);
      const result: unknown = await (typeof value === 'function' ? value() : value);
      const text = JSON.stringify(result, null, 2) ?? 'undefined';
      if (text.length > maxBytes || new TextEncoder().encode(text).length > maxBytes) return null;
      return text;
    }, input);
  }
    if (serialized === null) throw new PlaywrightResourceLimitError('Playwright evaluation result byte limit exceeded');
  });
  const code = `await ${request.args[1] ? capabilityLocator(request.args[1], request) : 'page'}.evaluate(${JSON.stringify(expression)});`;
  if (request.options.filename && typeof serialized === 'string') return capabilityArtifact(request, new TextEncoder().encode(serialized), 'result', 'json', 'Evaluation result', () => code, request.options.filename as string);
  return capabilityResult(code, serialized ?? undefined);
} };

export const playwrightStandardAbilities: Partial<Record<PlaywrightCommand, PlaywrightAbility>> = {
  ...playwrightStorageAbilities,
  ...playwrightEventAbilities,
  ...playwrightModalAbilities,
  ...playwrightWebMCPAbilities,
  ...playwrightRecordingAbilities,
  ...playwrightRouteAbilities,
  drop: playwrightDrop,
  'tracing-start': playwrightTracingStart, 'tracing-stop': playwrightTracingStop,
  'go-back': navigation, 'go-forward': navigation, reload: navigation,
  type: keyboard, keydown: keyboard, keyup: keyboard,
  mousemove: mouse, mousedown: mouse, mouseup: mouse, mousewheel: mouse,
  dblclick: element, hover: element, select: element, check: element, uncheck: element, drag,
  eval: evaluate,
  'video-show-actions': { scope: 'session', options: 'all', async execute(request) {
    const screencast = requirePage(request).screencast;
    if (!screencast?.showActions) unsupported('native action annotations');
    const options: NonNullable<Parameters<typeof screencast.showActions>[0]> = {};
    if (request.options.duration !== undefined) options.duration = numeric(request.options.duration, 'annotation duration');
    const position = request.options.position;
    if (position !== undefined) {
      if (typeof position !== 'string' || !['top-left', 'top', 'top-right', 'bottom-left', 'bottom', 'bottom-right'].includes(position)) throw new Error('Invalid annotation position');
      options.position = position as NonNullable<typeof options.position>;
    }
    const cursor = request.options.cursor;
    if (cursor !== undefined) {
      if (cursor !== 'none' && cursor !== 'pointer') throw new Error('Invalid annotation cursor');
      options.cursor = cursor;
    }
    await screencast.showActions(options);
    return capabilityResult('', 'Action annotations enabled.');
  } },
  'video-hide-actions': { scope: 'session', async execute(request) {
    const screencast = requirePage(request).screencast;
    if (!screencast?.hideActions) unsupported('native action annotations');
    await screencast.hideActions();
    return capabilityResult('', 'Action annotations disabled.');
  } },
  'run-code': { scope: 'session', options: 'all', async execute(request) {
    const source = request.options.filename !== undefined
      ? new TextDecoder('utf-8', { fatal: true }).decode(await request.readFile(request.options.filename as string))
      : request.args[0];
    if (typeof source !== 'string' || !source.trim()) throw new Error('Code or --filename is required');
    const maxOutputBytes = request.limits?.maxCommandBytes ?? 1048576;
    if (new TextEncoder().encode(source).byteLength > maxOutputBytes) throw new PlaywrightResourceLimitError('Playwright code source byte limit exceeded');
    const session = requireSession(request);
    if (!session.executeCode) unsupported('native code execution');
    const page = requirePage(request);
    let output: string | undefined;
    await capabilityAction(request, async () => {
      const result = await session.executeCode!({ page, source, signal: request.signal,
        timeoutMs: request.limits?.actionTimeoutMs ?? 30000, maxOutputBytes, maxPages: request.limits?.maxPages ?? 16 });
      if (result !== undefined) {
        output = JSON.stringify(result);
        if (output !== undefined && new TextEncoder().encode(output).byteLength > maxOutputBytes) throw new PlaywrightResourceLimitError('Playwright code result byte limit exceeded');
      }
    });
    return capabilityResult(`await (${source})(page);`, output);
  } },
  resize: { scope: 'session', async execute(request) {
    const page = requirePage(request);
    if (!page.setViewportSize) unsupported('setViewportSize');
    const width = numeric(request.args[0], 'viewport width'), height = numeric(request.args[1], 'viewport height');
    if (![width, height].every(value => Number.isSafeInteger(value) && value > 0 && value <= 32768)) throw new Error('Invalid viewport size');
    await page.setViewportSize({ width, height });
    return capabilityResult(`await page.setViewportSize({ width: ${width}, height: ${height} });`);
  } },
  pdf: { scope: 'session', options: 'all', async execute(request) {
    const page = requirePage(request);
    if (!page.pdf) unsupported('pdf');
    return capabilityArtifact(request, await page.pdf(), 'page', 'pdf', 'PDF', filename => `await page.pdf({ path: ${JSON.stringify(filename)} });`, request.options.filename as string | undefined);
  } },
  'network-state-set': { scope: 'session', async execute(request) {
    const context = requireSession(request).context;
    if (!context.setOffline) unsupported('setOffline');
    const state = request.args[0];
    if (state !== 'online' && state !== 'offline') throw new Error('Invalid network state');
    await context.setOffline(state === 'offline');
    return capabilityResult(`await page.context().setOffline(${state === 'offline'});`, `Network is now ${state}`);
  } },
};
