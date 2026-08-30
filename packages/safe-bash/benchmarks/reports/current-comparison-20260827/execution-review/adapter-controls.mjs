import { posix } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function adapterControls(execution, inputs) {
  const { observeExpanded } = await import(pathToFileURL(`${execution}/expanded.mjs`));
  const { observeBreadth } = await import(pathToFileURL(`${execution}/breadth.mjs`));
  const binary = Buffer.from([0, 127, 128, 255]);
  const results = [];
  for (const profile of ['original', 'aligned', 'breadth']) for (const engine of ['virtual-bash', 'just-bash']) {
    const ours = engine === 'virtual-bash';
    const configurations = profile === 'breadth' ? ['default', 'javascript', 'python', 'sqlite'] : ['default'];
    for (const configuration of configurations) {
      const entries = new Map([['/', { type: 'directory', mode: 0o755 }]]);
      const calls = [], phases = [], issues = [];
      const signal = new AbortController().signal;
      const check = (label, pass, detail) => { if (!pass) issues.push({ label, detail }); };
      class SyntheticFs {
        async mkdir(filename) {
          calls.push({ method: 'mkdir', filename });
          const parent = posix.dirname(filename);
          if (parent !== filename && !entries.has(parent)) await this.mkdir(parent);
          if (!entries.has(filename)) entries.set(filename, { type: 'directory', mode: 0o755 });
        }
        async chmod(filename, mode) { entries.get(filename).mode = mode; }
        async writeFile(filename, bytes) { entries.set(filename, { type: 'file', mode: 0o644, bytes: Buffer.from(bytes) }); }
        async utimes(filename, access, modified) { calls.push({ method: 'utimes', filename, access, modified, dateObjects: access instanceof Date && modified instanceof Date }); }
        async lstat(filename) {
          const value = entries.get(filename);
          if (!value) throw new Error(`missing synthetic entry ${filename}`);
          return { type: value.type, mode: value.mode, size: value.bytes?.length ?? 0, isDirectory: value.type === 'directory', isFile: value.type === 'file', isSymbolicLink: value.type === 'symlink' };
        }
        async readdir(filename) {
          const names = [...entries.keys()].filter(name => name !== filename && posix.dirname(name) === filename).map(name => posix.basename(name));
          return ours ? names.map(name => ({ name })) : names;
        }
        async readFile(filename, options) { calls.push({ method: 'readFile', filename, suppliedSignal: options?.signal === signal }); return Buffer.from(entries.get(filename).bytes); }
        async readFileBuffer(filename) { return Buffer.from(entries.get(filename).bytes); }
        async symlink(target, filename) { entries.set(filename, { type: 'symlink', mode: 0o777, target }); }
        async readlink(filename) { return entries.get(filename).target; }
      }
      class SyntheticRegistry { list() { return [{ name: 'independent-synthetic-only' }]; } }
      class SyntheticShell {
        constructor(options) { this.options = options; this.commands = options.commands ?? new SyntheticRegistry(); calls.push({ method: 'constructor', options }); }
        use(plugin) { calls.push({ method: 'use', plugin }); return this; }
        async exec(script, options) {
          calls.push({ method: 'exec', script, options: { ...options, signal: options.signal === signal, stdin: options.stdin === undefined ? null : Buffer.from(options.stdin, typeof options.stdin === 'string' ? 'latin1' : undefined).toString('base64') } });
          if (script) await this.options.fs.writeFile('/fixture/output', binary);
          return { exitCode: 0, stdout: ours ? binary.toString('utf8') : binary.toString('latin1'), stderr: 'é', stdoutBytes: binary, stderrBytes: Buffer.from('é') };
        }
        async dispose() { calls.push({ method: 'dispose' }); }
      }
      const library = { createMemoryFileSystem: () => new SyntheticFs(), InMemoryFs: SyntheticFs, CommandRegistry: SyntheticRegistry, Shell: SyntheticShell, Bash: SyntheticShell, agentCommands: () => 'agentCommands-synthetic-token', stdoutAsBytes: () => binary.toString('latin1'), latin1FromBytes: value => value };
      const mark = async (phase, detail) => { phases.push({ phase, detail }); };
      const specimen = { id: 'independent-adapter-not-a-cohort-case', script: 'independent-synthetic', effectiveScript: 'independent-synthetic', cwd: '/fixture', directories: [], symlinks: {}, env: { REVIEW_ONLY: 'bound' }, stdin: binary.toString('base64'), stdinBase64: binary.toString('base64'), fileModes: { input: 0o600 }, fileTimes: {}, files: profile === 'breadth' ? { input: { base64: binary.toString('base64'), mode: 0o600 } } : { input: binary.toString('base64') }, configuration, modes: true };
      let result;
      try {
        result = profile === 'breadth' ? await observeBreadth({ library, engine, specimen, inputs, signal, mark }) : await observeExpanded({ library, engine, specimen, profile, signal, mark });
        const required = ['exec-start', 'exec-settled', 'snapshot-complete', 'dispose-start', 'dispose-settled'];
        const actual = phases.map(event => event.phase).filter(phase => required.includes(phase));
        check('actual adapter lifecycle matches supervisor order', JSON.stringify(actual) === JSON.stringify(required), actual);
        const constructor = calls.find(call => call.method === 'constructor').options;
        check('cwd bound', constructor.cwd === '/fixture');
        check('TMPDIR profile exact', profile === 'original' ? !Object.hasOwn(constructor.env, 'TMPDIR') : constructor.env.TMPDIR === '/tmp', constructor.env);
        check('scratch setup exact', entries.has('/tmp') === (profile !== 'original'));
        check('agentCommands exactly once or absent on baseline', calls.filter(call => call.method === 'use').length === (ours ? 1 : 0));
        const guest = calls.filter(call => call.method === 'exec' && call.script)[0];
        check('one literal synthetic guest call and stdin bytes', calls.filter(call => call.method === 'exec' && call.script).length === 1 && guest.options.stdin === binary.toString('base64') && guest.options.signal === true);
        if (!ours) check('baseline public exec options', guest.options.replaceEnv === true && guest.options.rawScript === true && guest.options.stdinKind === 'bytes');
        check('real dispose only for ours', calls.filter(call => call.method === 'dispose').length === (ours ? 1 : 0));
        if (profile === 'breadth') {
          check('complete before/after census', result.before?.complete && result.after?.complete, result);
          check('raw stdout and VFS binary preservation', result.result.stdoutBase64 === binary.toString('base64') && result.after.entries.find(entry => entry.path === '/fixture/output')?.base64 === binary.toString('base64'));
          check('breadth infrastructure exact', entries.has('/home/user') && !entries.has('/fixture/tmp'));
          const selected = inputs.configurations[ours ? 'ours' : 'baseline'][configuration];
          check('optional configuration forwarded, not emulated', ours ? constructor.limits === inputs.configurations.ours.default.limits : JSON.stringify(constructor.executionLimits) === JSON.stringify(selected.executionLimits) && constructor.javascript === selected.javascript && constructor.python === selected.python);
        } else {
          check('raw public result retained as documented', result.raw?.stdoutBase64 === binary.toString('base64') && result.raw?.stderrBase64 === Buffer.from('é').toString('base64'), result.raw ?? null);
          check('scored stdout and VFS binary preservation', result.stdout === binary.toString('base64') && result.entries.output?.bytes === binary.toString('base64'));
          check('fixed file time public API shape', calls.some(call => call.method === 'utimes' && call.dateObjects === !ours));
          check('separate initialization count', calls.filter(call => call.method === 'exec' && !call.script).length === (ours ? 1 : 0));
        }
      } catch (error) { issues.push({ label: 'adapter threw', detail: String(error.stack ?? error) }); }
      results.push({ profile, engine, configuration, syntheticLibraryOnly: true, productImports: 0, phases, issues, calls, result });
    }
  }
  return results;
}
