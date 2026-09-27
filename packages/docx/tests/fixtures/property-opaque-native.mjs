import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Volume } from 'memfs';
import * as api from 'docx';
import { Shell, MemoryFileSystem } from '@poe-platform/safe-bash';
import { docxCommands } from '@poe-platform/safe-bash/commands/docx';
// Public package imports stay on a native main thread. Every request owns fresh state.
async function execute(req) {
    const input = new Uint8Array(Buffer.from(req.input, 'base64')), saved = input.slice(), signal = new AbortController().signal, documentLimits = { xmlDepth: 8192 }, context = () => ({ limits: req.limits, signal, budget: new api.DocumentBudget(documentLimits, signal), encoding: { order: 'input', compression: 'store' } }), mem = Volume.fromJSON({ '/out': '' }), sink = { async write(bytes) { mem.appendFileSync('/out', bytes); } }, qualified = req.group + ':' + req.key;
    const batch = operation => ({ version: 1, operations: [{ operation, arguments: operation === 'properties.set' ? { name: qualified, value: 'Shore' } : {} }] }), ref = resultHandle => ({ resultHandle }), modelOps = [{ operation: 'model.document.Document.core_properties.get', receiver: ref('document'), arguments: {}, resultHandle: 'properties' }, { operation: 'model.opc.coreprops.CoreProperties.title.get', receiver: ref('properties'), arguments: {} }, { operation: 'model.opc.coreprops.CoreProperties.title.set', receiver: ref('properties'), arguments: { value: 'Shore' } }];
    const verify = items => { assert.deepEqual(items.map(i => ({ name: i.name, support: i.support, properties: i.properties })), [{ name: qualified, support: 'edit', properties: [{ name: req.key, type: 'string', value: 'Coast', writable: true, cached: false }] }, { name: req.group + ':Future', support: 'preserve', properties: [] }]); const future = items[1], office = req.strict ? 'http://purl.oclc.org/ooxml/officeDocument/' : 'http://schemas.openxmlformats.org/officeDocument/2006/', namespace = req.group === 'core' ? 'http://schemas.openxmlformats.org/package/2006/metadata/core-properties' : office + (req.strict ? req.group + 'Properties' : req.group + '-properties'); assert.deepEqual(future.details, { kind: 'property', group: req.group, storedType: { namespace: req.group === 'custom' ? office + 'docPropsVTypes' : namespace, localName: req.group === 'custom' ? 'vector' : 'Future' }, id: req.group === 'custom' ? '3' : null }); for (const item of items) {
        assert.deepEqual(item.references, [{ owner: '/', id: 'metadata', type: req.group === 'core' ? 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties' : office + 'relationships/' + req.group + '-properties', target: 'metadata/' + req.group + '.xml', external: false }]);
        assert.deepEqual(item.location.value, { version: 1, sourceSha256: createHash('sha256').update(input).digest('hex'), generation: 0, part: '/metadata/' + req.group + '.xml', story: '/metadata/' + req.group + '.xml', path: [], range: null });
    } };
    let result = { ok: false, errorCode: null, errorStack: null };
    try {
        if (req.depth >= 4096)
            await assert.rejects(api.inspectDocumentProperties(input, {}, { ...context(), budget: new api.DocumentBudget({ xmlDepth: 4096 }, signal) }), error => error.code === 'limit-exceeded');
        if (req.route === 'sdk' || req.route === 'sdk-batch') {
            const read = req.route === 'sdk' ? await api.inspectDocumentProperties(input, {}, context()) : (await api.executeDocumentBatch(input, batch('properties.list'), {}, context())).results[0].data;
            verify(read.items);
            if (req.route === 'sdk')
                await api.editDocumentProperties(input, { operation: 'properties.set', name: qualified, value: 'Shore', output: '-' }, { ...context(), stdout: sink });
            else
                await api.executeDocumentBatch(input, batch('properties.set'), { output: '-' }, { ...context(), stdout: sink });
            for (const operation of ['properties.set', 'properties.remove']) {
                const options = { name: req.group + ':Future', ...(operation === 'properties.set' ? { value: 'Guess', type: 'string' } : {}) };
                const prior = new Uint8Array(mem.readFileSync('/out'));
                await assert.rejects(req.route === 'sdk' ? api.editDocumentProperties(input, { operation, ...options, output: '-' }, { ...context(), stdout: sink }) : api.executeDocumentBatch(input, { version: 1, operations: [{ operation, arguments: options }] }, { output: '-' }, { ...context(), stdout: sink }), error => error.code === 'unsupported-edit');
                assert.deepEqual(new Uint8Array(mem.readFileSync('/out')), prior);
            }
        }
        else if (req.route === 'model') {
            const model = await api.Document(input, context());
            assert.equal(model.core_properties.title, 'Coast');
            model.core_properties.title = 'Shore';
            await model.save(sink);
        }
        else if (req.route === 'model-sdk') {
            const model = await api.applyStyleModelBatch(input, { version: 1, operations: modelOps }, context());
            assert.equal(model.results[1].value, 'Coast');
            await model.save(sink);
        }
        else {
            const fs = new MemoryFileSystem();
            await fs.writeFile('/input', input);
            await fs.writeFile('/out', new TextEncoder().encode('Retained destination'));
            const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: req.route === 'model-cli-quota' ? { ...req.limits, maxRetainedBytes: 33554432 } : req.limits, documentLimits }) }));
            try {
                if (req.route.startsWith('model-cli')) {
                    const response = await shell.exec('docx batch /input --ops-json ' + JSON.stringify(JSON.stringify({ version: 1, operations: modelOps })) + ' --output /out --force --json');
                    if (req.route === 'model-cli-quota') {
                        assert.equal(response.exitCode, 4, response.stdout + response.stderr);
                        assert.deepEqual(JSON.parse(response.stdout), { version: 1, operation: 'batch', ok: false, data: null, warnings: [], errors: [{ code: 'limit-exceeded', message: 'Document operation failed: limit-exceeded' }], affected: 0, locations: [] });
                        assert.deepEqual(await fs.readFile('/out'), new TextEncoder().encode('Retained destination'));
                    }
                    else {
                        assert.equal(response.exitCode, 0, response.stdout + response.stderr);
                        assert.equal(JSON.parse(response.stdout).data.results[1].data, 'Coast');
                    }
                }
                else {
                    const read = await shell.exec(req.route === 'cli' ? 'docx properties list /input --json' : 'docx batch /input --ops-json ' + JSON.stringify(JSON.stringify(batch('properties.list'))) + ' --json');
                    assert.equal(read.exitCode, 0, read.stdout + read.stderr);
                    const envelope = JSON.parse(read.stdout), items = req.route === 'cli' ? envelope.data.items : envelope.data.results[0].data.items;
                    verify(items);
                    const edited = await shell.exec((req.route === 'cli' ? 'docx properties set /input --name ' + qualified + ' --value Shore' : 'docx batch /input --ops-json ' + JSON.stringify(JSON.stringify(batch('properties.set')))) + ' --output /out --force --json');
                    assert.equal(edited.exitCode, 0, edited.stdout + edited.stderr);
                    const prior = await fs.readFile('/out');
                    for (const operation of ['properties.set', 'properties.remove']) {
                        const options = { name: req.group + ':Future', ...(operation === 'properties.set' ? { value: 'Guess', type: 'string' } : {}) };
                        const refused = await shell.exec((req.route === 'cli' ? 'docx ' + operation.split('.').join(' ') + ' /input --name ' + options.name + (operation === 'properties.set' ? ' --value Guess --type string' : '') : 'docx batch /input --ops-json ' + JSON.stringify(JSON.stringify({ version: 1, operations: [{ operation, arguments: options }] }))) + ' --output /out --force --json');
                        assert.equal(refused.exitCode, 1, refused.stdout + refused.stderr);
                        assert.equal(JSON.parse(refused.stdout).errors[0].code, 'unsupported-edit');
                        assert.equal(JSON.parse(refused.stdout).affected, 0);
                        assert.deepEqual(await fs.readFile('/out'), prior);
                    }
                }
                assert.deepEqual(await fs.readFile('/input'), saved);
                if (req.route !== 'model-cli-quota')
                    mem.writeFileSync('/out', await fs.readFile('/out'));
            }
            finally {
                await shell.dispose();
            }
        }
        assert.deepEqual(input, saved);
        result = req.route === 'model-cli-quota' ? { ok: true, expectedLimit: 'limit-exceeded', zeroPublication: mem.statSync('/out').size === 0, exactSourceAndRefusalDestination: true } : { ok: true, output: Buffer.from(mem.readFileSync('/out')).toString('base64'), exactSourceAndRefusalDestination: true };
    }
    catch (error) {
        result = { ok: false, errorCode: error.code ?? null, errorStack: error.stack };
    }
    return result;
}
let lastId = 0, busy = false, stopping = false;
process.on("message", async (request) => {
    try {
        if (busy || stopping)
            throw Error("Overlapping native requests");
        if (request.type === "shutdown" && request.id === lastId) {
            stopping = true;
            process.send({ type: "closed", id: lastId }, error => {
                if (error)
                    throw error;
                process.disconnect();
            });
            return;
        }
        if (request.type !== "execute" || request.id !== lastId + 1)
            throw Error("Unexpected native request");
        lastId = request.id;
        busy = true;
        const response = await execute(request);
        busy = false;
        process.send({ type: "result", id: lastId, ...response }, error => { if (error)
            throw error; });
    }
    catch (error) {
        console.error(error);
        process.exitCode = 1;
        process.disconnect();
    }
});
process.on("disconnect", () => { if (!stopping)
    process.exitCode = 1; });
process.send({ type: "ready" }, error => { if (error)
    throw error; });
