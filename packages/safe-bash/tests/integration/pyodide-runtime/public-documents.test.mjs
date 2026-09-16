import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { MemoryFileSystem } from 'poe-code/safe-fs/core';
import { Shell, agentCommands } from 'poe-code/safe-bash';
import { pythonCommands } from 'poe-code/safe-bash/commands/python';
import { createWorker, createOfflineCache, delayedFileSystem } from './public-runtime-fixture.mjs';

// Explicit real-runtime integration only. Provision assets before this suite;
// no downloads and no host writes unless the operator requests artifact capture.
for (const profile of ['memory', 'delayed']) {
  test(`public Python document scripts through canonical ${profile} storage`, { timeout: 180000 }, async t => {
    const storage = new MemoryFileSystem();
    await storage.mkdir('/work');
    await storage.mkdir('/tmp');
    const delayed = delayedFileSystem(storage);
    const fs = profile === 'delayed' ? delayed.fs : storage;
    for (const mode of ['create', 'edit', 'verify', 'streams']) {
      await storage.writeFile(`/work/documents-${mode}.py`, await readFile(new URL(`./fixtures/documents-${mode}.py`, import.meta.url)));
    }
    await storage.writeFile('/work/qualified-documents.py',
      await readFile(new URL('./browser-documents/documents.py', import.meta.url)));
    await storage.writeFile('/work/font.ttf', await readFile(new URL('../../../../../packages/terminal-png/assets/jetbrains-mono-400-normal.ttf', import.meta.url)));
    await storage.writeFile('/work/host-input.txt', Buffer.from('canonical host input\n'));
    const shell = new Shell({ fs, cwd: '/work' }).use(agentCommands()).use(pythonCommands({
      createWorker, packageProfile: 'documents',
      provisioning: { offline: true, cache: await createOfflineCache(),
        transport() { throw new Error('offline document acceptance attempted network'); } },
    }));
    const run = async command => {
      const result = await shell.exec(command);
      assert.equal(result.exitCode, 0, command + '\n' + result.stderr);
      assert.equal(result.stderr, '', command);
      return result;
    };
    try {
      assert.equal((await run('python documents-create.py')).stdout, 'created\n');
      assert.equal(Buffer.from(await storage.readFile('/work/guest-output.txt')).toString(), 'created by guest\n');
      assert.equal(Buffer.from(await storage.readFile('/work/random-access.bin')).toString(), '0123AB67');
      // The independent reader checks XlsxWriter's explicit cached value before
      // openpyxl edits it. This is a supplied cache, not Python calculation.
      await run(`python3 -c 'from openpyxl import load_workbook; assert load_workbook("writer.xlsx", data_only=True)["Results"]["B4"].value == 5'`);
      for (const name of ['report.docx', 'openpyxl.xlsx', 'writer.xlsx']) {
        assert.deepEqual(Array.from((await storage.readFile('/work/' + name)).slice(0, 2)), [80, 75]);
      }
      await storage.writeFile('/work/host-edit.txt', Buffer.from('host reopened artifacts\n'));
      assert.equal((await run('python3 documents-edit.py')).stdout, 'edited\n');
      assert.equal((await run('cat guest-output.txt')).stdout, 'edited by guest\n');
      const verified = JSON.parse((await run('python documents-verify.py')).stdout);
      assert.deepEqual(verified, {
        docx: 'heading table image edited', xlsx: 'values styles formulas charts images edited',
        pdf: 'text pages image Helvetica edited', io: 'temporary seek truncate',
      });
      assert.equal((await run('python3 documents-streams.py')).stdout,
        'streams unicode paths spooled temporary files\n');
      for (const name of ['edited résumé.docx', 'openpyxl.xlsx', 'writer.xlsx', 'edited résumé.pdf']) {
        assert.ok((await storage.readFile('/work/résultats with spaces/' + name)).byteLength > 0);
      }
      assert.equal((await storage.readdir('/tmp')).length, 0);
      // Run the browser-qualified workload through actual public shell dispatch.
      // This adds dates, multi-sheet formatting, PDF merge/split and embedded
      // font/image stream assertions to the existing cross-invocation coverage.
      const qualifiedRun = await shell.exec('PROBE_ROOT=/work PROBE_FONT=/work/font.ttf PROBE_PROFILE=bridge python qualified-documents.py');
      const qualification = JSON.parse(Buffer.from(await storage.readFile('/work/report.json')).toString());
      // Keep the reproduced retained-directory cleanup requirement visible.
      // Do not replace CPython's safe rmtree with weaker path-based deletion.
      assert.equal(qualifiedRun.exitCode, 1);
      assert.equal(qualification.priority_passed, false);
      assert.match(qualification.workflows.filesystem.error, /Not supported/);
      assert.match(qualification.workflows.filesystem.traceback, /_rmtree_safe_fd/);
      await t.test('required TemporaryDirectory descriptor cleanup', {
        todo: 'Canonical retained directory descriptors and descriptor-relative operations are unsupported',
      }, () => {
        assert.equal(qualification.workflows.filesystem.status, 'passed',
          qualification.workflows.filesystem.traceback);
      });
      for (const name of ['pillow_image', 'nofollow_exclusive',
        'python_docx', 'openpyxl', 'xlsxwriter', 'fpdf2_pypdf', 'stream_modes',
        'invalid_inputs', 'timestamps', 'runtime_resources']) {
        assert.equal(qualification.workflows[name].status, 'passed', name);
      }
      assert.deepEqual(qualification.versions, {
        'python-docx': '1.2.0', openpyxl: '3.1.5', XlsxWriter: '3.2.9',
        pypdf: '6.18.1', fpdf2: '2.8.8', lxml: '6.0.2', Pillow: '12.2.0',
        fonttools: '4.65.0', defusedxml: '0.7.1', 'et-xmlfile': '2.0.0',
        'typing-extensions': '4.16.0',
      });
      // Rendering is qualified separately in the real browser worker; the
      // production document profile deliberately does not install PyMuPDF.
      assert.equal(qualification.pymupdf.status, 'unresolved');
      assert.equal(qualification.reportlab.status, 'not_needed');
      for (const [name, artifact] of Object.entries(qualification.artifacts)) {
        const bytes = await storage.readFile('/work/' + name);
        assert.equal(bytes.byteLength, artifact.bytes, name);
        assert.equal(createHash('sha256').update(bytes).digest('hex'), artifact.sha256, name);
      }
      assert.equal((await storage.readdir('/tmp')).length, 0);
      if (profile === 'delayed') {
        assert.ok(delayed.operations() > 0);
        assert.equal(delayed.handles.size, 0);
        t.diagnostic(`Delayed canonical operations: ${delayed.operations()}; open handles: ${delayed.handles.size}`);
      }
      if (process.env.SAFE_BASH_PYTHON_ARTIFACT_DIR) {
        const root = resolve(process.env.SAFE_BASH_PYTHON_ARTIFACT_DIR);
        await mkdir(root, { recursive: true });
        const target = join(root, profile);
        await mkdir(target);
        for (const name of ['report.docx', 'openpyxl.xlsx', 'writer.xlsx', 'report.pdf', 'edited.pdf', 'fixture.png']) {
          await writeFile(join(target, name), await storage.readFile('/work/' + name), { flag: 'wx' });
        }
      }
    } finally {
      await shell.dispose();
    }
  });
}
