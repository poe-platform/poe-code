import assert from 'node:assert/strict';

export async function createExecutor(api) {
  const { chunks, collector, quote } = await import('../jq-42-independent-review/harness.ts');
  const { createStructuredCommands, MemoryFileSystem, Shell, structuredCommands } = api;
  const limits = { maxInputBytes: 65536, maxOutputBytes: 65536, maxValueBytes: 32768, maxResults: 4096, maxSteps: 100000 };
  async function* inputChunks(inputHex, transport) {
    const bytes = Buffer.from(inputHex, 'hex');
    if (transport === 'split:0' || transport === `split:${bytes.length}`) {
      const offset = Number(transport.slice(6));
      yield bytes.subarray(0, offset);
      yield bytes.subarray(offset);
    } else {
      yield* chunks(bytes, transport);
    }
  }
  async function filesystem(vector) {
    const fs = new MemoryFileSystem();
    for (const [name, hex] of Object.entries(vector.files ?? {})) {
      assert.match(name, /^[a-zA-Z0-9_.-]+$/u);
      assert.ok(name !== '.' && name !== '..');
      await fs.writeFile(`/${name}`, Buffer.from(hex, 'hex'));
    }
    return fs;
  }
  async function effects(fs, vector) {
    const expectedNames = Object.keys(vector.files ?? {}).sort();
    const actualNames = (await fs.readdir('/')).map(entry => entry.name).sort();
    assert.deepEqual(actualNames, expectedNames, 'unexpected VFS namespace mutation');
    return Object.fromEntries(await Promise.all(expectedNames.map(async name => [name, Buffer.from(await fs.readFile(`/${name}`, { maxBytes: 65536 })).toString('hex')])));
  }
  async function direct(vector, argv, inputHex, transport) {
    const fs = await filesystem(vector);
    const stdout = collector();
    const stderr = collector();
    const command = createStructuredCommands({ limits }).find(definition => definition.name === 'jq');
    assert.ok(command, 'public factory exposes jq');
    const result = await command.execute({ command: 'jq', args: argv, fs, cwd: '/', env: {}, stdin: inputChunks(inputHex, transport),
      stdinIsDefault: false, stdout: stdout.sink, stderr: stderr.sink, signal: AbortSignal.timeout(1500) });
    return { actual: { status: result.exitCode, stdoutHex: stdout.hex(), stderrHex: stderr.hex() }, afterFiles: await effects(fs, vector) };
  }
  return async function execute(vector, route, transport) {
    if (route === 'direct') {
      if (!vector.stages) return direct(vector, vector.argv, vector.inputHex, transport);
      let inputHex = vector.inputHex;
      const stages = [];
      const stageEffects = [];
      for (const [index, stage] of vector.stages.entries()) {
        const result = await direct(vector, stage.argv, inputHex, index === 0 ? transport : 'whole');
        stages.push(result.actual);
        stageEffects.push(result.afterFiles);
        inputHex = result.actual.stdoutHex;
      }
      return { actual: { status: stages.at(-1).status, stdoutHex: inputHex, stderrHex: stages.map(stage => stage.stderrHex).join('') },
        stages, stageEffects, afterFiles: stageEffects.at(-1) };
    }
    assert.equal(route, 'shell');
    const fs = await filesystem(vector);
    const stdout = collector();
    const stderr = collector();
    const script = (vector.stages ?? [{ argv: vector.argv }]).map(stage => ['jq', ...stage.argv.map(quote)].join(' ')).join(' | ');
    const shell = new Shell({ fs, cwd: '/', env: {}, limits: { maxOutputBytes: 65536, pipeHighWaterMark: 1 } }).use(structuredCommands({ limits }));
    const result = await shell.exec(script, { stdin: inputChunks(vector.inputHex, transport), stdout: stdout.sink, stderr: stderr.sink, signal: AbortSignal.timeout(1500) });
    return { actual: { status: result.exitCode, stdoutHex: stdout.hex(), stderrHex: stderr.hex() }, afterFiles: await effects(fs, vector) };
  };
}

export function compare(vector, route, observed) {
  const differingFields = ['status', 'stdoutHex', 'stderrHex'].filter(field => observed.actual[field] !== vector.expected[field]);
  const expectedStages = vector.stages?.map(stage => ({ status: stage.expected.status, stdoutHex: stage.expected.stdoutHex, stderrHex: stage.expected.stderrHex }));
  const stageCountMatches = route !== 'direct' || !expectedStages || observed.stages?.length === expectedStages.length;
  const stageDifferences = observed.stages?.flatMap((stage, index) => {
    const expected = expectedStages?.[index];
    return !expected || ['status', 'stdoutHex', 'stderrHex'].some(field => stage[field] !== expected[field]) ? [index] : [];
  }) ?? [];
  const effectsMatch = !Object.hasOwn(vector, 'afterFiles') || JSON.stringify(observed.afterFiles) === JSON.stringify(vector.afterFiles);
  const stageEffectsMatch = !Object.hasOwn(vector, 'afterFiles') || (observed.stageEffects ?? []).every(effects => JSON.stringify(effects) === JSON.stringify(vector.afterFiles));
  return { differingFields, stageDifferences, stageCountMatches, effectsMatch, stageEffectsMatch,
    pass: differingFields.length === 0 && stageDifferences.length === 0 && stageCountMatches && effectsMatch && stageEffectsMatch };
}
