export const classification = 'SYNTHETIC_FIXTURE_NOT_PRODUCT';

export function openFixtureReview() {
  const trace = async (spec, refs) => {
    const result = structuredClone(spec.expected);
    if (spec.expected.reasonChannel) result.reason = refs[spec.expected.reasonChannel];
    return result;
  };
  return {
    runShell: trace, runLifecycle: trace, runFilesystem: trace,
    async runResource(spec) { return { closed: true, intact: true, name: spec.name, independent: spec.independent, events: spec.events,
      configuredLimit: spec.configuredLimit, exitCode: spec.target > spec.configuredLimit ? 1 : 0, excessEffects: 0 }; },
    async runGuard(spec) { return { closed: true, intact: true, ioCalls: 0, refused: true, error: spec.errorName ? { name: spec.errorName, message: spec.message } : undefined }; },
    async dispose() {},
  };
}

export function createFixtureCommand(options) {
  if (options.classification !== classification) throw new Error('SYNTHETIC_MANIFEST_REQUIRED');
  const row = options.row;
  const decode = value => Buffer.from(value.utf8 ?? value.hex ?? value.base64, value.utf8 !== undefined ? 'utf8' : value.hex !== undefined ? 'hex' : 'base64');
  return {
    name: 'xan',
    async execute(context) {
      if (JSON.stringify(context.args) !== JSON.stringify(row.argv)) throw new Error('SYNTHETIC_ARGV_BINDING');
      context.registerCleanup(async () => {});
      if (!options.beforeIO && !['Z02', 'Z10'].includes(row.id)) {
        const iterator = context.stdin[Symbol.asyncIterator]();
        const retained = [];
        let delivered = 0;
        while (true) {
          const chunk = await iterator.next();
          if (chunk.done) break;
          retained.push(Buffer.from(chunk.value)); delivered += chunk.value.byteLength;
          if (options.headerEndByte && delivered >= options.headerEndByte) break;
        }
        if (!options.headerEndByte && !Buffer.concat(retained).equals(decode(row.stdin))) throw new Error('BORROWED_REUSE_CORRUPTION');
      }
      for (const [name, value] of Object.entries(row.expected.files)) {
        const original = row.files?.[name];
        if (original && decode(original).equals(decode(value))) continue;
        await context.fs.writeFile(`/work/${name}`, decode(value), { flag: original ? 'w' : 'wx', signal: context.signal });
      }
      await context.stdout.write(decode(row.expected.stdout));
      await context.stderr.write(options.diagnostic !== null ? Buffer.from(options.diagnostic) : decode(row.expected.stderr));
      return { exitCode: row.expected.status };
    },
  };
}
