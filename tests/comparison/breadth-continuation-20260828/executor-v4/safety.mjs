import { createHash } from 'node:crypto';

export const candidate = '67eab12e315054907ef4ef435c6bbca2f59e0c36';
export const pack = '6608d255828d1a4f3b2810ef6c32a2b0b57a9aaf0dd685597ce6725d381d6e06';
export function identity(value) {
  requireThat(value.candidate === candidate, 'CANDIDATE', value.candidate);
  requireThat(value.packSha256 === pack, 'PACK', value.packSha256);
}
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function requireThat(condition, code, detail) {
  if (!condition) throw Object.assign(new Error(`${code}: ${JSON.stringify(detail)}`), { code });
}
export function errorRecord(error) {
  return { name: error?.name ?? typeof error, code: error?.code ?? null, message: String(error?.message ?? error), stack: error?.stack ?? null, original: error?.original ?? (error?.cause ? { name: error.cause.name, code: error.cause.code, message: String(error.cause.message) } : null) };
}
export function relativeName(name) {
  requireThat(typeof name === 'string' && name.length > 0 && name.length <= 4096 && !name.includes('\\') && !name.includes('\0') && !name.startsWith('/') && name.split('/').every(part => part && part !== '.' && part !== '..'), 'PATH', name);
  requireThat(!name.split('/').some(part => part.toUpperCase() === 'AGENTS.MD'), 'INSTRUCTION', name);
  return name;
}
export async function settle({ body, dispose, emit = async () => {} }) {
  const errors = [];
  let primary;
  let hasPrimary = false;
  let value;
  let disposed = false;
  const record = (phase, error) => { if (!hasPrimary) { primary = error; hasPrimary = true; } errors.push({ phase, error: errorRecord(error) }); };
  const phase = async name => { try { await emit(name); } catch (error) { record(`emit:${name}`, error); } };
  try { value = await body(phase); } catch (error) { record('body', error); }
  finally {
    await phase('dispose-start');
    try { await dispose(); disposed = true; } catch (error) { record('dispose', error); }
    await phase('dispose-settled');
  }
  return { value, primary, hasPrimary, errors, disposed, safe: disposed && errors.length === 0 };
}
export function settled(receipt) {
  return receipt?.reaped === true && receipt?.exit?.code === 0 && receipt?.exit?.signal === null && receipt?.close?.code === 0 && receipt?.close?.signal === null && receipt?.signals?.length === 0 && receipt?.failures?.length === 0;
}
export async function serial(items, action, integrity) {
  const rows = [];
  let unsafe = false;
  for (const item of items) {
    if (unsafe) { rows.push({ id: item.id, status: 'UNRUN_UNSAFE_TAIL' }); continue; }
    let result;
    try {
      await integrity();
      result = await action(item);
      await integrity();
      requireThat(result?.safe === true, 'UNSAFE_RESULT', item.id);
      rows.push({ id: item.id, ...result, status: result.status ?? (result.pass ? 'QUALIFIED' : 'ORDINARY_ASSERTION_FAILED') });
    } catch (error) {
      unsafe = true;
      rows.push({ id: item.id, status: 'UNSAFE_STOP', error: errorRecord(error), result: result ?? null });
    }
  }
  return { rows, unsafe };
}
