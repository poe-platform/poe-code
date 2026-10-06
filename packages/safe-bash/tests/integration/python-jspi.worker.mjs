import { standardCommands } from '@poe-platform/safe-bash/core';
import libraryExamples from 'python-library-examples';
import { installStaticPackages, llmPackageAssets } from 'python-static-assets';
import standardLlmProgram from 'standard-llm-program';
import { loadPyodide } from 'pinned-pyodide-loader';
import createPyodideModule from 'pinned-pyodide-module';
import lockFileContents from 'pinned-pyodide-lock';
import trampoline from 'trampoline.wasm';
import nativeCall from 'native-call.wasm';
import statResult from 'stat-result.wasm';
import { createDeviceFileSystem, MemoryFileSystem, PythonFileSystem, PythonStatTranslator, withObjectFileDescriptors } from '@poe-platform/safe-fs/core';
import { createPythonJspiExecutor, createPythonLlmToolLoader, pythonCommands, createPythonExecutorPool, createPythonShellCapability, createPythonLlmCapability, installPythonLlmPackages } from '@poe-platform/safe-bash/commands/python';
import { Shell, createSearchCommands } from '@poe-platform/safe-bash/search';
import { createLlmService, llmCommands } from '@poe-platform/safe-bash/commands/llm';
import { observePythonJspiUnhandledErrors } from './python-jspi-errors.mjs';

const unhandledErrors = observePythonJspiUnhandledErrors(globalThis);

async function qualifyPublication(backend, createExecutor, cancel) {
  const versions = new Map();
  let revision = 0;
  let cancelled = false;
  let publishing = false;
  const controller = new AbortController();
  const store = {
    async acquire(path) { return versions.get(path); },
    async publish(path, previous, source, options) {
      if ((versions.get(path)?.revision ?? null) !== previous) throw new Error('publication conflict');
      const chunks = [];
      let size = 0;
      publishing = true;
      try {
        for await (const chunk of source) {
          if (path === '/work/cancel-large' && options.size > 0) {
            // Expire while close is suspended in authoritative publication.
            const timer = setTimeout(() => controller.abort(new Error('publication deadline')), 1);
            try {
              await new Promise((resolve, reject) => {
                options.signal.addEventListener('abort', () => reject(options.signal.reason), {once:true});
                if (options.signal.aborted) reject(options.signal.reason);
              });
            } finally { clearTimeout(timer); cancelled = true; }
          }
          options.signal.throwIfAborted();
          chunks.push(Uint8Array.from(chunk));
          size += chunk.length;
        }
        if (size !== options.size) throw new Error('incomplete publication');
        const version = { revision: String(++revision),
          stat: { type:'file', size, mode:options.mode, mtimeMs:0, atimeMs:0, ctimeMs:0 },
          async read(position, count, options) {
            options?.signal?.throwIfAborted();
            const bytes = new Uint8Array(count);
            let copied = 0;
            while (copied < count) {
              const offset = position + copied;
              const chunk = chunks[Math.floor(offset / 65536)];
              const part = chunk.subarray(offset % 65536, Math.min(chunk.length, offset % 65536 + count - copied));
              bytes.set(part, copied);
              copied += part.length;
            }
            return bytes;
          }, async close() {} };
        versions.set(path, version);
        return version;
      } finally { publishing = false; }
    },
  };
  const fs = withObjectFileDescriptors(backend, store, {maxOpenFiles:1});
  const pool = createPythonExecutorPool({maxConcurrentExecutors:1, createExecutor});
  const shell = new Shell({fs}).use(pythonCommands({createExecutor:pool.createExecutor, maxConcurrentWorkers:1, maxTransferBytes:1024 * 1024}));
  const quote = String.fromCharCode(39);
  const script = (path, count) => `chunk = bytes(range(256)) * 4096
with open("${path}", "wb") as output:
 for _ in range(${count}):
  output.write(chunk)
`;
  try {
    let error;
    if (cancel) {
      try { await shell.exec('python -c ' + quote + script('/work/cancel-large', 100) + quote, {signal:controller.signal}); }
      catch (reason) { error = String(reason); }
      if (!error || !cancelled || publishing || pool.inspect().active !== 0) throw new Error('publication retirement failed: ' + JSON.stringify({error,cancelled,publishing,pool:pool.inspect()}));
    }
    const result = await shell.exec('python -c ' + quote + script('/work/large', cancel ? 9 : 100) + `
import hashlib
hasher = hashlib.sha256()
with open("/work/large", "rb") as source:
 while data := source.read(1024 * 1024):
  hasher.update(data)
print(hasher.hexdigest())
` + quote, {signal:AbortSignal.timeout(120000)});
    const version = versions.get('/work/large');
    // Verify the retained authoritative bytes independently of Python's digest.
    for (let position = 0; position < version.stat.size; position += 65536) {
      const bytes = await version.read(position, 65536);
      for (let index = 0; index < bytes.length; index++) if (bytes[index] !== index % 256) throw new Error('authoritative byte mismatch');
    }
    return {error,cancelled,publishing,pool:pool.inspect(), result, size:version.stat.size};
  } finally { await shell.dispose(); await pool.dispose(); }
}

async function qualifyShells(backend, createExecutor) {
  const gates = Object.fromEntries(['first', 'sibling'].map(name => {
    let entered, release;
    return [name, {started:new Promise(resolve => { entered = resolve; }), held:new Promise(resolve => { release = resolve; }),
      enter: () => entered(), release: () => release()}];
  }));
  const closed = [];
  const filesystem = new Proxy(backend, {get(target, key) {
    if (key === 'open') return async (path, options) => {
      const handle = await target.open(path, options);
      const name = path.startsWith('/work/held-') ? path.slice('/work/held-'.length) : undefined;
      if (!name || !gates[name]) return handle;
      return new Proxy(handle, {get(retained, property) {
        if (property === 'read') return async (...args) => { gates[name].enter(); await gates[name].held; return retained.read(...args); };
        if (property === 'close') return async () => { closed.push(name); await retained.close(); };
        const value = Reflect.get(retained, property, retained);
        return typeof value === 'function' ? value.bind(retained) : value;
      }});
    };
    const value = Reflect.get(target, key, target);
    return typeof value === 'function' ? value.bind(target) : value;
  }});
  await backend.writeFile('/work/held-first', new Uint8Array([48]));
  await backend.writeFile('/work/held-sibling', new Uint8Array([49]));
  await backend.writeFile('/work/first.py', new TextEncoder().encode("import atexit\natexit.register(_record_finalization_called)\nwith open('/work/held-first', 'rb') as source:\n source.read()\n"));
  await backend.writeFile('/work/sibling.py', new TextEncoder().encode("import sys, types\nsys.modules['sibling_state'] = types.ModuleType('sibling_state')\nwith open('/work/held-sibling', 'rb') as source:\n data = source.read()\nsys.stdout.buffer.write(bytes([255, 0]) + data)\n"));
  await backend.writeFile('/work/fresh.py', new TextEncoder().encode("import sys\nassert 'sibling_state' not in sys.modules\nprint('fresh')\n"));
  let acquisitions = 0;
  const pool = createPythonExecutorPool({maxConcurrentExecutors:2, createExecutor() { acquisitions++; return createExecutor(); }});
  const first = new Shell({fs:filesystem, cwd:'/work'}).use(pythonCommands({createExecutor:pool.createExecutor}));
  const sibling = new Shell({fs:filesystem, cwd:'/work'}).use(pythonCommands({createExecutor:pool.createExecutor}));
  const firstRun = first.exec('python first.py').then(result => ({exitCode:result.exitCode}), error => ({error:String(error)}));
  const siblingRun = sibling.exec('python sibling.py');
  try {
    await Promise.race([
      Promise.all(Object.values(gates).map(gate => gate.started)),
      firstRun.then(result => { throw new Error('first invocation ended before held read: ' + JSON.stringify(result)); }),
      siblingRun.then(result => { throw new Error('sibling invocation ended before held read: ' + JSON.stringify(result)); }),
    ]);
    let disposed = false;
    const disposal = first.dispose().then(() => { disposed = true; });
    await Promise.resolve();
    const waitedForRead = !disposed;
    gates.first.release();
    await disposal;
    const firstResult = await firstRun;
    const borrowed = pool.inspect();
    gates.sibling.release();
    const siblingResult = await siblingRun;
    const fresh = await sibling.exec('python fresh.py');
    return {waitedForRead, borrowed, firstError:firstResult.error, siblingExit:siblingResult.exitCode,
      siblingBytes:Array.from(siblingResult.stdoutBytes), freshExit:fresh.exitCode, fresh:fresh.stdout, closed, acquisitions};
  } finally {
    for (const gate of Object.values(gates)) gate.release();
    await Promise.allSettled([firstRun, siblingRun]);
    await Promise.all([first.dispose(), sibling.dispose()]);
    await pool.dispose();
  }
}

async function qualifyFunctionTools(backend, createExecutor) {
  let cancellation = new AbortController();
  let cancelRun = false, chatRun = false, wireRun = false;
  const chatWire = [];
  const chatPrompts = [];
  const source = 'import asyncio as _asyncio\n_state = 0\n_event = _asyncio.Event()\ndef add(value: int):\n global _state\n _state += value\n return _state\nasync def first():\n await _event.wait()\n return "first"\nasync def second():\n _event.set()\n return "second"\ndef unicode_text():\n return "😀" * 4096\n';
  await backend.writeFile('/work/functions.py', new TextEncoder().encode(source));
  const toolbox = `import asyncio as _asyncio
import llm as _llm
from llm.plugins import pm as _pm
class _Counter(_llm.Toolbox):
 def __init__(self, start=0): self.value = start
 def prepare(self): self.value += 10
 async def prepare_async(self):
  if self.value < 0: await _asyncio.Event().wait()
  self.value += 100
 def add(self, value: int):
  self.value += value
  return self.value
 def peek(self): return self.value
class _Plugin:
 @_llm.hookimpl
 def register_tools(self, register): register(_Counter, name="Counter")
_pm.register(_Plugin(), name="fixture")
`;
  await backend.writeFile('/work/toolbox.py', new TextEncoder().encode(toolbox));
  const complete = async function* (request) {
    if (wireRun) {
      const read = async value => {
        if (typeof value === 'string') return value;
        let text = ''; const decoder = new TextDecoder();
        for await (const bytes of value.bytes) text += decoder.decode(bytes, {stream:true});
        return text + decoder.decode();
      };
      const messages = [];
      if (request.system) messages.push({role:'system',content:await read(request.system)});
      for (const message of request.messages ?? []) messages.push({role:message.role,content:await read(message.content)});
      messages.push({role:'user',content:await read(request.prompt)});
      chatWire.push(messages);
      return;
    }
    if (chatRun) {
      let prompt = request.prompt;
      if (typeof prompt !== 'string') {let text = ''; for await (const bytes of prompt.bytes) text += new TextDecoder().decode(bytes); prompt = text;}
      if (prompt) chatPrompts.push(prompt);
      if (prompt) return {toolCalls: [{id: 'chat', name: 'add', arguments: {value: 1}}]};
      const last = request.messages.filter(message => message.role === 'tool').at(-1);
      if (typeof last.content === 'string') yield last.content;
      else {const decoder = new TextDecoder(); for await (const bytes of last.content.bytes) yield decoder.decode(bytes, {stream: true}); yield decoder.decode();}
      return;
    }

    const results = request.messages?.filter(message => message.role === 'tool') ?? [];
    if (results.length) {
      const values = [];
      for (const result of results) {
        if (typeof result.content === 'string') values.push(result.content);
        else {let text = ''; const decoder = new TextDecoder('utf-8', {fatal:true}); for await (const bytes of result.content.bytes) text += decoder.decode(bytes,{stream:true}); values.push(text+decoder.decode());}
      }
      yield values.join(','); return;
    }
    if (cancelRun) {setTimeout(()=>cancellation.abort(new Error('function cancelled')),50); return {toolCalls:[{id:'cancel',name:'first',arguments:{}}]};}
    if (request.tools?.some(tool=>tool.name==='_Counter_add')) return {toolCalls:[{id:'a',name:'_Counter_add',arguments:{value:2}},{id:'b',name:'_Counter_peek',arguments:{}}]};
    if (request.tools?.some(tool=>tool.name==='llm_version')) return {toolCalls:[{id:'version',name:'llm_version',arguments:{}}]};
    return {toolCalls: request.async ? [{id:'a',name:'first',arguments:{}},{id:'b',name:'second',arguments:{}}]
      : [{id:'a',name:'add',arguments:{value:2}},{id:'b',name:'add',arguments:{value:3}},{id:'c',name:'unicode_text',arguments:{}}]};
  };
  const service = createLlmService({defaultModel:'fixture',providers:[{name:'fixture',models:[{id:'fixture',asyncModel:{},capabilities:['messages','tools']}],complete,completeSources:complete}]});
  const loadTools = createPythonLlmToolLoader({createExecutor,createCapabilities: context => ({llm:createPythonLlmCapability(context,service)})});
  const shell = new Shell({fs:backend,cwd:'/work',env:{HOME:'/work',LLM_USER_PATH:'/work/llm-config'}}).use(llmCommands({service,loadTools}));
  shell.use({name: 'chat-editor-fixture', setup(host) {
    host.commands.register({name: 'fixture-editor', async execute(context) {
      const path = context.args[0], before = await context.fs.stat(path);
      await context.fs.writeFile(path, new TextEncoder().encode('edited prompt'));
      await context.fs.utimes(path, before.atimeMs, before.mtimeMs + 1000);
      return {exitCode: 0};
    }});
  }});
  try {
    const plugins = await shell.exec('llm plugins');
    const pluginTools = await shell.exec('llm plugins --all --hook register_tools');
    const missingPlugins = await shell.exec('llm plugins --hook missing');
    const listing = await shell.exec('llm tools list --functions functions.py --json');
    const serial = await shell.exec('llm hello --functions functions.py');
    const concurrent = await shell.exec('llm hello --async --functions functions.py');
    const defaultTool = await shell.exec('llm hello -T llm_version');
    const unknownTool = await shell.exec('llm hello -T missing_tool');
    const brokenFunction = await shell.exec('llm hello --functions "def bad(:"');
    const toolboxListing = await shell.exec('llm tools list --functions toolbox.py "Counter(3)" --json');
    const toolboxSerial = await shell.exec('llm hello --functions toolbox.py -T "Counter(3)"');
    const toolboxAsync = await shell.exec('llm hello --async --functions toolbox.py -T "Counter(3)"');
    chatRun = true;
    const chat = await shell.exec("llm chat --functions functions.py <<'EOF'\none\ntwo\nexit\nEOF");
    const freshChat = await shell.exec("llm chat --functions functions.py <<'EOF'\nthree\nexit\nEOF");
    const editedChat = await shell.exec("EDITOR=fixture-editor llm chat --functions functions.py <<'EOF'\n!edit\nexit\nEOF");
    const missingChatFragment = await shell.exec("llm chat -f missing-fragment <<'EOF'\nexit\nEOF");
    const initialStdinChatFragment = await shell.exec("llm chat -f - <<'EOF'\nbody\nexit\nEOF");
    const stdinChatFragment = await shell.exec("llm chat --functions functions.py <<'EOF'\n!fragment -\nbody\nexit\nEOF");
    chatRun = false;
    await backend.mkdir('/work/llm-config/templates', {recursive:true});
    await backend.writeFile('/work/llm-config/templates/wire.yaml', new TextEncoder().encode('prompt: "$input"\nsystem: "$input"\n'));
    wireRun = true;
    const wireChat = await shell.exec("llm chat -t wire <<'EOF'\none\none\ntwo\nexit\nEOF");
    wireRun = false;
    cancelRun = true;
    let cancelled = false;
    try {await shell.exec('llm hello --async --functions functions.py',{signal:cancellation.signal});}
    catch(error) {cancelled = error === cancellation.signal.reason;}
    cancellation = new AbortController();
    let preparationCancelled = false;
    try {await shell.exec('llm hello --async --functions toolbox.py -T "Counter(-1)"',{signal:cancellation.signal});}
    catch(error) {preparationCancelled = error === cancellation.signal.reason;}
    return {wireChat,chatWire,missingChatFragment,initialStdinChatFragment,stdinChatFragment,chatPrompts,chat,freshChat,editedChat,plugins,pluginTools,missingPlugins,listing,serial,concurrent,defaultTool,unknownTool,brokenFunction,toolboxListing,toolboxSerial,toolboxAsync,cancelled,preparationCancelled,retained:(await backend.readdir('/work')).filter(entry=>entry.name.startsWith('.llm-'))};
  } finally {await shell.dispose();}
}


async function qualifyStandardLlm(backend, createExecutor, cancel = false, policy = false) {
  const calls = [];
  const controller = new AbortController();
  const provider = {name:'fixture',models:[
    {id:'fixture',asyncModel:{},capabilities:['messages','schema'],attachmentTypes:['text/plain'],options:{temperature:{type:'number',minimum:0,maximum:2},bias:{type:'object'},stop:{type:'array'}}},
    {id:'fixture-embed',capabilities:['embed']},
  ], async *complete(request) {
    calls.push({...(request.async ? {async:true} : {}),prompt:request.prompt,stream:request.stream,messages:request.messages,options:request.options,schema:request.schema,attachments:request.attachments.map(a=>({mimeType:a.mimeType,text:a.receipt ?? new TextDecoder().decode(a.bytes)}))});
    if (request.prompt === 'second' && request.messages?.at(-2)?.content !== 'first') throw new Error('Conversation history missing');
    if (request.prompt === 'rich' && (request.options.temperature !== 0.25 || request.schema?.properties?.answer?.type !== 'string' || (request.attachments[0]?.receipt ?? new TextDecoder().decode(request.attachments[0]?.bytes)) !== 'attached')) throw new Error('Rich prompt changed');
    if (request.prompt === 'empty-output') {
      for (let index = 0; index < 33; index++) yield '';
      return {};
    }
    const result = request.prompt === 'exact-output' ? 'é'.repeat(131072)
      : request.prompt === 'over-output' ? 'é'.repeat(131072) + 'x'
      : typeof request.prompt === 'string' ? request.prompt : 'large-accepted';
    if (request.stream) { yield result.slice(0,2); yield result.slice(2); }
    else yield result;
    return {usage:{input:3,output:2},metadata:{id:'fixture-response'}};
  }, async *completeSources(request) {
    const read = async source => {
      const digest = new crypto.DigestStream('SHA-256'), writer = digest.getWriter();
      let text='', total=0;
      const decoder = new TextDecoder();
      try {
        for await (const bytes of source.bytes) {
          if (bytes.byteLength > 16384) throw new Error('Unbounded LLM input chunk');
          total += bytes.byteLength;
          if (cancel) { controller.abort(new Error('LLM input cancelled')); request.signal.throwIfAborted(); }
          if (total <= 1024) text += decoder.decode(bytes,{stream:true}); else text='';
          await writer.write(bytes);
        }
        await writer.close();
        const sha256 = Array.from(new Uint8Array(await digest.digest),byte=>byte.toString(16).padStart(2,'0')).join('');
        return total > 1024 ? {bytes:total,sha256} : text+decoder.decode();
      } catch(error) { await writer.abort(error).catch(()=>{}); throw error; }
    };
    return yield* this.complete({...request,prompt:await read(request.prompt),
      ...(request.system ? {system:await read(request.system)} : {}),
      ...(request.messages ? {messages:await Promise.all(request.messages.map(async m=>({role:m.role,content:await read(m.content),...(m.attachments?.length ? {attachments:await Promise.all(m.attachments.map(async a=>({mimeType:a.mimeType,text:await read(a.source)})))} : {})})))} : {}),
      attachments:await Promise.all(request.attachments.map(async a=>({mimeType:a.mimeType,receipt:await read(a.source)})))});
  }, async embed(request) { return {model:request.model,vectors:request.inputs.map(text=>[text.length,1])}; }};
  const service = createLlmService({providers:[provider],defaultModel:'fixture'});
  let attachmentResponses = 0, attachmentDisposals = 0;
  const attachmentTransport = async request => {
    if (!['https://files.example/note.txt','https://files.example/large.txt'].includes(request.url)) throw new Error('Attachment origin denied');
    if (!['GET','HEAD'].includes(request.method)) throw new Error('Attachment method denied');
    attachmentResponses++;
    return {status:200,statusText:'OK',headers:[['content-type','text/plain']],body:(async function* () {
      if (request.method !== 'GET') throw new Error('HEAD response body was consumed');
      const size = request.url.endsWith('/large.txt') ? 16*1024*1024+7 : 14;
      const chunk = new Uint8Array(16384).fill(122);
      for (let offset=0;offset<size;offset+=chunk.length) {
        request.signal.throwIfAborted();
        yield size === 14 ? new TextEncoder().encode('url attachment') : chunk.subarray(0,Math.min(chunk.length,size-offset));
      }
    })(),async dispose() {attachmentDisposals++;}};
  };
  const shell = new Shell({fs:backend,cwd:'/work',env:{HOME:'/work',LLM_USER_PATH:'/work/llm-config'}})
    .use(pythonCommands({createExecutor,maxConcurrentWorkers:1,createCapabilities(context) {
      return {llm:createPythonLlmCapability(context,service,{attachmentTransport,maxBufferedResponseBytes:262144,maxBufferedEvents:32,maxMetadataBytes:65536,maxBufferedInputBytes:131072})};
    }}));
  const program = policy ? "import os\nos.environ[\"LLM_LOAD_PLUGINS\"] = \"llm\"\nimport asyncio\nimport importlib.util\nfor name in (\"pip\", \"openai\"):\n    assert importlib.util.find_spec(name) is None, name + \" is not part of the calling profile\"\nimport llm\nfor operation in (\n    lambda: llm.plugins.pm.register(object(), \"extra-provider\"),\n    lambda: llm.plugins.pm.load_setuptools_entrypoints(\"llm\"),\n):\n    try:\n        operation()\n    except llm.ModelError as error:\n        assert \"platform-configured providers\" in str(error)\n    else:\n        raise AssertionError(\"Provider registration accepted\")\nassert {model.model_id for model in llm.get_models()} == {\"fixture\"}\nassert llm.get_model().model_id == \"fixture\"\nassert llm.get_async_model().model_id == \"fixture\"\nassert {model.model_id for model in llm.get_async_models()} == {\"fixture\"}\ntry:\n    llm.get_model(\"gpt-4o-mini\")\nexcept llm.UnknownModelError:\n    pass\nelse:\n    raise AssertionError(\"An unconfigured provider became available\")\nfor operation in (\n    lambda: llm.get_model(\"fixture\").prompt(\"unauthorized-key\", key=\"synthetic-caller-key\").text(),\n):\n    try:\n        operation()\n    except llm.ModelError as error:\n        assert \"platform-managed credentials\" in str(error)\n    else:\n        raise AssertionError(\"Caller key accepted\")\nmodel = llm.get_embedding_model(\"fixture-embed\")\nmodel.key = \"synthetic-caller-key\"\ntry:\n    model.embed(\"unauthorized-key\")\nexcept llm.ModelError as error:\n    assert \"platform-managed credentials\" in str(error)\nelse:\n    raise AssertionError(\"Embedding key accepted\")\nasync def check_async():\n    try:\n        await llm.get_async_model(\"fixture\").prompt(\"unauthorized-key\", key=\"synthetic-caller-key\").text()\n    except llm.ModelError as error:\n        assert \"platform-managed credentials\" in str(error)\n    else:\n        raise AssertionError(\"Async caller key accepted\")\nasyncio.run(check_async())\nprint(\"platform-models-only\")\n" : cancel ? 'import llm\nllm.get_model("fixture").prompt("x" * 65536).text()\n' : standardLlmProgram;
  await backend.writeFile('/work/standard-llm.py',new TextEncoder().encode(program));
  try {
    let result, failure;
    try { result = await shell.exec('python standard-llm.py',{signal:controller.signal}); }
    catch(error) { if (!cancel) throw error; failure=String(error); }
    const retainedInputs=(await backend.readdir('/work')).filter(entry=>entry.name.startsWith('.llm-input-')).map(entry=>entry.name);
    const cliVersion = cancel ? undefined : await shell.exec('python -m llm --version');
    const configurationFiles = cancel ? [] : (await backend.readdir('/work/llm-config')).map(entry=>entry.name);
    return {...result, cliVersion, failure, retainedInputs, configurationFiles, calls, attachmentResponses, attachmentDisposals};
  } finally { await shell.dispose(); }
}

async function qualifyHostServices(backend, createExecutor) {
  let shellStreamCancelled = 0;
  let released = 0;
  let calls = 0;
  let hostCancelled = 0;
  let libraryReleased = 0;
  let inputSourceBytes = 0;
  let retiredBridge;
  const provider = { name:'fake', models:[
    {id:'fake',asyncModel:{},capabilities:['messages','schema','embed'],attachmentTypes:['text/plain'],options:{temperature:{type:'number',minimum:0,maximum:2},mode:{type:'string'},enabled:{type:'boolean'},count:{type:'integer'},nullable:{type:'string',nullable:true}}},
    {id:'binary',outputType:'application/octet-stream'},
  ], async *complete(request) {
    if (request.prompt === 'cancel-call') {
      await new Promise(resolve => request.signal.addEventListener('abort', () => {hostCancelled++; resolve();}, {once:true}));
      request.signal.throwIfAborted();
    }
    if (['host-buffer', 'host-empty', 'host-metadata', 'large-text'].includes(request.prompt)) {
      try {
        if (request.prompt === 'host-buffer') yield 'x'.repeat(65536);
        else if (request.prompt === 'host-empty') for (let i = 0; i < 1000; i++) yield '';
        else if (request.prompt === 'large-text') yield '🌍é\n'.repeat(300000);
        return {metadata:{id:'text-result',detail:request.prompt === 'host-metadata' ? 'x'.repeat(65536) : 'small'}};
      } finally {libraryReleased++;}
    }
    if (request.prompt === 'large-binary') {
      try { yield Uint8Array.from({length:2 * 1024 * 1024}, (_,index) => index % 256); } finally {libraryReleased++;}
      return {metadata:{id:'large-image'}};
    }
    if (request.prompt === 'error-call') throw new Error('private-host-error');
    if (request.prompt.startsWith('reference-fragment') && request.system !== 'first\n\nsecond') throw new Error('Reference system fragments changed');
    if (request.prompt === 'reference-inline' && (request.attachments[0]?.mimeType !== 'text/plain' || request.attachments[0]?.bytes.join(',') !== '0,255,128')) throw new Error('Reference inline attachment changed');
    if (request.prompt === 'reference-schema' && (request.schema?.type !== 'object' || request.schema?.properties?.age?.type !== 'integer')) throw new Error('Reference schema changed');
    if (request.prompt === 'reference-attached' && (request.attachments[0]?.mimeType !== 'text/plain' || new TextDecoder().decode(request.attachments[0]?.bytes) !== 'changed')) throw new Error('Reference canonical attachment changed');
    if (request.prompt === 'reference-second' && (request.messages.length !== 2 || request.messages[0].content !== 'reference-first' || request.messages[1].content !== 'reference-first')) throw new Error('Reference conversation history changed');
    if (request.prompt === 'library' && (request.options.enabled !== true || request.options.count !== 2 || request.options.nullable !== null)) throw new Error('Typed options were changed');
    if (request.prompt === 'Guest native' && (request.system !== 'guest' || request.options.mode !== 'guest' || new TextDecoder().decode(request.attachments[0]?.bytes) !== 'guest-canonical')) throw new Error('Guest template configuration or canonical path changed');
    if (request.prompt === 'configured' && (request.model !== 'fake' || request.options.mode !== 'override')) throw new Error('Canonical configuration or typed precedence changed');
    if (request.prompt === 'Review code: native' && (request.system !== 'Be terse' || request.options.enabled !== true || new TextDecoder().decode(request.attachments[0]?.bytes) !== 'changed')) throw new Error('Named template semantics changed');
    if (request.prompt === 'attached') {
      if (new TextDecoder().decode(request.attachments[0]?.bytes) !== 'changed' || request.messages[0]?.content !== 'prior' || request.schema.type !== 'object' || request.options.temperature !== 0.7) throw new Error('Rich request or canonical attachment changed');
    }
    await new Promise(resolve => setTimeout(resolve,5));
    request.signal.throwIfAborted();
    if (request.prompt === 'library-stream' || request.prompt === 'library-binary') {
      try {
        yield request.model === 'binary' ? new Uint8Array([0,255]) : 'incremental';
        yield request.model === 'binary' ? new Uint8Array([128]) : '-end';
      } finally {libraryReleased++;}
    } else yield request.prompt;
    return {usage:{input:3},metadata:{id:'fake-response'}};
  }, async *completeSources(request) {
    const read = async source => {
      const parts = [];
      let length = 0;
      for await (const chunk of source.bytes) { parts.push(chunk); length += chunk.length; }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const part of parts) { bytes.set(part,offset); offset += part.length; }
      return bytes;
    };
    const prompt = new TextDecoder().decode(await read(request.prompt));
    if (prompt === 'large-source') {
      for await (const chunk of request.attachments[0].source.bytes) {
        if (chunk.length > 16384 || chunk.some(byte => byte !== 173)) throw new Error('Canonical input source changed');
        inputSourceBytes += chunk.length;
      }
      yield String(inputSourceBytes);
      return {metadata:{id:'large-source'}};
    }
    return yield* this.complete({...request,prompt,
      ...(request.system ? {system:new TextDecoder().decode(await read(request.system))} : {}),
      ...(request.messages ? {messages:await Promise.all(request.messages.map(async message => ({role:message.role,content:new TextDecoder().decode(await read(message.content))})))} : {}),
      attachments:await Promise.all(request.attachments.map(async attachment => ({mimeType:attachment.mimeType,bytes:await read(attachment.source)})))});
  }, async embed(request) {
    return {model:request.model,vectors:request.inputs.map(() => [1,2]),usage:{input:request.inputs.length},metadata:{id:'embedding-1'}};
  } };
  const service = createLlmService({ providers: [provider], defaultModel: 'fake' });
  await backend.mkdir('/guest/config/templates',{recursive:true});
  await backend.writeFile('/guest/note.txt',new TextEncoder().encode('guest-canonical'));
  await backend.writeFile('/guest/config/default_model.txt',new TextEncoder().encode('guest-alias'));
  await backend.writeFile('/guest/config/aliases.json',new TextEncoder().encode(JSON.stringify({'guest-alias':'fake'})));
  await backend.writeFile('/guest/config/model_options.json',new TextEncoder().encode(JSON.stringify({fake:{mode:'guest'}})));
  await backend.writeFile('/guest/config/templates/review.yaml',new TextEncoder().encode('prompt: "Guest $input"\nsystem: guest\nattachments:\n  - note.txt\n'));
  await backend.mkdir('/settings/templates',{recursive:true});
  await backend.writeFile('/settings/default_model.txt',new TextEncoder().encode('saved'));
  await backend.writeFile('/settings/aliases.json',new TextEncoder().encode(JSON.stringify({saved:'fake'})));
  await backend.writeFile('/settings/model_options.json',new TextEncoder().encode(JSON.stringify({fake:{mode:'saved'}})));
  await backend.writeFile('/settings/templates/review.yaml',new TextEncoder().encode('prompt: "Review $topic: $input"\nsystem: "Be $style"\nmodel: fake\ndefaults:\n  style: terse\noptions:\n  enabled: true\nattachments:\n  - /work/shared.txt\n'));
  await backend.writeFile('/work/host.py', new TextEncoder().encode(String.raw`
import subprocess
from safe_host import call, stream, run, check_output, CalledProcessError, HostError
assert call('identity', {'number': 3, 'enabled': True}) == {'number': 3, 'enabled': True}
for size in (131000, 131072, 131500):
 payload = 'x' * size + '\u03bb'
 assert call('identity', payload) == payload
with stream('llm', {'prompt': 'direct'}) as chunks:
 events = list(chunks)
 assert events[0] == {'type':'text','text':'direct'}
 assert events[-1]['response']['model'] == 'fake'
with stream('bytes') as chunks:
 assert next(chunks) == bytes([0,255,128])
try:
 call('missing')
 raise AssertionError('unknown capability succeeded')
except HostError:
 pass
with open('/work/shared.txt', 'w') as target:
 target.write('canonical\n')
result = call('shell', {'argv': ['rg', 'canonical', '/work/shared.txt']})
assert result['exitCode'] == 0, result
assert bytes(result['stdout']) == b'canonical\n', result
result = call('shell', {'argv': ['probe', '$(bad);*'], 'stdin': [0,255], 'cwd': '/work', 'env': {'CHILD': 'yes'}})
assert result == {'stdout': [0,255], 'stderr': [119], 'exitCode': 7}, result
with open('/work/shared.txt') as source:
 assert source.read() == 'changed'
assert check_output(['rg', 'changed', '/work/shared.txt'], text=True) == 'changed\n'
result = call('shell', {'script': 'llm pipeline | rg pipeline'})
assert result['exitCode'] == 0, result
result = call('shell', {'argv': ['llm', 'nested']})
assert bytes(result['stdout']) == b'nested\n', result
result = call('shell', {'argv': ['python', '-c', 'pass']})
assert result['exitCode'] == 1 and b'nested Python' in bytes(result['stderr']), result
for args, options in [(['wait'], {'timeout': 0.001}), (['overflow'], {})]:
 try:
  run(args, check=True, **options)
  raise AssertionError('bounded failure did not occur')
 except (HostError, subprocess.TimeoutExpired):
  pass
try:
 run(['missing-command'], check=True)
 raise AssertionError('unknown command succeeded')
except CalledProcessError as error:
 assert error.returncode == 127
assert call('identity', 'still-live') == 'still-live'
import llm
from pydantic import BaseModel, ConfigDict, ValidationError
from llm.templates import Template
from llm.models import Tool
from llm.utils import Fragment
from llm.errors import ModelError, NeedsKeyException
assert Template is llm.Template and Tool is llm.Tool
assert issubclass(NeedsKeyException, ModelError)
template = Template(name='worker', prompt='Review $topic: $input', defaults={'topic':'code'})
assert template.evaluate('body') == ('Review code: body', None)
assert template.vars() == {'topic','input'}
fragment = Fragment('reference-fragment', source='worker')
assert fragment.source == 'worker' and len(fragment.id()) == 64
class ReferenceOptions(llm.Options):
 model_config = ConfigDict(extra='forbid')
 temperature: float | None = None
assert ReferenceOptions(temperature='0.5').model_dump() == {'temperature': 0.5}
try:
 ReferenceOptions(unknown=True)
 raise AssertionError('extra option was accepted')
except ValidationError:
 pass
class TypedReferenceModel(llm.Model):
 model_id = 'typed-custom'
 Options = ReferenceOptions
 def execute(self, prompt, stream, response, conversation):
  assert isinstance(prompt.options, ReferenceOptions)
  yield str(prompt.options.temperature)
assert TypedReferenceModel().prompt('typed', temperature='0.75').text() == '0.75'
declared = llm.Model('declared', metadata={'options': {'temperature': {'type': 'number', 'minimum': 0, 'maximum': 2}}})
assert declared.prompt('typed', temperature='0.5').prompt.options.temperature == 0.5
try:
 declared.prompt('invalid', temperature=3)
 raise AssertionError('option bound ignored')
except ValidationError:
 pass
class ReferenceSchema(BaseModel):
 name: str
 age: int
assert llm.get_model('fake').prompt('reference-schema', schema=ReferenceSchema).text() == 'reference-schema'

class CustomizedModel(llm.Model):
 model_id = "customized"
 def execute(self, prompt, stream, response, conversation):
  yield prompt.prompt.upper()
assert CustomizedModel().prompt("customized").text() == "CUSTOMIZED"
assert issubclass(llm.Model.Options, llm.Options)
assert isinstance(CustomizedModel().prompt("typed-default").prompt.options, llm.Options)
assert isinstance(llm.get_model('fake').prompt("typed-discovered").prompt.options, llm.Options)
try:
 CustomizedModel().prompt("invalid-options", unexpected=True)
 raise AssertionError("base Options accepted unknown field")
except ValidationError:
 pass
class CustomizedAsyncModel(llm.AsyncModel):
 model_id = "customized-async"
 async def execute(self, prompt, stream, response, conversation):
  yield prompt.prompt.upper()
async def check_customized_async():
 assert await CustomizedAsyncModel().prompt("async-customized").text() == "ASYNC-CUSTOMIZED"
def tool_add(value: int):
 return value + 1
assert llm.Tool.function(tool_add).input_schema['properties']['value'] == {'type': 'integer'}
class CustomizedToolModel(llm.Model):
 model_id = 'custom-tools'
 supports_tools = True
 def execute(self, prompt, stream, response, conversation):
  if prompt.tool_results:
   yield prompt.tool_results[0].output
  else:
   response.add_tool_call(llm.ToolCall('tool_add', {'value': 4}, 'native-tool'))
   yield 'tool:'
assert CustomizedToolModel().chain('go', tools=[tool_add]).text() == 'tool:5'
class CustomizedAsyncToolModel(llm.AsyncModel):
 model_id = 'custom-async-tools'
 supports_tools = True
 async def execute(self, prompt, stream, response, conversation):
  if prompt.tool_results:
   yield prompt.tool_results[0].output
  else:
   response.add_tool_call(llm.ToolCall('async_tool_add', {'value': 5}, 'native-async-tool'))
   yield 'async-tool:'
async def async_tool_add(value: int):
 await asyncio.sleep(0)
 return value + 1
async def check_customized_tools():
 chain = CustomizedAsyncToolModel().chain('go', tools=[async_tool_add])
 assert await chain.text() == 'async-tool:6'
 assert len(chain.conversation.responses) == 2
 started = asyncio.Event()
 closed = []
 async def waiting_tool(value: int):
  started.set()
  try:
   await asyncio.Event().wait()
  finally:
   closed.append(value)
 response = CustomizedAsyncToolModel().prompt('go', tools=[llm.Tool.function(waiting_tool, name='async_tool_add')])
 task = asyncio.create_task(response.execute_tool_calls())
 await started.wait()
 task.cancel()
 try:
  await task
 except asyncio.CancelledError:
  pass
 assert closed == [5]
assert llm.decode(llm.encode([1, -2.5])) == (1.0, -2.5)
assert llm.cosine_similarity([1, 0], [0, 1]) == 0.0
model = llm.get_model('fake')
assert model.supports_schema and model.attachment_types == {'text/plain'}
assert model.prompt('reference-inline', attachments=[llm.Attachment(type='text/plain', content=bytes([0,255,128]))]).text() == 'reference-inline'
assert llm.get_async_model('fake').supports_schema
assert model.prompt('reference-schema', schema=llm.schema_dsl('name, age int')).text() == 'reference-schema'
fragment_response = llm.get_model('fake').prompt('body', fragments=[fragment], system_fragments=['  first  '], system=' second ')
assert fragment_response.text() == 'reference-fragment' + chr(10) + 'body'
assert fragment_response.text_or_raise() == str(fragment_response)
assert fragment_response.duration_ms() >= 0
assert fragment_response.datetime_utc().endswith('+00:00')
attachment = llm.Attachment(path='/work/shared.txt')
assert attachment.resolve_type() == 'text/plain'
assert attachment.content_bytes() == b'changed'
assert llm.get_model('fake').prompt('reference-attached', attachments=[attachment]).text() == 'reference-attached'
conversation = llm.get_model('fake').conversation()
first_response = conversation.prompt('reference-first')
assert conversation.responses == []
assert first_response.text() == 'reference-first'
assert conversation.prompt('reference-second').text() == 'reference-second'
assert len(conversation.responses) == 2
class CustomBinaryEmbedding(llm.EmbeddingModel):
 model_id = 'custom-binary'
 supports_text = False
 supports_binary = True
 def embed_batch(self, items):
  for item in items:
   yield [float(len(item))]
assert CustomBinaryEmbedding().embed(b'abc') == [3.0]
embedding_model = llm.get_embedding_model('fake')
assert embedding_model.embed('ordinary') == [1.0, 2.0]
assert list(embedding_model.embed_multi(iter(['one', 'two', 'three']), batch_size=2)) == [[1.0, 2.0]] * 3
from pyodide.ffi import run_sync
from poe_llm import Client as LlmClient, CapabilityError, Attachment, Message, LimitError
import asyncio
from poe_shell import Client as ShellClient
import subprocess
def expected_bytes(offset, count):
 start = offset % 256
 return (bytes(range(256)) * ((start + count + 255) // 256))[start:start + count]

async def qualify_libraries():
 await check_customized_async()
 await check_customized_tools()
 reference_response = llm.get_async_model('fake').prompt('reference-async')
 assert aiter(reference_response) is reference_response
 assert await anext(reference_response) == 'reference-async'
 assert await reference_response is reference_response
 assert reference_response.text_or_raise() == 'reference-async'
 assert await reference_response.duration_ms() >= 0
 assert (await reference_response.datetime_utc()).endswith('+00:00')
 synchronous = await reference_response.to_sync_response()
 assert str(synchronous) == 'reference-async' and synchronous.id == reference_response.id
 assert [chunk async for chunk in reference_response] == ['reference-async']
 async_conversation = llm.get_async_model('fake').conversation()
 assert await async_conversation.prompt('reference-first').text() == 'reference-first'
 assert await async_conversation.prompt('reference-second').text() == 'reference-second'
 assert len(async_conversation.responses) == 2
 async with LlmClient() as client:
  assert not hasattr(client, 'load_schema')
  response = await client.complete('library', options={'enabled': True, 'count': 2, 'nullable': None})
  assert response.text == 'library' and response.usage['input'] == 3 and response.metadata['id'] == 'fake-response'
  response = await client.complete('attached', messages=[Message('assistant','prior')], schema={'type':'object'}, attachments=[Attachment('/work/shared.txt')], options={'temperature':0.7})
  assert response.text == 'attached'
  response = await client.complete('native', template='review', parameters={'topic':'code'})
  assert response.text == 'Review code: native'
  async with client.stream('native', template='review', parameters={'topic':'code'}) as template_stream:
   template_events = [event async for event in template_stream]
   assert template_events[0].text == 'Review code: native' and template_events[-1].response.model == 'fake'
  models = await client.models()
  assert models[0].id == 'fake' and 'saved' in models[0].aliases
  configuration = await client.configuration()
  assert configuration.default_model == 'saved' and configuration.aliases == {'saved':'fake'}
  assert configuration.model_options == {'fake':{'mode':'saved'}}
  alias_records = llm.get_models_with_aliases()
  alias_record = next(item for item in alias_records if item.model.model_id == 'fake')
  assert alias_record.matches('SAVED') and alias_record.async_model.model_id == 'fake'
  embedding_records = llm.get_embedding_models_with_aliases()
  assert any(item.model.model_id == 'fake' and item.matches('SAVED') for item in embedding_records)
  assert llm.get_default_model() == 'saved'
  llm.set_default_model('  fake  ', filename='python-profile.txt')
  assert llm.get_default_model('python-profile.txt') == 'fake'
  llm.set_default_model(None, filename='python-profile.txt')
  assert llm.get_default_model('python-profile.txt', None) is None
  llm.set_default_embedding_model('fake')
  assert llm.get_default_embedding_model() == 'fake'
  llm.set_default_embedding_model(None)
  assert llm.get_default_embedding_model() is None
  assert llm.get_default_model() == 'saved'
  import os
  original_cwd = os.getcwd()
  original_user_path = os.environ.get('LLM_USER_PATH')
  try:
   os.chdir('/guest')
   os.environ['LLM_USER_PATH'] = '/guest/config'
   guest_configuration = await client.configuration()
   assert guest_configuration.default_model == 'guest-alias' and guest_configuration.model_options == {'fake':{'mode':'guest'}}
   assert 'guest-alias' in (await client.models())[0].aliases
   await client.configure('set_alias',name='temporary',model='guest-alias')
   await client.configure('set_default_model',model='temporary')
   await client.configure('set_model_option',model='temporary',name='mode',value='changed')
   changed = await client.configuration()
   assert changed.default_model == 'fake' and changed.aliases['temporary'] == 'fake'
   assert changed.model_options['fake']['mode'] == 'changed'
   async with ShellClient() as child:
    changed_bash = await child.run(['llm','aliases','list'],text=True,check=True)
    assert 'temporary' in changed_bash.stdout
   await client.configure('clear_model_option',model='temporary')
   await client.configure('remove_alias',name='temporary')
   await client.configure('set_default_model',model='guest-alias')
   await client.configure('set_model_option',model='fake',name='mode',value='guest')
   guest_response = await client.complete('native', template='review')
   assert guest_response.text == 'Guest native'
   async with ShellClient() as child:
    guest_bash = await child.run(['llm','-t','review','native'],text=True,check=True)
    assert guest_bash.stdout == guest_response.text + '\n'
  finally:
   os.chdir(original_cwd)
   if original_user_path is None:
    os.environ.pop('LLM_USER_PATH',None)
   else:
    os.environ['LLM_USER_PATH'] = original_user_path
  response = await client.complete('configured', model='saved', options={'mode':'override'})
  assert response.model == 'fake' and response.text == 'configured'
  embedded = await client.embed((value for value in ['input']), model='saved')
  assert embedded.vectors == ((1.0, 2.0),) and embedded.metadata['id'] == 'embedding-1'
  try:
   await client.embed(['input'],model='saved',max_response_bytes=1)
   raise AssertionError('Embedding envelope limit was ignored')
  except LimitError:
   pass
  assert (await client.embed(['input'],model='saved')).vectors == embedded.vectors
  async with client.stream('library-stream') as early:
   assert (await early.__anext__()).text == 'incremental'
  async with client.stream('library-stream') as chunks:
   events = [event async for event in chunks]
   assert events[0].text == 'incremental'
   assert events[1].text == '-end' and events[-1].response.model == 'fake'
  with open('/work/large-input.bin', 'wb') as large:
   for _ in range(4096):
    large.write(bytes([173]) * 4096)
   large.write(bytes([173]) * 7)
  large_result = await client.complete('large-source', attachments=[Attachment('/work/large-input.bin', mime_type='text/plain')])
  assert large_result.text == '16777223' and large_result.metadata['id'] == 'large-source'
  for prompt in ['host-buffer', 'host-empty', 'host-metadata']:
   try:
    await client.complete(prompt, max_response_bytes=1000000)
    raise AssertionError('host-owned LLM limit was bypassed')
   except LimitError:
    pass
  async with client.stream('large-text') as early:
   first = await early.__anext__()
   assert len(first.text.encode('utf-8')) <= 16384
  pattern = '🌍é\n'
  count = 0
  terminals = 0
  with open('/work/text-stream.txt', 'w', encoding='utf-8') as output:
   async with client.stream('large-text') as events:
    async for event in events:
     if event.type == 'text':
      assert len(event.text.encode('utf-8')) <= 16384
      start = count % len(pattern)
      assert event.text == (pattern * ((start + len(event.text) + 2) // 3))[start:start + len(event.text)]
      output.write(event.text)
      count += len(event.text)
     else:
      terminals += 1
      assert count == 900000 and event.response.metadata['id'] == 'text-result'
  import os
  assert terminals == 1 and os.stat('/work/text-stream.txt').st_size == 2100000
  offset = 0
  async with client.stream('large-binary', model='binary') as chunks:
   async for event in chunks:
    if event.type == 'bytes':
     assert len(event.data) <= 16384
     assert event.data == expected_bytes(offset, len(event.data))
     offset += len(event.data)
    else:
     assert offset == 2 * 1024 * 1024 and event.response.metadata['id'] == 'large-image'
  async with client.stream('library-binary', model='binary') as chunks:
   events = [event async for event in chunks]
   assert events[0].data + events[1].data == bytes([0,255,128])
   assert events[-1].response.model == 'binary'
  try:
   await client.complete('bounded', max_response_bytes=1)
   raise AssertionError('LLM limit was lost')
  except LimitError:
   pass
  task = asyncio.create_task(client.complete('cancel-call'))
  await asyncio.sleep(0.005)
  task.cancel()
  try:
   await task
   raise AssertionError('guest cancellation failed')
  except asyncio.CancelledError:
   pass
  await asyncio.sleep(0.005)
  try:
   await client.complete('error-call')
   raise AssertionError('host error was lost')
  except CapabilityError as error:
   assert 'private-host-error' not in str(error)
 async with ShellClient() as child:
  result = await child.run(['rg', 'changed', '/work/shared.txt'], text=True)
  assert result.stdout == 'changed\n'
  for write_bytes in [262144, 16384]:
   async with child.stream(['large-shell', str(write_bytes)]) as events:
    offset = 0
    exits = 0
    async for event in events:
     if event.type == 'stdout':
      assert len(event.data) <= 16384
      assert event.data == expected_bytes(offset, len(event.data))
      offset += len(event.data)
     elif event.type == 'exit':
      exits += 1
      assert event.returncode == 0
    assert offset == 262144 and exits == 1
  async with child.stream(['pulse']) as early:
   assert (await early.__anext__()).data == bytes([0,255])
  async with child.stream(['rg', 'changed', '/work/shared.txt']) as events:
   streamed = [event async for event in events]
   assert streamed[0].data == b'changed\n' and streamed[-1].returncode == 0
run_sync(qualify_libraries())
try:
 subprocess.run(['wait'], capture_output=True, timeout=0.001)
 raise AssertionError('subprocess timeout failed')
except subprocess.TimeoutExpired as error:
 assert error.output == bytes([0,255]) and error.stderr == b'w'
assert subprocess.check_output(['env-probe'], env={}) == b'clear'
assert subprocess.check_output(['env-probe']) == b'inherited'
result = subprocess.run(['rg', 'changed', '/work/shared.txt'], capture_output=True, text=True, check=True)
assert result.stdout == 'changed\n'
print('host-ok')
`));
  const shell = new Shell({fs:backend, cwd:'/work',env:{PARENT:'present',LLM_USER_PATH:'/settings'}});
  shell.use({ name: 'host-fixture', setup(host) {
    for (const command of createSearchCommands()) host.commands.register(command);
    host.commands.register({name:'env-probe', async execute(context) {
      await context.stdout.write(new TextEncoder().encode(context.env.PARENT === undefined ? 'clear' : 'inherited'));
      return {exitCode:0};
    }});
    host.commands.register({ name: 'wait', async execute(context) {
      await context.stdout.write(new Uint8Array([0,255]));
      await context.stderr.write(new Uint8Array([119]));
      await new Promise(resolve => context.signal.addEventListener('abort', resolve, {once:true}));
      context.signal.throwIfAborted();
      return {exitCode:0};
    } });
    host.commands.register({ name:'pulse', async execute(context) {
      try {
        await context.stdout.write(new Uint8Array([0,255]));
        await new Promise(resolve => {
          if (context.signal.aborted) resolve();
          else context.signal.addEventListener('abort', resolve, {once:true});
        });
        context.signal.throwIfAborted();
        return {exitCode:0};
      } finally { if (context.signal.aborted) shellStreamCancelled++; }
    } });
    host.commands.register({ name: 'large-shell', async execute(context) {
      const bytes = Uint8Array.from({length:262144}, (_, i) => i % 256);
      const writeBytes = Number(context.args[0]);
      for (let offset = 0; offset < bytes.length; offset += writeBytes) await context.stdout.write(bytes.subarray(offset, offset + writeBytes));
      return {exitCode:0};
    } });
    host.commands.register({ name: 'overflow', async execute(context) {
      await context.stdout.write(new Uint8Array(524289));
      return {exitCode:0};
    } });
    host.commands.register({ name: 'probe', async execute(context) {
      if (context.args[0] !== '$(bad);*' || context.env.CHILD !== 'yes' || context.cwd !== '/work') throw new Error('Child state mismatch');
      for await (const bytes of context.stdin) await context.stdout.write(bytes);
      await context.fs.writeFile('/work/shared.txt', new TextEncoder().encode('changed'));
      await context.stderr.write(new Uint8Array([119]));
      return {exitCode:7};
    } });
  } });
  shell.use(standardCommands());
  shell.use(llmCommands({service}));
  shell.use(pythonCommands({ createExecutor() {
    const executor = createExecutor();
    return { run(start) { retiredBridge = start.host; return executor.run(start); }, terminate: executor.terminate.bind(executor) };
  }, maxConcurrentWorkers:1, capabilityLimits:{maxMessageBytes:1048576,maxConcurrentCalls:2,maxStreams:2}, createCapabilities(context) {
    return {
      identity: { async call(value) { calls++; return value; } },
      llm: createPythonLlmCapability(context,service,{maxBufferedResponseBytes:8192,maxBufferedEvents:64,maxMetadataBytes:4096}),
      bytes: { async *stream() { try { yield new Uint8Array([0,255,128]); yield 'unused'; } finally { released++; } } },
      shell: createPythonShellCapability(context, {maxOutputBytes:524288}),
    };
  } }));
  try {
    const result = await shell.exec('python host.py');
    const examples = [];
    await backend.mkdir('/project');
    await backend.writeFile('/project/task.txt', new TextEncoder().encode('TODO example\n'));
    for (const [name, source] of Object.entries(libraryExamples)) {
      await backend.writeFile('/work/' + name, new TextEncoder().encode(source));
      const run = await shell.exec('python ' + name);
      examples.push({name, exitCode:run.exitCode, stdout:run.stdout, stderr:run.stderr});
    }
    let retirementRejected = false;
    try { await retiredBridge.request({version:1, operation:'call', capability:'identity', value:null}); }
    catch { retirementRejected = true; }
    const sibling = new Shell({fs:backend, cwd:'/work'}).use(pythonCommands({createExecutor, createCapabilities() {
      return { identity:{async call() { return 'sibling-authority'; }} };
    } }));
    let siblingResult;
    try { siblingResult = await sibling.exec(`python -c "from safe_host import call; print(call('identity'))"`); }
    finally { await sibling.dispose(); }
    return {examples, shellStreamCancelled, retirementRejected, sibling:siblingResult.stdout, siblingExit:siblingResult.exitCode, exitCode:result.exitCode, stdout:result.stdout, stderr:result.stderr, calls, released, hostCancelled, libraryReleased, inputSourceBytes};
  } finally { await shell.dispose(); }
}

const program = `
import os, stat, sys, zlib, _csv, local_module
assert local_module.answer == 42
assert os.stat('/work/input.bin').st_size == 3
device_stat = os.stat('/dev/null')
assert stat.S_ISCHR(device_stat.st_mode)
assert device_stat.st_mode == 0o020666
assert device_stat.st_uid == device_stat.st_gid == 0
assert device_stat.st_size == 0 and device_stat.st_nlink == 1
assert device_stat.st_atime_ns == device_stat.st_mtime_ns == device_stat.st_ctime_ns == 0
assert os.lstat('/dev/null') == device_stat
assert os.stat('/dev/null') == device_stat
for flags in (os.O_RDONLY, os.O_WRONLY, os.O_RDWR):
 descriptor = os.open('/dev/null', flags)
 try:
  assert os.fstat(descriptor) == device_stat
 finally:
  os.close(descriptor)
directory_stat = os.stat('/dev')
assert stat.S_ISDIR(directory_stat.st_mode)
assert directory_stat.st_mode == 0o040755
assert directory_stat.st_uid == directory_stat.st_gid == 0
assert directory_stat.st_size == 0 and directory_stat.st_nlink == 1
assert directory_stat.st_atime_ns == directory_stat.st_mtime_ns == directory_stat.st_ctime_ns == 0
assert os.lstat('/dev') == directory_stat
assert os.stat('/dev') == directory_stat
assert device_stat.st_dev == directory_stat.st_dev
assert device_stat.st_ino != directory_stat.st_ino
assert device_stat.st_dev != os.stat('/work/input.bin').st_dev
with open('/work/input.bin', 'rb') as source:
 data = source.read()
with open('/work/data.csv', 'r') as source:
 assert list(_csv.reader(source)) == [['a', 'b'], ['1', '2']]
descriptor = os.open('/work/input.bin', os.O_RDONLY)
assert os.lseek(descriptor, 2, os.SEEK_SET) == 2
assert os.read(descriptor, 1) == bytes([42])
os.close(descriptor)
with open('/work/output.bin', 'wb') as output:
 output.write(zlib.decompress(zlib.compress(data)))
assert sys.stdin.buffer.read() == bytes([255, 0, 42])
sys.stdout.buffer.write(data)
sys.stderr.buffer.write(bytes([255, 0]))
try:
 open('/work/absent', 'rb')
except FileNotFoundError as error:
 assert error.errno == 44
else:
 raise AssertionError('missing file did not fail')
`;

const finalization = `
import atexit
buffered = open('/work/buffered', 'wb')
buffered.write(bytes([255, 0, 43]))
class Finalizer:
 def __del__(self, write=open, report=_record_finalization_failure, metadata=os.stat):
  try:
   assert metadata('/work/input.bin').st_size == 3
   with write('/work/destructor', 'wb') as output:
    output.write(bytes([44]))
  except BaseException as error:
   report('destructor: ' + str(error))
finalizer = Finalizer()
def finalize():
 try:
  assert os.stat('/work/input.bin').st_size == 3
  assert 'input.bin' in os.listdir('/work')
  with open('/work/finalized', 'wb') as output:
    output.write(bytes([42]))
  sys.stdout.buffer.write(bytes([45]))
 except BaseException as error:
  _record_finalization_failure('atexit: ' + str(error))
atexit.register(finalize)
`;

const background = `
import asyncio
asyncio.get_event_loop().call_later(0.025, _record_late_callback)
`;

const tasks = `
import asyncio
from pyodide.ffi import run_sync
async def background_task():
 try:
  await asyncio.sleep(3600)
 finally:
  await asyncio.sleep(0)
  with open('/work/task-finalized', 'wb') as output:
   output.write(bytes([46]))
async def generator():
 try:
  yield 42
 finally:
  await asyncio.sleep(0)
  with open('/work/generator-finalized', 'wb') as output:
   output.write(bytes([47]))
task = asyncio.create_task(background_task())
stream = generator()
assert run_sync(stream.__anext__()) == 42
run_sync(asyncio.sleep(0))
`;

const standardLlm = `
import llm
from importlib.metadata import version
assert version('llm') == '0.27.1'
assert llm.Response.__module__ == 'llm.models'
assert llm.AsyncResponse.__module__ == 'llm.models'
assert callable(llm.get_model)
assert callable(llm.get_async_model)
assert callable(llm.get_embedding_model)
print('llm-reference-api')
`;

const cancelled = `
import atexit
atexit.register(_record_finalization_called)
with open('/work/cancel', 'rb') as source:
 source.read()
`;

export default {
  async fetch(request) {
    const mode = new URL(request.url).pathname;
    if (mode === '/unhandled-errors') {
      await new Promise(resolve => setTimeout(resolve, 0));
      return Response.json(unhandledErrors.snapshot());
    }
    const started = performance.now();
    const backend = new MemoryFileSystem();
    await backend.mkdir('/work');
    await backend.writeFile('/work/input.bin', new Uint8Array([0, 255, 42]));
    await backend.writeFile('/work/data.csv', new TextEncoder().encode('a,b\n1,2\n'));
    await backend.writeFile('/work/local_module.py', new TextEncoder().encode('answer = 42'));
    await backend.writeFile('/work/cancel', new Uint8Array([48]));
    const filesystem = new PythonFileSystem(createDeviceFileSystem(backend), { cwd: '/work' });
    const metadata = new PythonStatTranslator();
    const stdout = [];
    const stderr = [];
    const requests = [];
    const failures = [];
    const callbacks = [];
    const finalizations = [];
    const controller = new AbortController();
    let cancelHandle;
    const stdin = [255, 0, 42];
    let version;
    let memory;
    let retainedProxy;
    let activeRequests = 0;
    let maximumRequests = 0;
    let ticks = 0;
    const timer = setInterval(() => { ticks++; }, 1);
    const createExecutor = () => createPythonJspiExecutor({ trampoline, nativeCall, statResult, async loadRuntime(configuration) {
      const runtime = await loadPyodide({ indexURL: 'https://safe-python.invalid/', lockFileContents,
        async createPyodideModule(settings) {
          const instantiate = settings.instantiateWasm;
          const module = await createPyodideModule({ ...settings, instantiateWasm(imports, receive) {
            configuration.bindImports(imports);
            return instantiate(imports, (instance, module) => {
              configuration.bindInstance(instance);
              receive(instance, module);
            });
          } });
          configuration.bindScheduler(module.API);
          return module;
        }, jsglobals: configuration.jsglobals, args: configuration.args, env: configuration.env,
        enableRunUntilComplete: false });
      // Keep the legacy adapter contract separate from the genuine calling profile.
      if (mode === '/host') await installStaticPackages(runtime);
      else installPythonLlmPackages(runtime, llmPackageAssets);
      version = runtime.version;
      memory = runtime._module.HEAPU8.byteLength;
      if (mode === '/proxy') retainedProxy = runtime.globals;
      runtime._api.on_fatal = error => failures.push('fatal: ' + String(error));
      runtime.globals.set('_record_finalization_failure', message => failures.push(String(message)));
      runtime.globals.set('_record_late_callback', () => callbacks.push('late'));
      runtime.globals.set('_record_finalization_called', () => finalizations.push('atexit'));
      runtime.runPython('import builtins; builtins._record_finalization_failure = _record_finalization_failure; builtins._record_late_callback = _record_late_callback; builtins._record_finalization_called = _record_finalization_called');
      if (mode === '/startup-cancel') {
        runtime.runPython('import atexit; atexit.register(_record_finalization_called)');
        controller.abort(new Error('startup cancelled'));
      }
      return runtime;
    } });
    if (mode === '/publication' || mode === '/publication-recovery') {
      try { return Response.json({...await qualifyPublication(backend, createExecutor, mode === '/publication-recovery'), failures}); }
      catch (error) { return Response.json({error:String(error), stack:error.stack, failures}, {status:500}); }
      finally { clearInterval(timer); await filesystem.close(); }
    }
    if (mode === '/llm-functions') {
      try {return Response.json({...await qualifyFunctionTools(backend,createExecutor),failures});}
      catch(error) {return Response.json({error:String(error),stack:error.stack,failures},{status:500});}
      finally {clearInterval(timer);await filesystem.close();}
    }
    if (mode === '/llm-api' || mode === '/llm-api-cancel' || mode === '/llm-policy') {
      try { return Response.json({...await qualifyStandardLlm(backend,createExecutor,mode === '/llm-api-cancel',mode === '/llm-policy'),failures}); }
      catch(error) { return Response.json({error:String(error),stack:error.stack,failures},{status:500}); }
      finally {clearInterval(timer);await filesystem.close();}
    }
    if (mode === '/host') {
      try { return Response.json({...await qualifyHostServices(backend, createExecutor), failures, ticks}); }
      catch (error) { return Response.json({error:String(error), stack:error.stack, failures}, {status:500}); }
      finally { clearInterval(timer); await filesystem.close(); }
    }
    if (mode === '/shell') {
      try { return Response.json({...await qualifyShells(backend, createExecutor), failures, finalizations}); }
      catch (error) { return Response.json({error:String(error), stack:error.stack, failures}, {status:500}); }
      finally { clearInterval(timer); await filesystem.close(); }
    }
    const executor = createExecutor();
    try {
      const exitCode = await executor.run({ invocation: { args: ['-c', program + (mode === '/llm-standard' ? standardLlm : mode === '/finalization' ? finalization : mode === '/background' ? background : mode === '/tasks' ? tasks : mode === '/cancel' ? cancelled : '')], cwd: '/work', env: {} },
        signal: controller.signal, runtimeMount: '/.runtime', maxTransferBytes: 32, onReady() {},
        async dispatch(operation) {
          activeRequests++;
          maximumRequests = Math.max(maximumRequests, activeRequests);
          requests.push({ op: operation.op, path: typeof operation.args[0] === 'string' ? operation.args[0] : undefined });
          try {
            await new Promise(resolve => setTimeout(resolve, 1));
            if (operation.op === 'stdout' || operation.op === 'stderr') {
              (operation.op === 'stdout' ? stdout : stderr).push(...operation.args[0]);
              return operation.args[0].length;
            }
            if (operation.op === 'stdin') return stdin.splice(0, operation.args[0]);
            if (operation.op === 'read' && operation.args[0] === cancelHandle) controller.abort(new Error('cancelled'));
            const value = await filesystem.dispatch(operation);
            if (operation.op === 'open' && operation.args[0] === '/work/cancel') cancelHandle = value;
            return ['stat', 'lstat', 'fstat'].includes(operation.op) ? metadata.translate(value) : value;
          } finally { activeRequests--; }
        } });
      if (mode === '/background') await new Promise(resolve => setTimeout(resolve, 50));
      if (mode === '/proxy') {
        try { retainedProxy.destroy(); }
        catch (error) { failures.push('proxy retirement: ' + String(error)); }
      }
      return Response.json({ exitCode, version, memory, stdout, stderr, requests, failures, callbacks, ticks, maximumRequests,
        output: Array.from(await backend.readFile('/work/output.bin')),
        finalized: await backend.readFile('/work/finalized').then(bytes => Array.from(bytes), () => null),
        buffered: await backend.readFile('/work/buffered').then(bytes => Array.from(bytes), () => null),
        destructor: await backend.readFile('/work/destructor').then(bytes => Array.from(bytes), () => null),
        taskFinalized: await backend.readFile('/work/task-finalized').then(bytes => Array.from(bytes), () => null),
        generatorFinalized: await backend.readFile('/work/generator-finalized').then(bytes => Array.from(bytes), () => null),
        elapsedMs: performance.now() - started,
        qualification: 'custom native I/O and lifecycle; not managed Python or deployment qualification' });
    } catch (error) {
      if (mode === '/cancel' || mode === '/startup-cancel') {
        await executor.terminate();
        await new Promise(resolve => setTimeout(resolve, 50));
        return Response.json({error: String(error), finalizations, failures});
      }
      return Response.json({ error: String(error), stack: error.stack, stdout, stderr, requests, failures }, { status: 500 });
    } finally { clearInterval(timer); await executor.terminate(); await filesystem.close(); }
  },
};
