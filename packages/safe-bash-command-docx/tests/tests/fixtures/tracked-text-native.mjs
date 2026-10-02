import assert from 'node:assert/strict';
import { Volume } from 'memfs';
import * as api from 'safe-bash-command-docx/sdk';

// Public package imports stay on a native main thread; each request owns fresh state.
async function execute(request) {
    const input = new Uint8Array(Buffer.from(request.input, 'base64')), memory = Volume.fromJSON({ '/output': '' }), sink = { async write(bytes) { memory.appendFileSync('/output', bytes); } }, limits = request.limits, signal = new AbortController().signal, budget = () => new api.DocumentBudget({ xmlDepth: 8192, retainedBytes: 2 ** 31, work: 2 ** 31 }, signal), context = { limits, signal, budget: budget(), encoding: { order: 'input', compression: 'store' }, stdout: sink }, arguments_ = { find: 'Coast', with: 'Shore', all: true, trackChanges: true, author: '', timestamp: '2026-01-02T03:04:06Z' }, ops = { version: 1, operations: [{ operation: 'text.replace', arguments: arguments_ }] };
    try {
        if (request.observedView === 'baseline') {
            const beforeText = (await api.extractDocumentText(input, { limits, signal, budget: budget() })).text;
            return { ok: true, beforeText, outputBytes: memory.statSync('/output').size };
        }
        if (request.route === 'sdk')
            await api.replaceDocumentText(input, { ...arguments_, output: '-' }, context);
        else if (request.route === 'sdk-batch')
            await api.executeDocumentBatch(input, ops, { output: '-' }, context);
        else {
            const { Shell, MemoryFileSystem } = await import('@poe-platform/safe-bash');
            const { docxCommands } = await import('@poe-platform/safe-bash/commands/docx');
            const fs = new MemoryFileSystem();
            await fs.writeFile('/input', input);
            const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits, documentLimits: { xmlDepth: 8192, retainedBytes: 2 ** 31, work: 2 ** 31 } }) }));
            try {
                const command = request.route === 'cli' ? "docx text replace /input --find Coast --with Shore --all --track-changes --author '' --timestamp 2026-01-02T03:04:06Z --output /output --json" : 'docx batch /input --ops-json ' + JSON.stringify(JSON.stringify(ops)) + ' --output /output --json';
                const result = await shell.exec(command);
                if (result.exitCode !== 0) {
                    const failure = new Error(result.stdout + result.stderr);
                    failure.code = JSON.parse(result.stdout).errors[0].code;
                    throw failure;
                }
                memory.writeFileSync('/output', await fs.readFile('/output'));
                if (Buffer.compare(Buffer.from(await fs.readFile('/input')), Buffer.from(input)))
                    throw new Error('Input changed');
            }
            finally {
                await shell.dispose();
            }
        }
        const output = new Uint8Array(memory.readFileSync('/output')), observed = await api.extractDocumentText(output, { limits, signal, budget: budget() }, { view: request.observedView });
        const beforeArchive = await api.readArchive(input, { limits, signal, budget: budget() }), afterArchive = await api.readArchive(output, { limits, signal, budget: budget() });
        assert.deepEqual(afterArchive.members.map(m => m.name), beforeArchive.members.map(m => m.name));
        for (let n = 0; n < beforeArchive.members.length; n++) {
            const before = beforeArchive.members[n], after = afterArchive.members[n];
            if (before.name !== 'word/document.xml')
                assert.deepEqual(after.bytes, before.bytes);
        }
        const source = new TextDecoder().decode(afterArchive.members.find(m => m.name === 'word/document.xml').bytes);
        assert.ok(source.includes(request.retained));
        return { ok: true, view: request.observedView, text: observed.text, exactMemberOrderNondirtyPartsAndRetainedSource: true };
    }
    catch (error) {
        return { ok: false, error: String(error), code: error.code ?? null, stack: error.stack, outputBytes: memory.statSync('/output').size };
    }
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
