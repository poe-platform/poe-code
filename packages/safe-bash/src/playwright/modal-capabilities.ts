import { PlaywrightResourceLimitError } from './resource-limit.js';
import type { PlaywrightAbility, PlaywrightAbilityRequest } from './abilities.js';
import type { PlaywrightContext, PlaywrightDialog, PlaywrightFileChooser, PlaywrightPage } from './adapter.js';
import type { PlaywrightCommand } from './catalog.js';
import { capabilityResult, requirePage, requireSession, unsupported } from './capability-result.js';
import { basename } from '../contracts/path.js';

export type PlaywrightModal = { kind: 'dialog'; dialog: PlaywrightDialog } | { kind: 'filechooser'; fileChooser: PlaywrightFileChooser };
interface ModalState { modal?: PlaywrightModal; listeners: Set<(modal: PlaywrightModal | undefined) => void> }
const pages = new WeakMap<object, ModalState>();
const contexts = new WeakSet<PlaywrightContext>();
function identity(page: PlaywrightPage): object { return page.mainFrame?.() ?? page; }

function state(page: PlaywrightPage): ModalState {
  const key = identity(page);
  let result = pages.get(key);
  if (!result) { result = { listeners: new Set() }; pages.set(key, result); }
  return result;
}

export function getPlaywrightModal(page: PlaywrightPage): PlaywrightModal | undefined { return pages.get(identity(page))?.modal; }
export function onPlaywrightModal(page: PlaywrightPage, listener: (modal: PlaywrightModal | undefined) => void): () => void {
  const current = state(page);
  current.listeners.add(listener);
  return () => { current.listeners.delete(listener); };
}
function update(page: PlaywrightPage, modal: PlaywrightModal | undefined): void {
  const current = state(page);
  if (modal) current.modal = modal;
  else delete current.modal;
  for (const listener of current.listeners) listener(modal);
}

export function observePlaywrightModals(context: PlaywrightContext, registerCleanup: (cleanup: () => Promise<void>) => void): void {
  if (contexts.has(context)) return;
  contexts.add(context);
  const observed = new Map<object, { page: PlaywrightPage; chooser: (chooser: PlaywrightFileChooser) => void; close: () => void }>();
  let closed = false;
  const attach = (page: PlaywrightPage) => {
    if (closed || observed.has(identity(page))) return;
    state(page);
    const chooser = (fileChooser: PlaywrightFileChooser) => { if (!closed) update(page, { kind: 'filechooser', fileChooser }); };
    const close = () => { update(page, undefined); };
    observed.set(identity(page), { page, chooser, close });
    page.on?.('filechooser', chooser);
    page.on?.('close', close);
  };
  const dialog = (dialog: PlaywrightDialog) => {
    const page = dialog.page();
    if (!closed && page) { attach(page); update(page, { kind: 'dialog', dialog }); }
  };
  const close = async () => {
    if (closed) return;
    closed = true;
    context.off('page', attach); context.off('dialog', dialog);
    for (const [key, { page, chooser, close }] of observed) {
      page.off?.('filechooser', chooser); page.off?.('close', close);
      update(page, undefined);
      pages.delete(key);
    }
    observed.clear(); contexts.delete(context);
  };
  registerCleanup(close);
  try {
    context.on('page', attach); context.on('dialog', dialog);
    for (const page of context.pages()) attach(page);
  } catch (error) { void close(); throw error; }
}

const dialog: PlaywrightAbility = { scope: 'session', async execute(request) {
  const page = requirePage(request);
  const modal = getPlaywrightModal(page);
  if (modal?.kind !== 'dialog') throw new Error('No dialog visible');
  if (request.command === 'dialog-accept') await modal.dialog.accept(request.args[0]);
  else await modal.dialog.dismiss();
  if (getPlaywrightModal(page) === modal) update(page, undefined);
  return capabilityResult('');
} };

export async function readPlaywrightFiles(request: PlaywrightAbilityRequest, paths: readonly string[]): Promise<{ name: string; mimeType: string; buffer: Uint8Array }[]> {
  const maximum = Math.min(request.limits?.maxArtifactBytes ?? 8 * 1024 * 1024, request.limits?.maxCommandBytes ?? 1048576);
  const files: { name: string; mimeType: string; buffer: Uint8Array }[] = [];
  let total = 0;
  for (const path of paths) {
    request.signal.throwIfAborted();
    const bytes = await request.readFile(path);
    total += bytes.byteLength;
    if (total > maximum) throw new PlaywrightResourceLimitError('Playwright upload byte limit exceeded');
    // Empty MIME delegates filename inference to the native Playwright provider.
    files.push({ name: basename(path), mimeType: '', buffer: bytes });
  }
  return files;
}

const upload: PlaywrightAbility = { scope: 'session', async execute(request) {
  const page = requirePage(request);
  const modal = getPlaywrightModal(page);
  if (modal?.kind !== 'filechooser') throw new Error('No file chooser visible');
  if (!modal.fileChooser.isMultiple() && request.args.length > 1) throw new Error('Non-multiple file input can only accept a single file');
  const session = requireSession(request);
  if (!session.prepareFileBytes) unsupported('native upload buffers');
  const files = await readPlaywrightFiles(request, request.args);
  request.signal.throwIfAborted();
  const nativeFiles = files.map(file => {
    const buffer = session.prepareFileBytes!(file.buffer);
    if (!(buffer instanceof Uint8Array) || buffer.byteLength !== file.buffer.byteLength) throw new Error('Invalid native Playwright file buffer');
    return { ...file, buffer };
  });
  await modal.fileChooser.setFiles(nativeFiles, { timeout: request.limits?.actionTimeoutMs ?? 30000 });
  if (getPlaywrightModal(page) === modal) update(page, undefined);
  return capabilityResult(`await fileChooser.setFiles(${JSON.stringify(request.args)})`);
} };

export const playwrightModalAbilities: Partial<Record<PlaywrightCommand, PlaywrightAbility>> = {
  'dialog-accept': dialog, 'dialog-dismiss': dialog,
  upload,
};
