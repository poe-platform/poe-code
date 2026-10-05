import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import vm from 'node:vm';
import { Volume } from 'memfs';

const source = (readFileSync(new URL('./cargo-target.mjs', import.meta.url), 'utf8').replace('export function', 'function') + '\n' + readFileSync(new URL('./cargo.mjs', import.meta.url), 'utf8'))
  .split('\n').filter(line => !line.startsWith('import ')).join('\n')
  .replaceAll('import.meta.url', JSON.stringify('file:///repo/packages/demo-rust/scripts/cargo.mjs'));
function run(volume, operation, calls, env = {}, cacheWritable = true) {
  const fs = Object.fromEntries(['accessSync','copyFileSync','existsSync','mkdirSync','readdirSync','readFileSync','statSync','writeFileSync'].map(name=>[name,volume[name].bind(volume)]));
  const context = { ...fs, accessSync: (...args) => { if (!cacheWritable) throw new Error("read-only cache"); return fs.accessSync(...args); }, constants: { W_OK: 2 }, createHash, path,
    os: { homedir:()=>'/home',tmpdir:()=>'/tmp' }, fileURLToPath: value => new URL(value).pathname,
    process: { argv:['node','cargo.mjs',operation],env:{npm_package_json:'/repo/packages/demo-rust/package.json', ...env},platform:'darwin',arch:'arm64',versions:{modules:'127'},execPath:'/node',exit:code=>{throw new Error(`exit ${code}`);} },
    createRequire:()=>({resolve:()=>'/napi/package.json'}),
    copyNativeBinding:(from,to)=>volume.copyFileSync(from,to),runNativeTests:()=>{},
    spawnSync:(command,args,options)=>{calls.push([command,args,options]);if(command==='/node'){
      const out=args[args.indexOf('--output-dir')+1];volume.mkdirSync(out,{recursive:true});
      volume.writeFileSync(path.join(out,'demo.node'),'compiled:'+volume.readFileSync('/repo/packages/demo-rust/src/lib.rs','utf8'));
      volume.writeFileSync(path.join(out,'native.d.ts'),'declarations');
    }return {status:0};}
  };
  vm.runInNewContext(source,context);
}
test('test/build never promote an unverified existing addon into a new source cache entry',()=>{
  const volume=Volume.fromJSON({
    '/repo/packages/demo-rust/package.json':'{}','/repo/packages/demo-rust/Cargo.toml':'manifest',
    '/repo/packages/demo-rust/bindings/Cargo.toml':'binding','/repo/packages/demo-rust/src/lib.rs':'new source',
    '/repo/packages/demo-rust/src/index.d.ts':'types','/repo/packages/demo-rust/tests/check.rs':'test one',
    '/repo/packages/demo-rust/dist/demo.node':'old binary','/repo/packages/demo-rust/dist/native.d.ts':'old types'
  });
  const calls=[];
  run(volume,'test',calls);
  assert.equal(calls.filter(([command])=>command==='/node').length,1);
  assert.equal(volume.readFileSync('/repo/packages/demo-rust/dist/demo.node','utf8'),'compiled:new source');
  calls.length=0;run(volume,'test',calls);assert.equal(calls.length,0,'unchanged verified inputs reuse the cache');
  volume.writeFileSync('/repo/packages/demo-rust/tests/check.rs','test two');
  calls.length=0;run(volume,'test',calls);assert.ok(calls.some(([command])=>command==='cargo'),'changed Rust tests run again');
  volume.writeFileSync('/repo/packages/demo-rust/src/lib.rs','newer source');
  calls.length=0;run(volume,'build',calls);
  assert.equal(calls.filter(([command])=>command==='/node').length,1);
  assert.equal(volume.readFileSync('/repo/packages/demo-rust/dist/demo.node','utf8'),'compiled:newer source');
});

test('Cargo targets isolate checkouts while preserving warm reuse and caller overrides', () => {
  const volume = Volume.fromJSON({});
  const target = (env = {}) => {
    const calls = [];
    run(volume, 'lint', calls, env);
    return calls[0][2].env.CARGO_TARGET_DIR;
  };
  assert.notEqual(target(), target({ npm_package_json: '/other/packages/demo-rust/package.json' }));
  assert.equal(target(), target());
  assert.equal(target(), target({ npm_package_json: '/repo/packages/another-rust/package.json' }));
  assert.equal(target({ CARGO_TARGET_DIR: '/explicit' }), '/explicit');
  assert.equal(target({ CI: 'true', CARGO_TARGET_DIR: '/explicit' }), '/explicit');
  assert.equal(target({ CI: 'true' }), '/repo/out/rust-mcp-target');
});

test('unwritable cache fallback remains checkout-specific', () => {
  const volume = Volume.fromJSON({});
  const target = (root) => {
    const calls = [];
    run(volume, 'lint', calls, { npm_package_json: `${root}/packages/demo-rust/package.json` }, false);
    return calls[0][2].env.CARGO_TARGET_DIR;
  };
  assert.ok(target('/repo').startsWith('/tmp/poe-code/rust-mcp-target/'));
  assert.notEqual(target('/repo'), target('/other'));
  assert.equal(target('/repo'), target('/repo'));
});
