import { createInterface } from "node:readline";
import { Volume } from 'memfs';
import * as api from 'docx';
async function execute(request) {
    const input = new Uint8Array(Buffer.from(request.input, 'base64')), signal = new AbortController().signal, context = { signal, limits: request.limits, budget: new api.DocumentBudget({ xmlDepth: request.xmlDepth, retainedBytes: 1073741824, work: 1073741824 }, signal, async () => { }), timestamp: new Date('2026-03-04T05:06:07Z'), encoding: { order: 'input', compression: 'store' } }, memory = Volume.fromJSON({ '/output': '' }), sink = { async write(bytes) { memory.appendFileSync('/output', bytes); } };
    try {
        if (request.route === 'native-model') {
            const doc = await api.Document(input, context);
            if (doc.add_comment(doc.paragraphs[0].runs[0], 'Added note', '').comment_id !== 0)
                throw new Error('Unexpected ID');
            await doc.save(sink);
        }
        else if (request.route === 'native-sdk') {
            const result = await api.executeDocumentBatch(input, { version: 1, operations: request.operations }, { output: '-', timestamp: '2026-03-04T05:06:07Z' }, { ...context, stdout: sink });
            if (result.results.at(-1).data !== 0)
                throw new Error('Unexpected SDK ID');
        }
        else {
            const { Shell, MemoryFileSystem } = await import('@poe-platform/safe-bash');
            const { docxCommands } = await import('@poe-platform/safe-bash/commands/docx');
            const fs = new MemoryFileSystem();
            await fs.writeFile('/input', input);
            await fs.writeFile('/destination', new TextEncoder().encode('Retained destination'));
            const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: request.limits, documentLimits: { xmlDepth: request.xmlDepth, retainedBytes: 1073741824, work: 1073741824 } }) }));
            try {
                const result = await shell.exec('docx batch /input --ops-json ' + JSON.stringify(JSON.stringify({ version: 1, operations: request.operations })) + ' --timestamp 2026-03-04T05:06:07Z --output /destination --force --json');
                if (result.exitCode !== 0) {
                    const envelope = JSON.parse(result.stdout);
                    if (envelope.affected !== 0 || result.exitCode !== 1)
                        throw new Error('Wrong refusal state');
                    if (new TextDecoder().decode(await fs.readFile('/destination')) !== 'Retained destination' || Buffer.compare(Buffer.from(input), Buffer.from(await fs.readFile('/input'))))
                        throw new Error('Refusal changed source or destination');
                    const error = new Error(result.stdout + result.stderr);
                    error.code = envelope.errors[0].code;
                    throw error;
                }
                if (JSON.parse(result.stdout).data.results.at(-1).data !== 0)
                    throw new Error('Unexpected CLI ID');
                if (Buffer.compare(Buffer.from(input), Buffer.from(await fs.readFile('/input'))))
                    throw new Error('Source changed');
                memory.writeFileSync('/output', await fs.readFile('/destination'));
            }
            finally {
                await shell.dispose();
            }
        }
        return { ok: true, output: Buffer.from(memory.readFileSync('/output')).toString('base64') };
    }
    catch (error) {
        return { ok: false, error: String(error), stack: error.stack, code: error.code ?? null, outputBytes: memory.statSync('/output').size, sourceRetained: Buffer.compare(Buffer.from(input), Buffer.from(request.input, 'base64')) === 0 };
    }
}
console.log(JSON.stringify({ ready: true }));
for await (const line of createInterface({ input: process.stdin })) {
    console.log(JSON.stringify(await execute(JSON.parse(line))));
}
