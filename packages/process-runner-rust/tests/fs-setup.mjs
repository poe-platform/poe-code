import {beforeEach,vi}from'vitest';import {fs,vol}from'memfs';import {tmpdir}from'node:os';
vi.mock('node:fs',()=>({...fs,default:fs}));
beforeEach(()=>{vol.reset();fs.mkdirSync(tmpdir(),{recursive:true});});
