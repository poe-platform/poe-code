import {FsError, type CommandContext, type OutputOperation, type FileStaging} from 'safe-bash-contracts';
import {fileSource} from './file-source.js';
import {createLlmSpool} from './retained-spool.js';
import {isPythonWhitespace} from './python-whitespace.js';

let serial = 0;

/** Invoke only the caller's virtual editor and conditionally remove its scratch file. */
export async function editChatPrompt(options: {context: CommandContext; operation: OutputOperation; admit(bytes: number, materialized: boolean): void}) {
  const {context, operation} = options, {fs, signal} = context;
  if (!context.invoke) throw new Error('Chat editor is not configured');
  if (!fs.createStagedFile || !fs.removeFileConditional) throw new FsError('ENOTSUP', {message: 'Chat editing requires caller staging and conditional cleanup'});
  const parent = await fs.stat(context.cwd, {signal});
  let staging: FileStaging | undefined;
  for (let attempt = 0; attempt < 16; attempt++) {
    try {
      staging = await operation.acquire(() => fs.createStagedFile!(`${context.cwd === '/' ? '' : context.cwd}/.llm-edit-${++serial}`,
        'prompt.txt', {type: 'file', data: new Uint8Array(0)}, {parent, mode: 0o600, retainCleanup: true, signal}), async value => {
          try {await value.cleanup?.remove();} finally {await value.cleanup?.close();}
        });
      break;
    } catch (error) {signal.throwIfAborted(); if (!(error instanceof FsError) || error.code !== 'EEXIST') throw error;}
  }
  if (!staging?.writer || !staging.cleanup) throw new FsError('ENOTSUP', {message: 'Chat editor staging needs retained handles'});
  const owned = staging;
  const initial = await owned.writer!.finish({signal});
  const path = owned.file.path;
  let expected = initial, failed = false;
  const cleanup = async () => {
    try {expected = await fs.lstat(path);}
    catch (error) {if (error instanceof FsError && error.code === 'ENOENT') return; throw error;}
    await fs.removeFileConditional!(path, {parent: owned.directory.stat, expected});
  };
  try {
    const editor = context.env.VISUAL || context.env.EDITOR || 'vi';
    const result = await context.invoke('sh', ['-c', editor + ' "$1"', 'llm-chat-editor', path], {
      signal, cwd: context.cwd, env: context.env, replaceEnv: true,
      stdin: context.stdin, stdout: context.stdout, stderr: context.stderr, externalInvocation: true,
    });
    signal.throwIfAborted();
    if (result.exitCode !== 0) throw new Error('Editing failed!');
    expected = await fs.lstat(path, {signal});
    if (expected.type !== 'file') throw new FsError('EINVAL', {path});
    if (expected.mtimeMs === initial.mtimeMs) return undefined;
    const source = await operation.acquire(() => fileSource({fs, path, signal, expectedStat: expected}), value => value.dispose());
    const raw = await operation.acquire(() => createLlmSpool(fs, context.cwd, signal, 'input'), value => value.close());
    const decoder = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}), encoder = new TextEncoder();
    let offset = 0, start = -1, end = 0;
    const inspect = (text: string) => {for (const char of text) {
      const size = encoder.encode(char).length;
      if (!isPythonWhitespace(char)) {if (start < 0) start = offset; end = offset + size;}
      offset += size;
    }};
    try {
      for await (const bytes of source.bytes) {options.admit(bytes.length, false); await raw.write(bytes); inspect(decoder.decode(bytes, {stream: true}));}
      inspect(decoder.decode());
    } finally {await source.dispose();}
    const trimmed = await operation.acquire(() => createLlmSpool(fs, context.cwd, signal, 'input'), value => value.close());
    try {if (start >= 0) for await (const bytes of raw.replay(async () => ({start, end}))) await trimmed.write(bytes);}
    finally {await raw.close();}
    return trimmed;
  } catch (error) {failed = true; throw error;}
  finally {await cleanup().catch(error => {if (!failed) throw error;});}
}
