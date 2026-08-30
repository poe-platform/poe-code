export const classification = 'SYNTHETIC_HELPER_CONTROL_NOT_PRODUCT';
export function command() {
  return { name: 'xan', async execute(context) {
    const iterator = context.stdin[Symbol.asyncIterator]();
    while (true) { const step = await iterator.next(); if (step.done) break; await context.stdout.write(step.value); }
    return { exitCode: 0 };
  } };
}
export async function boundary(kind, location) {
  if (kind === 'overflow') {
    const chunk = Buffer.alloc(65536, 97);
    for (let index = 0; index < 2; index++) if (!process.stdout.write(chunk)) await new Promise(resolve => process.stdout.once('drain', resolve));
    return { overflow: true };
  }
  if (kind === 'trace') {
    const chunk = Buffer.alloc(65536, 97);
    for (let index = 0; index < 80; index++) if (!process.stdout.write(chunk)) await new Promise(resolve => process.stdout.once('drain', resolve));
    return { traceBytes: 5242880 };
  }
  if (kind === 'denyload' || kind === 'sourcefallback') return import(location);
  if (kind === 'builtin') return import('node:child_process');
  if (kind === 'ambient') return process.getBuiltinModule('node:fs');
  if (kind === 'eval') return globalThis.eval('1 + 1');
  if (kind === 'timeout') await new Promise(() => { setInterval(() => {}, 1000); });
  if (kind === 'ordinary') { process.exitCode = 7; return { ordinary: true }; }
  return { valid: true };
}
