import assert from 'node:assert/strict';
import { join, relative } from 'node:path';
import { regularBytes, sha256 } from './offline.mjs';

export async function auditManaged({ bound, boundJson, boundLines, product, manifest, profiles, qualificationPath }) {
  const prefix = 'benchmarks/reports/current-integration/comparison-replay-20260827';
  assert.equal(qualificationPath, `${prefix}/capture-qualification.json`);
  const qualification = await boundJson(qualificationPath);
  assert.equal(qualification.authority.initialDetailedSubsetBudgetFullyDeclared, false);
  assert.equal(qualification.authority.retroactivePreapprovalClaim, false);
  assert.equal(qualification.authority.uniqueCoverageIncreaseClaim, false);
  for (const [path, digest] of Object.entries(qualification.evidenceSha256)) assert.equal(sha256(await bound(`${prefix}/${path}`)), digest);
  const phaseSource = (await bound(`${prefix}/phase.mjs`)).toString();
  const loader = (await bound(`${prefix}/loader.mjs`)).toString();
  assert.ok(loader.indexOf("event: 'module-load'") < loader.indexOf('return nextLoad(url, context)'));
  assert.ok(!/export\s+(?:async\s+)?function\s+resolve\b/u.test(loader));
  for (const token of ['await worker.run(specimen, server.baseUrl, instrument, 0)', 'row[engine] = await run(engine, specimen)', 'if (fresh && worker) await worker.close()', 'for (const worker of sessions.values()) await worker.close()', 'await server.close()']) assert.ok(phaseSource.includes(token), `missing inspected serial-await cleanup: ${token}`);
  for (const [name, profile] of Object.entries(profiles)) {
    for (const filename of ['session.mjs', 'engine.mjs', 'server.mjs']) {
      const path = join(profile.harness, filename);
      const content = await regularBytes(path);
      assert.equal(sha256(content), manifest[relative(product, path)].sha256);
      const source = content.toString();
      const required = filename === 'session.mjs' ? ['if (message.ready) resolve()', 'child.kill("SIGTERM"); await exited;'] : filename === 'engine.mjs' ? ['library = await import(pathToFileURL(join(sourceRoot, "src/index.ts")).href)', 'library = await import(pathToFileURL(join(baselineRoot, "dist/bundle/index.js")).href)', 'process.send?.({ ready: true })'] : ['server.closeAllConnections(); await new Promise(resolve => server.close(resolve))'];
      for (const token of required) assert.ok(source.includes(token), `${name}/${filename}: inspected code changed`);
      if (filename === 'engine.mjs') assert.ok(source.indexOf('process.send?.({ ready: true })') > source.indexOf('library = await import(pathToFileURL(join(baselineRoot'));
    }
  }
  const phases = {};
  for (const phase of ['controls', 'original', 'scratch-aligned']) {
    const lifecycle = await boundJson(`${prefix}/${phase}/lifecycle.json`);
    const events = await boundLines(`${prefix}/${phase}/imports.jsonl`);
    const expected = phase === 'controls' ? 4 : 26;
    assert.equal(lifecycle.gate, 'PASS');
    assert.deepEqual(lifecycle.result, { code: 0, signal: null });
    assert.equal(lifecycle.timedOut, false);
    for (const list of [lifecycle.leaked, lifecycle.remaining, lifecycle.sourceIntegrity.mismatches, lifecycle.importAudit.outside, lifecycle.importAudit.wrongBytes]) assert.deepEqual(list, []);
    const starts = events.filter(event => event.event === 'child-start');
    const exits = events.filter(event => event.event === 'child-exit');
    const workers = events.filter(event => event.event === 'process-start' && event.argv.some(argument => argument.endsWith('/engine.mjs')));
    assert.equal(starts.length, expected);
    assert.equal(exits.length, expected);
    assert.equal(workers.length, expected);
    assert.equal(new Set(starts.map(event => `${event.pid}:${event.childPid}`)).size, expected);
    for (const child of starts) {
      const matching = exits.filter(event => event.pid === child.pid && event.childPid === child.childPid);
      assert.equal(matching.length, 1);
      assert.equal(matching[0].signal, 'SIGTERM');
      assert.equal(matching[0].code, null);
      assert.equal(workers.filter(worker => worker.pid === child.childPid).length, 1);
    }
    const loads = events.filter(event => event.event === 'module-load');
    for (const event of loads) assert.equal(manifest[relative(product, event.actual)]?.sha256, event.sourceSha256);
    for (const worker of workers) {
      const attemptedPaths = loads.filter(event => event.pid === worker.pid).map(event => event.actual);
      const productEntry = attemptedPaths.includes(join(product, 'src/index.ts'));
      const baselineEntry = attemptedPaths.includes(join(product, 'benchmarks/node_modules/just-bash/dist/bundle/index.js'));
      assert.notEqual(productEntry, baselineEntry, 'entry attempt must identify exactly one chosen engine');
      const captured = lifecycle.importAudit.workers.find(entry => entry.pid === worker.pid);
      assert.equal(captured.loadedProductEntry, productEntry);
      assert.equal(captured.loadedBaselineEntry, baselineEntry);
    }
    const census = await boundJson(`${prefix}/${phase}/process-samples.json`);
    assert.ok(census.length > 0);
    for (const sample of census) {
      assert.ok(Date.parse(sample.at) >= Date.parse(lifecycle.startedAt) && Date.parse(sample.at) <= Date.parse(lifecycle.finishedAt));
      assert.ok(Array.isArray(sample.processes));
      for (const process of sample.processes) assert.ok(Number.isInteger(process.pid) && Number.isInteger(process.ppid) && Number.isInteger(process.pgid));
    }
    const attempted = { events: loads.length, urls: new Set(loads.map(event => event.url)).size, files: new Set(loads.map(event => event.actual)).size };
    const claimed = qualification.phaseEvidence[phase].importAttemptEvidence;
    assert.equal(attempted.events, claimed.attemptEvents);
    assert.equal(attempted.urls, claimed.distinctAttemptUrls);
    assert.equal(attempted.files, claimed.distinctAttemptFiles);
    if (phase !== 'controls') {
      const rows = await boundJson(`${prefix}/${phase}/functional.json`);
      assert.deepEqual(rows, await boundLines(`${prefix}/${phase}/functional.jsonl`));
      const neutrality = await boundJson(`${prefix}/${phase}/instrumentation-controls.json`);
      for (const capture of [...rows.flatMap(row => [row['virtual-bash'], row['just-bash']]), ...neutrality.map(row => row.plain)]) {
        assert.ok(capture.observation && !capture.timeout && !capture.error, 'incomplete or failed call cannot support settled-call inference');
      }
      const cleanup = await boundJson(`${prefix}/${phase}/phase-cleanup.json`);
      assert.equal(cleanup.sessionsClosed, true);
      assert.equal(cleanup.serverClosed, true);
    }
    phases[phase] = { children: expected, matchedSigtermExits: expected, attempted, processCensusSamples: census.length, outerGate: 'PASS', proof: 'sealed awaited imports/ready startup and complete serial results; numeric PID+parent, no birth/request/socket identity' };
  }
  return { result: 'BOUNDED_MANAGED_CLEANUP_SUPPORTED', phases, totalChildren: 56, observedLeaks: 0, rootDisposition: 'Post-execution qualified proof scope; no invented retrospective telemetry and no actual failed lifecycle gate waived.' };
}
