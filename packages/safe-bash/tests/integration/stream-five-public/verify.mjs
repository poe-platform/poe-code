import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { release } from 'node:os';
import { isBuiltin } from 'node:module';

const repository = '/Users/kjopek/Workspace/safe-bash';
const owned = dirname(fileURLToPath(import.meta.url));
const sourceCommit = process.argv[2];
const output = resolve(process.argv[3] ?? '');
assert.match(sourceCommit ?? '', /^[a-f0-9]{40}$/u);
assert.ok(output.startsWith('/tmp/safe-bash-stream-five-public-verifier.') || output.startsWith('/private/tmp/safe-bash-stream-five-public-verifier.'));
assert.equal(existsSync(output), false, 'use a new immutable attempt directory');
const gate = readFileSync('/tmp/safe-bash-stream-five-public-review.ready', 'utf8');
assert.ok(gate.includes(sourceCommit));
assert.match(gate, /2919/u);
assert.match(gate, /CLOSED/u);
assert.match(gate, /root/iu);
mkdirSync(output, { recursive: true });
const digest = data => createHash('sha256').update(data).digest('hex');
const report = { started: new Date().toISOString(), sourceCommit, gate, gateSha256: digest(gate), output, node: process.version, platform: process.platform, arch: process.arch, osRelease: release(), steps: [], failures: [] };
const save = (name, value) => writeFileSync(join(output, name), JSON.stringify(value, null, 2) + '\n');
const node = realpathSync(process.execPath);
const npm = realpathSync(join(dirname(process.execPath), 'npm'));
const home = join(output, 'home');
mkdirSync(home);
const environment = { PATH: `${dirname(node)}:/usr/bin:/bin`, HOME: home, TMPDIR: output, LC_ALL: 'C', LANG: 'C', TZ: 'UTC', npm_config_userconfig: join(home, 'user.npmrc'), npm_config_globalconfig: join(home, 'global.npmrc'), npm_config_cache: join(output, 'empty-npm-cache'), npm_config_offline: 'true', npm_config_audit: 'false', npm_config_fund: 'false', npm_config_update_notifier: 'false' };
writeFileSync(environment.npm_config_userconfig, '');
writeFileSync(environment.npm_config_globalconfig, '');
report.environment = environment;
report.executables = [node, npm, '/usr/bin/tar', '/usr/bin/git', '/usr/bin/sandbox-exec'].map(path => ({ path, sha256: digest(readFileSync(path)) }));
const generalProfile = join(output, 'network-denied.sb');
writeFileSync(generalProfile, `(version 1) (allow default) (deny network*) (deny file-write* (subpath ${JSON.stringify(repository)}))\n`);
function run(label, executable, args, cwd = output, expected = 0, profile = generalProfile, timeout = 240000, raw = false) {
  const result = spawnSync(profile ? '/usr/bin/sandbox-exec' : executable, profile ? ['-f', profile, executable, ...args] : args, { cwd, env: environment, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout });
  const ordinal = String(report.steps.length + 1).padStart(2, '0');
  const stdout = `${ordinal}.stdout.log`;
  const stderr = `${ordinal}.stderr.log`;
  writeFileSync(join(output, stdout), result.stdout ?? '');
  writeFileSync(join(output, stderr), result.stderr ?? '');
  report.steps.push({ label, executable, args, cwd, profile, expected, status: result.status, signal: result.signal, error: result.error?.message, stdout, stderr });
  save('report.json', report);
  assert.equal(result.status, expected, `${label}: ${result.stderr}\n${result.stdout}`);
  assert.equal(result.signal, null);
  return raw ? result.stdout : result.stdout.trim();
}
function inventory(root, toolLinks = false) {
  const entries = [];
  function visit(directory) {
    for (const name of readdirSync(directory).sort()) {
      const filename = join(directory, name);
      const stat = lstatSync(filename);
      if (stat.isSymbolicLink()) {
        assert.ok(toolLinks && realpathSync(filename).startsWith(realpathSync(root) + sep), `escaping symlink ${filename}`);
        entries.push({ path: relative(root, filename), target: realpathSync(filename), sha256: digest(readFileSync(filename)) });
      } else if (stat.isDirectory()) visit(filename);
      else entries.push({ path: relative(root, filename), bytes: stat.size, sha256: digest(readFileSync(filename)) });
    }
  }
  visit(root);
  return { sha256: digest(JSON.stringify(entries)), entries };
}
function preflight(manifest) {
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies', 'bundledDependencies', 'bundleDependencies']) assert.equal(Object.keys(manifest[field] ?? {}).length, 0, `runtime closure ${field}`);
  for (const name of ['prepack', 'prepare', 'postpack', 'prepublish', 'prepublishOnly', 'publish', 'postpublish', 'preinstall', 'install', 'postinstall', 'prebuild', 'postbuild']) assert.equal(manifest.scripts?.[name], undefined, `LIFECYCLE_DENIED ${name}`);
}
let snapshot;
let consumer;
try {
  assert.equal(run('authenticate source commit', '/usr/bin/git', ['--no-replace-objects', 'rev-parse', `${sourceCommit}^{commit}`], repository, 0, null), sourceCommit);
  report.sourceTree = run('source tree binding', '/usr/bin/git', ['rev-parse', `${sourceCommit}:src`], repository, 0, null);
  report.harnessCommit = run('harness HEAD', '/usr/bin/git', ['rev-parse', 'HEAD'], repository, 0, null);
  report.indexBefore = run('preserve foreign index', '/usr/bin/git', ['diff', '--cached', '--name-only'], repository, 0, null);
  report.harness = inventory(owned);
  save('harness-manifest.json', report.harness);
  for (const entry of report.harness.entries) {
    const committed = run(`authenticate harness ${entry.path}`, '/usr/bin/git', ['show', `${report.harnessCommit}:tests/integration/stream-five-public/${entry.path}`], repository, 0, null, 240000, true);
    assert.equal(digest(committed), digest(readFileSync(join(owned, entry.path))));
  }
  snapshot = join(output, 'source-build');
  mkdirSync(snapshot);
  const archive = join(output, 'source.tar');
  run('git archive immutable source', '/usr/bin/git', ['--no-replace-objects', 'archive', '--format=tar', `--output=${archive}`, sourceCommit], repository, 0, null);
  report.archiveSha256 = digest(readFileSync(archive));
  run('extract isolated source', '/usr/bin/tar', ['-xf', archive, '-C', snapshot]);
  report.source = inventory(join(snapshot, 'src'));
  save('source-manifest.json', report.source);
  report.familyDocumentationDelta = run('record family documentation delta', '/usr/bin/git', ['diff', '--name-only', '72f780d0dbe73f71702c89c33d29aa614170c403', sourceCommit, '--', 'src/commands/stream-format', 'src/commands/split'], repository, 0, null);
  assert.equal(run('source algorithms unchanged from accepted release', '/usr/bin/git', ['diff', '72f780d0dbe73f71702c89c33d29aa614170c403', sourceCommit, '--', ':(glob)src/commands/stream-format/**/*.ts', ':(glob)src/commands/split/**/*.ts'], repository, 0, null), '');
  assert.match(readFileSync(join(snapshot, 'src/index.ts'), 'utf8'), /export type \{ RegexExecutionOptions \} from "\.\/commands\/regex-execution\/protocol\.js"/u);
  const manifest = JSON.parse(readFileSync(join(snapshot, 'package.json')));
  preflight(manifest);
  assert.equal(manifest.name, 'virtual-bash');
  assert.equal(manifest.scripts.build, 'tsc -p tsconfig.build.json');
  assert.equal(manifest.scripts['verify:release:qualified'], 'node scripts/verify-qualified-release.mjs');
  for (const name of ['stream-format', 'split']) assert.deepEqual(manifest.exports[`./commands/${name}`], { types: `./dist/commands/${name}/index.d.ts`, import: `./dist/commands/${name}/index.js` });
  const rejectedHooks = [];
  for (const hook of ['prepack', 'prepare', 'postpack', 'preinstall', 'install', 'postinstall']) {
    assert.throws(() => preflight({ ...manifest, scripts: { ...manifest.scripts, [hook]: 'node lifecycle-sentinel.mjs' } }), /LIFECYCLE_DENIED/u);
    rejectedHooks.push(hook);
  }
  report.lifecyclePreflight = { actualHooksAbsent: true, rejectedHooks };
  for (const name of ['typescript', '@types/node', 'undici-types']) cpSync(join(repository, 'node_modules', name), join(snapshot, 'node_modules', name), { recursive: true, dereference: true });
  mkdirSync(join(snapshot, 'node_modules/.bin'));
  symlinkSync('../typescript/bin/tsc', join(snapshot, 'node_modules/.bin/tsc'));
  report.buildTooling = inventory(join(snapshot, 'node_modules'), true);
  save('build-tooling.json', report.buildTooling);
  report.npmVersion = run('npm version', node, [npm, '--version']);
  report.compilerVersion = run('compiler version', node, [join(snapshot, 'node_modules/typescript/bin/tsc'), '--version']);
  run('actual isolated npm build', node, [npm, 'run', 'build'], snapshot);
  const distBefore = inventory(join(snapshot, 'dist'));
  const packed = JSON.parse(run('actual offline npm pack after hook preflight', node, [npm, 'pack', '--offline', '--ignore-scripts', '--json', '--pack-destination', output], snapshot));
  assert.equal(packed.length, 1);
  const tarball = join(output, packed[0].filename);
  report.tarball = { metadata: packed[0], sha256: digest(readFileSync(tarball)) };
  report.tarListing = run('tarball entry inventory', '/usr/bin/tar', ['-tzf', tarball]).split('\n');
  for (const filename of report.tarListing) assert.match(filename, /^package\/(?:dist\/[^]*|package\.json|README\.md|LICENSE)$/u);
  assert.equal(inventory(join(snapshot, 'dist')).sha256, distBefore.sha256);
  consumer = join(output, 'consumer-moved');
  mkdirSync(join(consumer, 'node_modules'), { recursive: true });
  const copiedTarball = join(consumer, 'package.tgz');
  copyFileSync(tarball, copiedTarball);
  assert.equal(digest(readFileSync(copiedTarball)), report.tarball.sha256);
  run('extract copied tarball outside source/repository', '/usr/bin/tar', ['-xzf', copiedTarball, '-C', join(consumer, 'node_modules')]);
  renameSync(join(consumer, 'node_modules/package'), join(consumer, 'node_modules/virtual-bash'));
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ name: 'independent-stream-five-consumer', private: true, type: 'module' }));
  const productRoot = join(consumer, 'node_modules/virtual-bash');
  const product = inventory(productRoot);
  report.product = product;
  save('package-inventory.json', product);
  preflight(JSON.parse(readFileSync(join(productRoot, 'package.json'))));
  for (const entry of product.entries) assert.ok(!/^(?:src|tests|node_modules)\//u.test(entry.path));
  const closure = [];
  const typescript = (await import(pathToFileURL(join(snapshot, 'node_modules/typescript/lib/typescript.js')).href)).default;
  const allowedBuiltins = new Set(['node:async_hooks', 'node:buffer', 'node:crypto', 'node:events', 'node:fs', 'node:fs/promises', 'node:http', 'node:https', 'node:net', 'node:path', 'node:stream', 'node:stream/promises', 'node:stream/web', 'node:timers/promises', 'node:url', 'node:util', 'node:worker_threads', 'node:zlib']);
  for (const entry of product.entries.filter(entry => entry.path.endsWith('.js') || entry.path.endsWith('.d.ts'))) {
    const text = readFileSync(join(productRoot, entry.path), 'utf8');
    const parsed = typescript.createSourceFile(entry.path, text, typescript.ScriptTarget.Latest, true);
    const specifiers = [];
    const visit = node => {
      if ((typescript.isImportDeclaration(node) || typescript.isExportDeclaration(node)) && node.moduleSpecifier) {
        assert.ok(typescript.isStringLiteral(node.moduleSpecifier));
        specifiers.push(node.moduleSpecifier.text);
      }
      if (typescript.isImportTypeNode(node)) {
        assert.ok(typescript.isLiteralTypeNode(node.argument) && typescript.isStringLiteral(node.argument.literal));
        specifiers.push(node.argument.literal.text);
      }
      if (typescript.isCallExpression(node) && (node.expression.kind === typescript.SyntaxKind.ImportKeyword || (typescript.isIdentifier(node.expression) && node.expression.text === 'require'))) {
        assert.ok(node.arguments[0] && typescript.isStringLiteral(node.arguments[0]), `nonliteral product import ${entry.path}`);
        specifiers.push(node.arguments[0].text);
      }
      typescript.forEachChild(node, visit);
    };
    visit(parsed);
    for (const specifier of specifiers) {
      if (isBuiltin(specifier)) assert.ok(allowedBuiltins.has(specifier.startsWith('node:') ? specifier : `node:${specifier}`), `uninspected builtin ${specifier}`);
      else {
        assert.ok(specifier.startsWith('.'), `external runtime/declaration import ${specifier}`);
        const target = resolve(dirname(join(productRoot, entry.path)), specifier);
        assert.ok(target.startsWith(join(productRoot, 'dist') + sep));
        assert.ok(existsSync(target), `missing closure ${target}`);
        if (entry.path.endsWith('.d.ts')) assert.ok(existsSync(target.replace(/\.js$/u, '.d.ts')));
      }
      closure.push({ parent: entry.path, specifier });
    }
  }
  report.closure = { edges: closure.length, sha256: digest(JSON.stringify(closure)) };
  save('closure.json', closure);
  for (const name of ['runtime.mjs', 'boundary.mjs', 'isolation-controls.mjs', 'fixtures.json', 'baseline60.json']) copyFileSync(join(owned, name), join(consumer, name));
  const templates = readdirSync(owned).filter(name => name.endsWith('.ts.txt'));
  for (const name of templates) copyFileSync(join(owned, name), join(consumer, name.slice(0, -4)));
  for (const name of ['typescript', '@types/node', 'undici-types']) cpSync(join(repository, 'node_modules', name), join(consumer, 'tooling/node_modules', name), { recursive: true, dereference: true });
  report.consumerTooling = inventory(join(consumer, 'tooling'));
  save('consumer-tooling.json', report.consumerTooling);
  symlinkSync(join(consumer, 'tooling/node_modules/typescript/lib/typescript.js'), join(consumer, 'external-module.js'));
  const profile = join(output, 'consumer-offline.sb');
  writeFileSync(profile, `(version 1) (allow default) (deny network*) (deny file-read* file-write* (subpath ${JSON.stringify(repository)}) (subpath ${JSON.stringify(realpathSync(snapshot))}))\n`);
  run('actual OS and resolver negative controls', node, ['--import', './boundary.mjs', 'isolation-controls.mjs', join(repository, 'src/index.ts'), join(snapshot, 'src/index.ts')], consumer, 0, profile);
  report.isolation = JSON.parse(readFileSync(join(consumer, 'isolation-results.json')));
  save('isolation-results.json', report.isolation);
  const compiler = join(consumer, 'tooling/node_modules/typescript/bin/tsc');
  const compilerOptions = { target: 'ES2023', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true, verbatimModuleSyntax: true, skipLibCheck: false, types: ['node'], typeRoots: [join(consumer, 'tooling/node_modules/@types')], outDir: './compiled' };
  writeFileSync(join(consumer, 'tsconfig.positive.json'), JSON.stringify({ compilerOptions, files: ['positive.ts'] }));
  run('strict root and subpath positive consumer', node, [compiler, '-p', 'tsconfig.positive.json', '--traceResolution'], consumer, 0, profile);
  run('compiled public factory consumer', node, ['--import', './boundary.mjs', 'compiled/positive.js'], consumer, 0, profile);
  report.typeNegatives = [];
  for (const template of templates.filter(name => name.startsWith('negative-'))) {
    const filename = template.slice(0, -4);
    writeFileSync(join(consumer, 'tsconfig.negative.json'), JSON.stringify({ compilerOptions: { ...compilerOptions, noEmit: true }, files: [filename] }));
    const diagnostics = run(`intended TS2322 ${filename}`, node, [compiler, '-p', 'tsconfig.negative.json'], consumer, 2, profile);
    assert.equal((diagnostics.match(/error TS\d+:/gu) ?? []).length, 1);
    assert.match(diagnostics, /error TS2322:/u);
    assert.ok(diagnostics.includes(`${filename}(`));
    report.typeNegatives.push({ filename, diagnostics });
  }
  let runtimeFailure;
  try { run('frozen F01-F11 and C controls packed runtime', node, ['--unhandled-rejections=strict', '--import', './boundary.mjs', 'runtime.mjs'], consumer, 0, profile); }
  catch (error) { runtimeFailure = error; }
  if (existsSync(join(consumer, 'runtime-results.json'))) {
    report.runtime = JSON.parse(readFileSync(join(consumer, 'runtime-results.json')));
    save('runtime-results.json', report.runtime);
  }
  copyFileSync(join(consumer, 'imports.ndjson'), join(output, 'imports.ndjson'));
  assert.equal(inventory(productRoot).sha256, product.sha256, 'packed product changed during checks');
  assert.equal(inventory(join(snapshot, 'src')).sha256, report.source.sha256);
  if (runtimeFailure) throw runtimeFailure;
  report.status = 'packed-pass-release-pending';
} catch (error) {
  report.status = 'fail';
  report.failures.push({ message: error.message, stack: error.stack });
} finally {
  report.finished = new Date().toISOString();
  save('report.json', report);
  console.log(JSON.stringify({ status: report.status, sourceCommit, output, runtime: report.runtime && { passed: report.runtime.passed, failed: report.runtime.failed }, failures: report.failures }, null, 2));
  process.exitCode = report.failures.length ? 1 : 0;
}
