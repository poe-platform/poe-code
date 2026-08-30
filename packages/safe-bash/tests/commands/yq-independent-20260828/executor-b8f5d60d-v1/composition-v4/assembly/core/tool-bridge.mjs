import { dirname, join } from 'node:path';
import { existsSync, lstatSync } from 'node:fs';
import { assertTree, canonical, canonicalPath, fileDigest, inside, keys, minimum, milliseconds, now, parseJson, readRegular, requireFact } from './primitives.mjs';
import { startOwned } from './owned-process.mjs';
import { validateBuildConfig } from './build-adapter.mjs';

export function cleanEnvironment(home, temporary) {
  return { LANG: 'C', LC_ALL: 'C', TZ: 'UTC', HOME: home, TMPDIR: temporary, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_ATTR_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', GIT_NO_REPLACE_OBJECTS: '1', GIT_NO_LAZY_FETCH: '1', GIT_ALLOW_PROTOCOL: '', GIT_CONFIG_COUNT: '0', GIT_EXEC_PATH: home };
}
export class ToolBridge {
  constructor(admission, counters) { this.admission = admission; this.counters = counters; this.active = false; }
  async run(call, context) {
    requireFact(!this.active, 'NESTED_TOOL_CONCURRENCY');
    const tools = this.admission.root.toolchain;
    let executable;
    let argv;
    let limit;
    let timeout;
    if (call.kind === 'compiler') {
      keys(call, ['kind', 'configPath', 'timeoutMs']);
      requireFact([60000, 120000].includes(call.timeoutMs), 'COMPILER_TIMEOUT_PROFILE');
      requireFact(call.timeoutMs === (context.job.phase === 'BUILD' ? 120000 : 60000), 'COMPILER_ROLE');
      requireFact(['BUILD', 'TYPES'].includes(context.job.phase), 'COMPILER_PHASE');
      canonicalPath(call.configPath);
      requireFact(inside(context.request.scratchRoot, call.configPath) && lstatSync(call.configPath).isFile(), 'COMPILER_CONFIG_PATH');
      const configHash = fileDigest(call.configPath).sha256;
      if (context.job.phase === 'TYPES') {
        const enrollment = context.generated.find(entry => entry.configPath === call.configPath);
        requireFact(enrollment, 'TYPE_CONFIG_NOT_ENROLLED');
        assertTree(enrollment.root, enrollment.manifest);
      }
      if (context.job.phase === 'BUILD') {
        validateBuildConfig(call, context);
        assertTree(context.request.bindings.sourceRoot, context.request.bindings.sourceManifest);
        assertTree(tools.root, tools.manifest, { fileBytes: 134217728, treeBytes: 536870912, entries: 4096 });
      } else {
        const config = parseJson(readRegular(call.configPath));
        requireFact(!Object.hasOwn(config, 'extends') && !Object.hasOwn(config, 'references') && Array.isArray(config.files) && config.files.length > 0 && !Object.hasOwn(config, 'include') && !Object.hasOwn(config, 'exclude'), 'SCOPED_COMPILER_CONFIG');
        requireFact(config.compilerOptions?.module === 'NodeNext' && config.compilerOptions?.moduleResolution === 'NodeNext' && config.compilerOptions?.strict === true && config.compilerOptions?.skipLibCheck === (context.job.phase === 'BUILD') && !config.compilerOptions?.plugins && !config.compilerOptions?.paths && !config.compilerOptions?.baseUrl, 'COMPILER_OPTIONS');
        const allowedOptions = ['target', 'lib', 'module', 'moduleResolution', 'strict', 'noUncheckedIndexedAccess', 'exactOptionalPropertyTypes', 'verbatimModuleSyntax', 'forceConsistentCasingInFileNames', 'skipLibCheck', 'types', 'typeRoots', 'rootDir', 'outDir', 'declaration', 'declarationMap', 'sourceMap', 'noEmit', 'allowJs', 'checkJs', 'pretty', 'incremental'];
        requireFact(Object.keys(config.compilerOptions).every(key => allowedOptions.includes(key)) && config.compilerOptions.noUncheckedIndexedAccess === true && config.compilerOptions.exactOptionalPropertyTypes === true, 'SCOPED_COMPILER_OPTIONS');
        requireFact(Array.isArray(config.compilerOptions.typeRoots) && config.compilerOptions.typeRoots.length > 0 && config.compilerOptions.typeRoots.every(root => inside(tools.root, canonicalPath(root))), 'EXPLICIT_TYPE_ROOTS');
        if (context.job.phase === 'BUILD') requireFact(inside(context.request.scratchRoot, config.compilerOptions.outDir) && config.compilerOptions.rootDir === join(context.request.bindings.sourceRoot, 'src'), 'BUILD_OUTPUT_SCOPE');
        else requireFact(config.compilerOptions.noEmit === true && !config.compilerOptions.outDir && !config.compilerOptions.rootDir, 'TYPE_NO_EMIT');
        assertTree(tools.root, tools.manifest, { fileBytes: 134217728, treeBytes: 536870912, entries: 4096 });
        const permitted = [context.request.scratchRoot, context.request.bindings.sourceRoot, context.request.bindings.sourceBuiltRoot, tools.root].filter(Boolean);
        for (const filename of config.files) { canonicalPath(filename); requireFact(permitted.some(root => inside(root, filename)), 'COMPILER_FILE_ESCAPE'); }
      }
      for (const start of [context.request.scratchRoot, context.request.bindings.sourceRoot, context.request.bindings.sourceBuiltRoot].filter(Boolean)) {
        let current = start;
        while (true) {
          const modules = join(current, 'node_modules');
          requireFact(!existsSync(modules) || inside(tools.root, modules), 'AMBIENT_COMPILER_NODE_MODULES');
          const parent = dirname(current);
          if (parent === current) break;
          current = parent;
        }
      }
      requireFact(++this.counters.compilers <= 18 && ++context.compilers <= (context.job.maxCompilerDescendants ?? 1), 'COMPILER_COUNT');
      executable = join(tools.root, tools.node);
      argv = [join(tools.root, tools.typescript, 'lib/tsc.js'), '--project', call.configPath, '--pretty', 'false'];
      limit = 8388608;
      timeout = call.timeoutMs;
      context.phase.record('compiler-config', { path: call.configPath, sha256: configHash, argv });
    } else {
      keys(call, ['kind', 'revision', 'path']);
      requireFact(['git-show', 'git-tree'].includes(call.kind) && context.job.phase === 'AUTHENTICATION', 'GIT_ROLE');
      requireFact(this.admission.recipe.origins === undefined, 'UNDECLARED_ORIGINS');
      const origins = context.request.bindings.toolRequests;
      requireFact(origins.some(entry => entry.revision === call.revision && entry.path === call.path), 'GIT_SELECTED_OBJECT');
      requireFact(/^[0-9a-f]{40}$/u.test(call.revision), 'GIT_REVISION');
      requireFact(++context.git <= 32768 && ++this.counters.git <= 11010048, 'GIT_COUNT');
      executable = join(tools.root, tools.git);
      const prefix = ['--no-pager', '--no-optional-locks', '-c', 'core.hooksPath=/dev/null', '-c', 'core.attributesFile=/dev/null', '-C', this.admission.root.repository];
      argv = call.kind === 'git-show' ? [...prefix, 'show', '--no-ext-diff', '--no-textconv', `${call.revision}:${call.path}`] : [...prefix, 'ls-tree', '-rz', call.revision, '--', call.path];
      timeout = 30000;
      limit = 16777216;
    }
    requireFact(canonical(fileDigest(executable, 134217728)) === canonical(tools.manifest.files[call.kind === 'compiler' ? tools.node : tools.git]), 'TOOL_CHANGED');
    const workDeadline = minimum(BigInt(context.request.deadline.workNs), now() + milliseconds(timeout));
    requireFact(workDeadline + milliseconds(5000) <= BigInt(context.request.deadline.jobNs), 'TOOL_CLEANUP_RESERVE');
    this.active = true;
    try {
      const startedNs = now().toString();
      const environment = call.kind === 'compiler' ? { LANG: 'C', LC_ALL: 'C' } : cleanEnvironment(context.home, context.temporary);
      const owner = startOwned({ role: 'tool', executable, argv, cwd: context.request.scratchRoot, env: environment, directory: context.request.evidenceRoot, name: `tool-${context.tools++}`, ipc: false, captureLimit: limit, budget: context.rawBudget, workDeadline, hardDeadline: minimum(BigInt(context.request.deadline.jobNs), workDeadline + milliseconds(5000)) });
      const receipt = await owner.done;
      requireFact(canonical(fileDigest(executable, 134217728)) === canonical(tools.manifest.files[call.kind === 'compiler' ? tools.node : tools.git]), 'TOOL_POST_CHANGED');
      if (call.kind === 'compiler') assertTree(tools.root, tools.manifest, { fileBytes: 134217728, treeBytes: 536870912, entries: 4096 });
      receipt.provenance = { argv, cwd: context.request.scratchRoot, executable: { path: executable, sha256: fileDigest(executable, 134217728).sha256 }, typescript: call.kind === 'compiler' ? context.request.bindings.toolProfile.typescript : null, environment, startedNs, endedNs: receipt.endedNs, reapedNs: receipt.reaped ? now().toString() : null, overflow: receipt.overflow };
      context.phase.record('tool-reaped', receipt);
      if (!receipt.reaped || receipt.timedOut || receipt.overflow || receipt.signal || receipt.spawnError) context.toolFailure = true;
      return receipt;
    } finally { this.active = false; }
  }
}
