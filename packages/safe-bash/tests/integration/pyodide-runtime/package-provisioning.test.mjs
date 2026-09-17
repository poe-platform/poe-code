import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { Worker } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { MemoryFileSystem } from 'poe-code/safe-fs/core';
import { Shell, agentCommands } from '../../../src/core.ts';
import { pythonCommands } from '../../../src/commands/python/index.ts';
import { createFetchTransport } from '../../../src/commands/network/fetch-transport.ts';

// Explicit real-runtime acceptance: excluded from ordinary .test.ts unit discovery.
// Runtime assets use the isolated, pinned npm install; package transport is real HTTPS.
function createWorker() {
  const worker = new Worker(`
    const { parentPort, workerData } = require('node:worker_threads');
    parentPort.once('message', async start => {
      try {
        const { register } = await import('tsx/esm/api'); register();
        const { runPythonWorker } = await import(workerData.runner);
        const { loadPyodide } = await import(workerData.loader);
        await runPythonWorker({ start, postMessage: value => parentPort.postMessage(value),
          loadRuntime: settings => loadPyodide({ ...settings, indexURL: new URL('.', workerData.loader).pathname }) });
      } catch (error) { parentPort.postMessage({ type: 'error', message: String(error) }); }
    });`, { eval: true, execArgv: [], workerData: {
    runner: new URL('../../../src/commands/python/worker.ts', import.meta.url).href,
    loader: new URL('./node_modules/pyodide/pyodide.mjs', import.meta.url).href,
  } });
  return {
    postMessage(value) { worker.postMessage(value); },
    subscribe(listener, error) {
      worker.on('message', listener); worker.on('error', error);
      return () => { worker.off('message', listener); worker.off('error', error); };
    },
    async terminate() { await worker.terminate(); },
  };
}

function memoryCache() {
  const entries = new Map();
  return {
    entries,
    async get(key) { return entries.get(key)?.slice(); },
    async set(key, value) { entries.set(key, value.slice()); },
  };
}

const documentScript = `
import importlib.metadata as metadata, importlib.resources as resources
import sys, io
from pathlib import Path
from docx import Document
from openpyxl import Workbook, load_workbook
import xlsxwriter
from pypdf import PdfReader
from fpdf import FPDF
import lxml.etree, PIL.Image
expected = {'python-docx':'1.2.0', 'lxml':'6.0.2', 'openpyxl':'3.1.5',
 'XlsxWriter':'3.2.9', 'pypdf':'6.18.1', 'fpdf2':'2.8.8', 'Pillow':'12.2.0',
 'fonttools':'4.65.0', 'defusedxml':'0.7.1', 'et-xmlfile':'2.0.0', 'typing-extensions':'4.16.0'}
for name, version in expected.items(): assert metadata.version(name) == version, (name, metadata.version(name))
assert sys.version_info[:3] == (3,14,2)
assert resources.files('docx').joinpath('templates/default.docx').read_bytes().startswith(b'PK')
doc = Document(); doc.add_paragraph('canonical package data'); doc.save('result.docx')
assert Document('result.docx').paragraphs[0].text == 'canonical package data'
book = Workbook(); book.active['A1'] = 42; book.save('result.xlsx')
assert load_workbook('result.xlsx').active['A1'].value == 42
with xlsxwriter.Workbook('writer.xlsx') as book: book.add_worksheet().write('A1', 'writer')
assert load_workbook('writer.xlsx').active['A1'].value == 'writer'
pdf = FPDF(); pdf.add_page(); pdf.set_font('Helvetica', size=12); pdf.cell(text='package provisioning'); pdf.output('result.pdf')
assert 'package provisioning' in PdfReader('result.pdf').pages[0].extract_text()
import local_helper
assert local_helper.answer == 42
import pypdf
pypdf._safe_bash_user_state = 'must not survive'
print('document profile verified')
`;

const wheelScript = `
from zipfile import ZipFile
files = {
 'provision_fixture/__init__.py': 'answer = 73\\n',
 'provision_fixture/payload.txt': 'wheel package data',
 'provision_fixture-1.0.dist-info/METADATA': 'Metadata-Version: 2.1\\nName: provision-fixture\\nVersion: 1.0\\nRequires-Dist: typing-extensions>=4.0\\n',
 'provision_fixture-1.0.dist-info/WHEEL': 'Wheel-Version: 1.0\\nGenerator: safe-bash-runtime-test\\nRoot-Is-Purelib: true\\nTag: py3-none-any\\n',
 'provision_fixture-1.0.dist-info/RECORD': '',
}
with ZipFile('provision_fixture-1.0-py3-none-any.whl', 'w') as wheel:
 for name, contents in files.items(): wheel.writestr(name, contents)
with ZipFile('conflict_fixture-1.0-py3-none-any.whl', 'w') as wheel:
 for name, contents in files.items():
  wheel.writestr(name.replace('provision_fixture', 'conflict_fixture'), contents.replace('provision-fixture', 'conflict-fixture').replace('typing-extensions>=4.0', 'typing-extensions<4.0'))
with ZipFile('extra_fixture-1.0-py3-none-any.whl', 'w') as wheel:
 for name, contents in files.items():
  wheel.writestr(name.replace('provision_fixture', 'extra_fixture'), contents.replace('provision-fixture', 'extra-fixture').replace('Requires-Dist: typing-extensions>=4.0', 'Provides-Extra: feature\\nRequires-Dist: six==1.17.0; extra == "feature"'))
with ZipFile('dependent_fixture-1.0-py3-none-any.whl', 'w') as wheel:
 for name, contents in files.items():
  wheel.writestr(name.replace('provision_fixture', 'dependent_fixture'), contents.replace('provision-fixture', 'dependent-fixture').replace('typing-extensions>=4.0', 'extra-fixture[feature]==1.0'))
with ZipFile('provision_fixture-2.0-py3-none-any.whl', 'w') as wheel:
 for name, contents in files.items():
  wheel.writestr(name.replace('fixture-1.0', 'fixture-2.0'), contents.replace('Version: 1.0', 'Version: 2.0') if name.endswith('/METADATA') else contents)
from pathlib import Path
Path('provision_fixture-1.0-cp314-cp314-macosx_14_0_arm64.whl').write_bytes(Path('provision_fixture-1.0-py3-none-any.whl').read_bytes())
Path('broken_fixture-1.0-py3-none-any.whl').write_bytes(b'not a wheel')
Path('bad wheels').mkdir(exist_ok=True)
Path('bad wheels/provision_fixture-1.0-py3-none-any.whl').write_bytes(b'not a wheel')
`;

test('real Pyodide package provisioning: documents, dependencies, canonical wheels, fresh-worker offline reuse and failures', async t => {
  const fs = new MemoryFileSystem();
  await fs.mkdir('/work'); await fs.mkdir('/tmp');
  const put = (path, value) => fs.writeFile('/work/' + path, new TextEncoder().encode(value));
  await put('documents.py', documentScript);
  await put('local_helper.py', 'answer = 42\n');
  await put('wheels.py', wheelScript);
  await put('requirements.txt', '# existing exact pin\npypdf==6.18.1\t# pinned dependency\ntyping-extensions==4.16.0 # comment ending in ' + String.fromCharCode(92) + '\n');
  const requests = [], progress = [], cache = memoryCache();
  const transport = createFetchTransport();
  let workers = 0;
  const options = {
    createWorker() { workers++; return createWorker(); },
    packageProfile: 'documents',
    provisioning: {
      cache,
      authorize: request => ['cdn.jsdelivr.net', 'pypi.org', 'files.pythonhosted.org'].includes(new URL(request.url).hostname),
      transport: request => { requests.push(request.url); return transport(request); },
      onProgress: event => progress.push(event),
    },
  };
  const shell = new Shell({ fs, cwd: '/work' }).use(agentCommands()).use(pythonCommands(options));
  const run = async (target, command) => {
    const result = await target.exec(command);
    assert.equal(result.exitCode, 0, command + '\n' + result.stderr);
    return result;
  };
  await t.test('ordinary shell startup stays lazy', async () => {
    await run(shell, 'echo ready');
    assert.equal(workers, 0); assert.equal(requests.length, 0);
  });
  await t.test('unconfigured missing imports fail without installing from import strings', async () => {
    const plain = new Shell({ fs, cwd: '/work' }).use(pythonCommands({ createWorker }));
    const result = await plain.exec(`python -c 'import safe_bash_unconfigured_missing_module'`);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /ModuleNotFoundError/);
    assert.equal(requests.length, 0);
  });
  await t.test('install profile with real native and pure wheels; use imports and package data', async () => {
    const result = await run(shell, 'python documents.py');
    assert.ok(result.stdout.includes('document profile verified'));
    assert.ok(requests.length > 0);
    assert.ok(progress.some(event => event.phase === 'download' && event.bytes > 0));
    assert.equal(new TextDecoder().decode((await fs.readFile('/work/result.pdf')).slice(0, 5)), '%PDF-');
    assert.deepEqual(Array.from((await fs.readFile('/work/result.docx')).slice(0, 2)), [80, 75]);
  });
  await t.test('requirements and canonical local compatible wheel retain dependencies', async () => {
    await run(shell, 'python -m pip install -r requirements.txt');
    await run(shell, 'python wheels.py');
    await run(shell, 'python -m pip install ./provision_fixture-1.0-py3-none-any.whl');
    const result = await run(shell, `python3 -c 'import provision_fixture, importlib.resources as r; assert provision_fixture.answer == 73; print(r.files("provision_fixture").joinpath("payload.txt").read_text())'`);
    assert.ok(result.stdout.includes('wheel package data'));
  });
  await t.test('matching native lxml wheel installs directly from canonical storage', async () => {
    const lock = JSON.parse(await readFile(new URL('./node_modules/pyodide/pyodide-lock.json', import.meta.url), 'utf8'));
    const native = lock.packages.lxml;
    const bytes = [...cache.entries.values()].find(value => createHash('sha256').update(value).digest('hex') === native.sha256);
    assert.ok(bytes, 'document installation must cache the actual matching native wheel');
    await fs.writeFile('/work/' + native.file_name, bytes);
    const nativeRequests = [];
    const nativeShell = new Shell({ fs, cwd: '/work' }).use(pythonCommands({
      createWorker, packages: ['./' + native.file_name], provisioning: {
        authorize: options.provisioning.authorize,
        transport: request => { nativeRequests.push(request.url); return transport(request); },
      },
    }));
    await run(nativeShell, `python -c 'from lxml import etree; assert etree.fromstring(b"<root><child/></root>")[0].tag == "child"'`);
    assert.ok(!nativeRequests.some(url => url.includes(native.file_name)), 'native wheel must come from canonical storage');
  });
  await t.test('requirements markers and relative wheel paths with spaces use canonical storage', async () => {
    await fs.mkdir('/work/wheels with spaces');
    await fs.writeFile('/work/wheels with spaces/provision_fixture-1.0-py3-none-any.whl', await fs.readFile('/work/provision_fixture-1.0-py3-none-any.whl'));
    await put('wheels with spaces/requirements.txt', './provision_fixture-1.0-py3-none-any.whl\npypdf==6.18.1; python_version >= "3.14"\nsafe-bash-must-not-fetch-marker==1.0; python_version < "3.0"\n');
    await run(shell, 'python -m pip install -r "wheels with spaces/requirements.txt"');
    assert.ok(!requests.some(url => url.includes('safe-bash-must-not-fetch-marker')));
    await run(shell, `python -c 'import provision_fixture; assert provision_fixture.answer == 73'`);
  });
  await t.test('named local wheel with extras installs its optional dependency and reuses it offline', async () => {
    const extraCache = memoryCache(), extraRequests = [];
    const extra = new Shell({ fs, cwd: '/work' }).use(pythonCommands({
      createWorker, packages: ['extra-fixture[feature] @ file:///work/extra_fixture-1.0-py3-none-any.whl'], provisioning: {
        cache: extraCache, authorize: options.provisioning.authorize,
        transport: request => { extraRequests.push(request.url); return transport(request); },
      },
    }));
    await run(extra, `python -c 'import extra_fixture, six; assert extra_fixture.answer == 73; assert six.__version__ == "1.17.0"'`);
    assert.ok(extraRequests.some(url => url.includes('six-1.17.0')));
    const offline = new Shell({ fs, cwd: '/work' }).use(pythonCommands({
      createWorker, provisioning: { cache: extraCache, offline: true },
    }));
    await run(offline, `python3 -c 'import extra_fixture, six; assert six.__version__ == "1.17.0"'`);
  });
  await t.test('adding an extra to a previously installed local distribution installs newly requested dependencies', async () => {
    const extra = new Shell({ fs, cwd: '/work' }).use(pythonCommands({
      createWorker, provisioning: { authorize: options.provisioning.authorize, transport },
    }));
    await run(extra, 'python -m pip install ./extra_fixture-1.0-py3-none-any.whl');
    await run(extra, `python -c 'import extra_fixture, importlib.util; assert importlib.util.find_spec("six") is None'`);
    await run(extra, `python -m pip install 'extra-fixture[feature] @ file:///work/extra_fixture-1.0-py3-none-any.whl'`);
    await run(extra, `python -c 'import extra_fixture, six; assert six.__version__ == "1.17.0"'`);
  });
  await t.test('transitive extra on a previously installed local distribution installs newly requested dependencies', async () => {
    const extra = new Shell({ fs, cwd: '/work' }).use(pythonCommands({
      createWorker, provisioning: { authorize: options.provisioning.authorize, transport },
    }));
    await run(extra, 'python -m pip install ./extra_fixture-1.0-py3-none-any.whl');
    await run(extra, `python -c 'import extra_fixture, importlib.util; assert importlib.util.find_spec("six") is None'`);
    await run(extra, 'python -m pip install ./dependent_fixture-1.0-py3-none-any.whl');
    await run(extra, `python -c 'import dependent_fixture, extra_fixture, six; assert six.__version__ == "1.17.0"'`);
  });
  await t.test('new plugin and fresh interpreters reuse cache offline without user state', async () => {
    let offlineRequests = 0;
    const offline = new Shell({ fs, cwd: '/work' }).use(agentCommands()).use(pythonCommands({
      ...options, provisioning: { ...options.provisioning, offline: true,
        transport: async () => { offlineRequests++; throw new Error('offline transport must not be used'); } },
    }));
    const count = requests.length;
    const result = await run(offline, `python -c 'import pypdf, provision_fixture, local_helper; assert not hasattr(pypdf, "_safe_bash_user_state"); assert provision_fixture.answer == 73; assert local_helper.answer == 42; print(pypdf.__version__)'`);
    assert.ok(result.stdout.includes('6.18.1'));
    assert.equal(offlineRequests, 0); assert.equal(requests.length, count);
  });
  await t.test('desktop wheels, corrupt wheels, missing packages, conflicts and unsupported pip options fail', async negative => {
    for (const [command, diagnostic] of [
      ['python -m pip install ./provision_fixture-1.0-cp314-cp314-macosx_14_0_arm64.whl', /wheel|platform|compatible|native/i],
      ['python -m pip install ./broken_fixture-1.0-py3-none-any.whl', /wheel|zip|corrupt|invalid/i],
      ['python -m pip install "./bad wheels/provision_fixture-1.0-py3-none-any.whl"', /wheel|zip|corrupt|invalid/i],
      ['python -m pip install safe-bash-deliberately-nonexistent-package-20260913==1.0', /not found|404|package|wheel/i],
      ['python -m pip install pypdf==5.0.0', /conflict|already|version|installed/i],
      ['python -m pip install ./provision_fixture-2.0-py3-none-any.whl', /conflict|already|version|installed/i],
      ['python -m pip install lxml==5.0.0', /conflict|already|version|installed|Can't find a pure Python 3 wheel/i],
      ['python -m pip install ./conflict_fixture-1.0-py3-none-any.whl', /conflict|already|version|installed|requirement/i],
      ['python -m pip install --upgrade pypdf', /unsupported|option/i],
      ['python -m pip install --no-index pypdf', /unsupported|option/i],
    ]) {
      await negative.test(command, async () => {
        const result = await shell.exec(command);
        assert.notEqual(result.exitCode, 0, command + ' falsely succeeded');
        assert.match(result.stderr, diagnostic, command);
      });
    }
    await run(shell, `python -c 'import pypdf, importlib.metadata as m; assert pypdf.__version__ == "6.18.1"; assert m.version("provision-fixture") == "1.0"'`);
  });
  await t.test('cancellation during real wheel download can retry without accepting partial bytes', async () => {
    const controller = new AbortController();
    let interrupted = false;
    const interruptedShell = new Shell({ fs, cwd: '/work' }).use(pythonCommands({
      createWorker, packages: ['six==1.17.0'], provisioning: {
        cacheDirectory: '/package-cache', authorize: options.provisioning.authorize,
        transport: async request => {
          const response = await transport(request);
          if (request.url.includes('six-1.17.0') && !interrupted) {
            return { ...response, body: (async function* () {
              for await (const bytes of response.body) {
                yield bytes.slice(0, 1);
                interrupted = true; controller.abort(new Error('intentional wheel cancellation'));
                controller.signal.throwIfAborted();
              }
            })() };
          }
          return response;
        },
      },
    }));
    await assert.rejects(interruptedShell.exec(`python -c 'import six'`, { signal: controller.signal }), /intentional wheel cancellation/);
    assert.ok(interrupted, 'test must reach actual six wheel transport');
    await run(interruptedShell, `python -c 'import six; assert six.__version__ == "1.17.0"'`);
    const preprovisioned = new Shell({ fs, cwd: '/work' }).use(pythonCommands({
      createWorker, packages: ['six==1.17.0'], provisioning: { cacheDirectory: '/package-cache', offline: true },
    }));
    await run(preprovisioned, `python3 -c 'import six; assert six.__version__ == "1.17.0"'`);
  });
  await t.test('tampered preprovisioned cache bytes fail integrity before user code', async () => {
    const corrupted = memoryCache();
    for (const [key, value] of cache.entries) await corrupted.set(key, value);
    const artifact = [...corrupted.entries].find(([key]) => key.includes('-sha256-'));
    assert.ok(artifact, 'real installation must populate verified artifacts');
    const changed = artifact[1].slice(); changed[0] ^= 1;
    await corrupted.set(artifact[0], changed);
    const tampered = new Shell({ fs, cwd: '/work' }).use(pythonCommands({
      ...options, provisioning: { ...options.provisioning, offline: true, cache: corrupted },
    }));
    const result = await tampered.exec(`python -c 'print("must not execute")'`);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /integrity/i);
    assert.ok(!result.stdout.includes('must not execute'));
  });
});
