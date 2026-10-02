import {rawReaderLibrary, readerLibrary} from "./python/readers.js";
import {WASI, wasi as definitions, File, OpenFile, ConsoleStdout, PreopenDirectory, Directory, type Inode} from '@bjorn3/browser_wasi_shim';
declare const PYTHON_WASM: string;
declare const PYTHON_LIBRARIES: string;
interface Start {shared: SharedArrayBuffer; payload: string; banner: string; workLimit: number}
const decode = (text: string): Uint8Array<ArrayBuffer> => {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};
async function inflate(text: string): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await new Response(new Blob([decode(text)]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
}
async function run(start: Start, send: (message: unknown) => void): Promise<void> {
  const state = new Int32Array(start.shared, 0, 2);
  const transfer = new Uint8Array(start.shared, 8);
  let work = 0;
  const exchange = (channel: 'stdin' | 'stdout' | 'stderr' | 'reader', size: number): number => {
    Atomics.store(state, 0, 0);
    send({type: 'io', channel, size, work});
    Atomics.wait(state, 0, 0);
    if (Atomics.load(state, 0) !== 1) throw new Error('Python invocation retired');
    return Atomics.load(state, 1);
  };
  const output = (channel: 'stdout' | 'stderr') => new ConsoleStdout(bytes => {
    for (let offset = 0; offset < bytes.length; offset += transfer.length) {
      const chunk = bytes.subarray(offset, offset + transfer.length);
      transfer.set(chunk); exchange(channel, chunk.length);
    }
  });
  class Input extends OpenFile {
    constructor(readonly channel: 'stdin' | 'reader') {super(new File([]));}
    override fd_read(size: number) {
      const length = exchange(this.channel, Math.min(size, transfer.length));
      return {ret: 0, data: transfer.slice(0, length)};
    }
  }
  try {
    const [wasm, libraries] = await Promise.all([inflate(PYTHON_WASM), inflate(PYTHON_LIBRARIES)]);
    const site = new Directory(new Map());
    for (const [path, data] of Object.entries(JSON.parse(new TextDecoder().decode(libraries)) as Record<string, string>)) {
      const parts = path.split('/'); let directory = site;
      for (const name of parts.slice(0, -1)) {
        let child = directory.contents.get(name);
        if (!child) {child = new Directory(new Map()); directory.contents.set(name, child);}
        if (!(child instanceof Directory)) throw new Error('Invalid Python library tree');
        directory = child;
      }
      directory.contents.set(parts.at(-1)!, new File(decode(data), {readonly: true}));
    }
    class ReaderFile extends File {override path_open() {return {ret: 0, fd_obj: new Input('reader')};}}
    const root = new Map<string, Inode>([['records', new ReaderFile([])], ['site', site], ['input.json', new File(new TextEncoder().encode(start.payload), {readonly: true})]]);
    const source = `import sys,json,datetime,decimal,code
sys.path.insert(0,'/site')
import agate
with open('/input.json') as _input: _payload=json.load(_input)
agate.config.set_option('number_truncation_chars','' if _payload['settings'].get('no_number_ellipsis') else '…')
agate.config.set_option('default_locale','en_US_POSIX')
def _cell(value):
 if not isinstance(value,dict): return value
 kind=value['kind']
 if kind=='decimal': return decimal.Decimal(value['value'])
 if kind=='float': return float(value['value'])
 if kind=='date': return datetime.date.fromisoformat(value['value'])
 if kind=='datetime': return datetime.datetime.fromisoformat(value['value'])
 if kind=='timedelta': return datetime.timedelta(microseconds=int(value['microseconds']))
 raise ValueError('Unsupported table cell')
if _payload['mode']=='agate':
 _data=_payload['table']
 table=agate.Table([[_cell(v) for v in row] for row in _data['rows']],_data['headers'],[getattr(agate,c['type'])() for c in _data['columns']])
 _locals={'table':table}
else:
 import csv
 _raw={'__name__':'_csv'}
 exec(${JSON.stringify(rawReaderLibrary)},_raw)
 _library={'__name__':'agate.csv_py3','_CSVReader':_raw['_CSVReader'],'_CSVError':_raw['Error'],'FieldSizeLimitError':agate.exceptions.FieldSizeLimitError,'_field_limit':_payload['settings'].get('field_size_limit') or float('inf')}
 exec(${JSON.stringify(readerLibrary)},_library)
 _records=open('/records')
 def _read():
  line=_records.readline()
  if not line:return ['end']
  item=json.loads(line)
  if item[0]=='row':item[1]=[_cell(v) for v in item[1]]
  return item
 _settings=_payload['settings']
 _dialect=_raw['Dialect'](['\\t' if _settings.get('tabs') else (_settings.get('delimiter') or ','),(_settings.get('quotechar') or '"'),_settings.get('escapechar'),(_settings.get('quoting') or 0),_settings.get('doublequote',True),_settings.get('skipinitialspace',False)])
 reader=_library['DictReader' if _payload['mode']=='dict' else 'Reader'](_read,_dialect)
 if _payload['mode']=='reader':reader.header=not _settings.get('no_header_row',False)
 _locals={'reader':reader}
code.interact(banner=${JSON.stringify(start.banner)},local=_locals)
`;
    root.set('console.py', new File(new TextEncoder().encode(source), {readonly: true}));
    const wasi = new WASI(['python', '-B', '/console.py'], [], [new Input('stdin'), output('stdout'), output('stderr'), new PreopenDirectory('/', root)], {debug: false});
    // Guest filesystem writes are unavailable; only stdout/stderr are writable.
    for (const name of ['path_create_directory', 'path_filestat_set_times', 'path_link', 'path_remove_directory', 'path_rename', 'path_symlink', 'path_unlink_file', 'fd_allocate', 'fd_filestat_set_size', 'fd_filestat_set_times', 'fd_pwrite'] as const) wasi.wasiImport[name] = () => 69;
    const open = wasi.wasiImport.path_open!;
    wasi.wasiImport.path_open = (...args) => args[4] & 9 ? 69 : open(...args);
    const write = wasi.wasiImport.fd_write!;
    wasi.wasiImport.fd_write = (...args) => args[0] === 1 || args[0] === 2 ? write(...args) : 69;
    // Park the worker for Python sleep instead of the shim's CPU busy loop.
    const parking = new Int32Array(new SharedArrayBuffer(4));
    wasi.wasiImport.poll_oneoff = (inPtr, outPtr, count, eventsPtr) => {
      if (count !== 1) return definitions.ERRNO_NOTSUP;
      const view = new DataView(wasi.inst.exports.memory.buffer);
      const subscription = definitions.Subscription.read_bytes(view, inPtr);
      if (subscription.eventtype !== definitions.EVENTTYPE_CLOCK) return definitions.ERRNO_NOTSUP;
      if (subscription.clockid !== definitions.CLOCKID_MONOTONIC && subscription.clockid !== definitions.CLOCKID_REALTIME) return definitions.ERRNO_INVAL;
      const now = subscription.clockid === definitions.CLOCKID_MONOTONIC ? BigInt(Math.round(performance.now() * 1e6)) : BigInt(Date.now()) * 1000000n;
      const duration = subscription.flags & definitions.SUBCLOCKFLAGS_SUBSCRIPTION_CLOCK_ABSTIME ? subscription.timeout - now : subscription.timeout;
      if (duration > 0n) Atomics.wait(parking, 0, 0, Number(duration) / 1e6);
      new definitions.Event(subscription.userdata, 0, subscription.eventtype).write_bytes(view, outPtr);
      view.setUint32(eventsPtr, 1, true); return 0;
    };
    const instance = await WebAssembly.instantiate(await WebAssembly.compile(wasm), {wasi_snapshot_preview1: wasi.wasiImport, csvpy: {work() {
      if (++work > start.workLimit || !Number.isSafeInteger(work)) throw new Error('interpreter work budget exceeded');
    }}});
    const exitCode = wasi.start(instance as Parameters<WASI['start']>[0]);
    send({type: 'done', exitCode, work});
  } catch (error) {send({type: 'error', message: error instanceof Error ? error.message : String(error), work});}
}
void (async () => {
  if (typeof globalThis.postMessage === 'function') {
    globalThis.onmessage = (event: MessageEvent<Start>) => {void run(event.data, message => globalThis.postMessage(message));};
  } else {
    const {parentPort} = await import('node:worker_threads');
    parentPort!.once('message', (start: Start) => {void run(start, message => parentPort!.postMessage(message));});
  }
})();
