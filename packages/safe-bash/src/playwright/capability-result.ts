import type { PlaywrightAbilityRequest } from './abilities.js';
import type { PlaywrightCommandResult, PlaywrightResultSection } from './response.js';
import { playwrightArtifactName, playwrightCodeString } from './response.js';
import { isPlaywrightSnapshotRef } from './targets.js';
import type { PlaywrightSessionConfiguration } from './session-configuration.js';
import type { PlaywrightCodegenAction } from './adapter.js';
import { PlaywrightResourceLimitError } from './resource-limit.js';

let artifactSequence = 0;

export function capabilityResult(code: string, text?: string): PlaywrightCommandResult {
  const sections: PlaywrightResultSection[] = [];
  if (text !== undefined) sections.push({ title: 'Result', content: text });
  if (code) sections.push({ title: 'Ran Playwright code', content: code, codeframe: 'js' });
  return { sections };
}

export function capabilityActionCode(request: PlaywrightAbilityRequest, action: PlaywrightCodegenAction, fallback: string): string {
  const session = requireSession(request);
  const language = session.configuration?.codegen ?? 'typescript';
  if (language === 'none') return '';
  if (!session.generateActionCode) {
    if (language !== 'typescript') unsupported('native action code generation');
    return fallback;
  }
  const code = session.generateActionCode({ language, action });
  if (typeof code !== 'string' || new TextEncoder().encode(code).byteLength > (request.limits?.maxCommandBytes ?? 1048576)) throw new PlaywrightResourceLimitError('Playwright generated code byte limit exceeded');
  return code;
}

export function capabilityLocator(target: string, request?: PlaywrightAbilityRequest): string {
  if (request?.browserSession?.targetLocator) return request.browserSession.targetLocator(target);
  return `page.locator(${playwrightCodeString(isPlaywrightSnapshotRef(target) ? `aria-ref=${target}` : target)})`;
}

export function requireSession(request: PlaywrightAbilityRequest) {
  request.signal.throwIfAborted();
  if (!request.browserSession) throw new Error('An open browser session is required');
  return request.browserSession;
}

export function requirePage(request: PlaywrightAbilityRequest) {
  const page = requireSession(request).page;
  if (!page) throw new Error('No open browser tab');
  return page;
}

export async function capabilityAction(request: PlaywrightAbilityRequest, action: () => Promise<void>): Promise<void> {
  const session = requireSession(request);
  if (session.runAction) await session.runAction(action);
  else await action();
}

export function numeric(value: string | boolean | readonly string[] | undefined, name: string): number {
  if (typeof value !== 'string' || !value.trim() || !Number.isFinite(Number(value))) throw new Error(`Invalid ${name}`);
  return Number(value);
}

export function unsupported(name: string): never { throw new Error(`Playwright provider does not support ${name}`); }

export function capabilityArtifactName(prefix: string, extension: string, configuration?: PlaywrightSessionConfiguration): string {
  const generated = playwrightArtifactName(prefix, extension, ++artifactSequence);
  return capabilityOutputPath(generated.slice(generated.lastIndexOf('/') + 1), configuration);
}

/** Resolve a generated basename beneath the session's virtual output directory. */
export function capabilityOutputPath(basename: string, configuration?: PlaywrightSessionConfiguration): string {
  const directory = configuration?.outputDir ?? '.playwright-cli';
  return `${directory}${directory.endsWith('/') ? '' : '/'}${basename}`;
}

export async function capabilityArtifact(request: PlaywrightAbilityRequest, bytes: Uint8Array, prefix: string, extension: string, label: string, code: (filename: string) => string, filename?: string): Promise<PlaywrightCommandResult> {
  const name = filename ?? capabilityArtifactName(prefix, extension, request.browserSession?.configuration);
  await request.writeArtifact(bytes, name);
  return capabilityResult(code(name), `- [${label}](${name})`);
}
