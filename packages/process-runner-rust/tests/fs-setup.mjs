import {beforeEach,vi}from'vitest';import {fs,vol}from'memfs';import {tmpdir}from'node:os';
vi.mock('node:fs',()=>({...fs,default:fs}));
vi.mock('node:fs/promises',()=>({default:fs.promises,...fs.promises,readFile:(...args)=>fs.promises.readFile(...args)}));
beforeEach(()=>{vol.reset();fs.mkdirSync(tmpdir(),{recursive:true});});
