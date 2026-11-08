import './fs-setup.mjs';
import {expect,it}from'vitest';import {fs,vol}from'memfs';
import {readDockerBuildContextFiles as own}from'../dist/docker-build-context.js';import {readDockerBuildContextFiles as sdk}from'../../process-runner/dist/docker/build-context.js';
it('matches SDK context bytes and sorting through nested ignore rules and symbolic links',async()=>{
 for(const rules of ['', 'ignored/\n*.tmp', '*\n!src/\n!src/keep.js', 'src/*\n!src/keep.js', '/top\n**/cache/\n*.JS', '.dockerignore\nassets/file?.[ch]']){
  vol.reset();vol.fromJSON({'/repo/.dockerignore':rules,'/repo/Dockerfile':'FROM node:22','/repo/src/keep.js':'export default "😀";','/repo/src/drop.tmp':'drop','/repo/src/UPPER.JS':'case','/repo/src/nested/deep':'deep','/repo/ignored/file':'hidden','/repo/top':'root','/repo/nested/top':'nested','/repo/nested/cache/file':'cached','/repo/assets/file1.c':'c'});fs.writeFileSync('/repo/binary',Buffer.from([0,255,128,10]));fs.symlinkSync('/repo/src','/repo/link');const expected=await sdk('/repo'),actual=await own('/repo');expect(actual).toEqual(expected);expect(actual.some(file=>file.relativePath==='.dockerignore')).toBe(true);expect(actual.some(file=>file.relativePath.startsWith('link'))).toBe(false);
 }
});
it('propagates original missing-root and read errors without converting their realms',async()=>{
 await expect(own('/missing')).rejects.toMatchObject({code:'ENOENT'});vol.fromJSON({'/repo/.dockerignore':'','/repo/file':'x'});const original=fs.promises.readFile,fault=Object.assign(new Error('read denied'),{code:'EACCES'});fs.promises.readFile=async()=>{throw fault;};try{await expect(own('/repo')).rejects.toBe(fault);}finally{fs.promises.readFile=original;}
});
