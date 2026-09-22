import {Volume, createFsFromVolume} from 'memfs';
import {createHash} from 'node:crypto';
import {expect, it, vi} from 'vitest';
import {verifyMediaExecutableAssets} from './build-assets.js';

function fixture(){
 const volume=Volume.fromJSON({'/assets/ffmpeg':'ffmpeg bytes','/assets/magick':'magick bytes'});
 const fs=createFsFromVolume(volume);
 const open=vi.fn((path:string)=>fs.createReadStream(path));
 const executablePaths={ffmpeg:'/assets/ffmpeg',magick:'/assets/magick'};
 const expectedExecutableDigests=Object.fromEntries(Object.entries(executablePaths).map(([name,path])=>[name,createHash('sha256').update(volume.readFileSync(path) as Buffer).digest('hex')]));
 return {volume,open,executablePaths,expectedExecutableDigests,maxExecutableBytes:64};
}
it('verifies every configured executable from independently pinned digests using streams',async()=>{
 const input=fixture();await verifyMediaExecutableAssets(input);
 expect(input.open.mock.calls.map(([path])=>path)).toEqual(['/assets/ffmpeg','/assets/magick']);
});
it('refuses drifted ImageMagick bytes instead of pinning whatever was extracted',async()=>{
 const input=fixture();input.volume.writeFileSync('/assets/magick','changed bytes');
 await expect(verifyMediaExecutableAssets(input)).rejects.toThrow('Executable digest mismatch: magick');
});
it.each(['missing','extra','invalid','path','bound'] as const)('rejects %s configuration before opening executable assets',async kind=>{
 const input=fixture();
 if(kind==='missing')delete (input.expectedExecutableDigests as Record<string,string>).magick;
 if(kind==='extra')input.expectedExecutableDigests.other='a'.repeat(64);
 if(kind==='invalid')input.expectedExecutableDigests.magick='not a digest';
 if(kind==='path')input.executablePaths.magick='/assets/../magick';
 if(kind==='bound')input.maxExecutableBytes=0;
 await expect(verifyMediaExecutableAssets(input)).rejects.toThrow();expect(input.open).not.toHaveBeenCalled();
});
it('stops oversized executable streams and retires their iterator',async()=>{
 let closed=false;const open=vi.fn(async function*(){try{yield new Uint8Array(5);throw new Error('read beyond admitted bound');}finally{closed=true;}});
 await expect(verifyMediaExecutableAssets({executablePaths:{tool:'/tool'},expectedExecutableDigests:{tool:'a'.repeat(64)},maxExecutableBytes:4,open})).rejects.toThrow('Executable byte bound');
 expect(closed).toBe(true);
});
it('admits executable streams by their actual byte span before hashing',async()=>{
 let closed=false;const bytes=new Uint8Array(5);const length=vi.fn(()=>1);
 Object.defineProperty(bytes,'byteLength',{get:length});
 const open=vi.fn(async function*(){try{yield bytes;}finally{closed=true;}});
 await expect(verifyMediaExecutableAssets({executablePaths:{tool:'/tool'},expectedExecutableDigests:{tool:createHash('sha256').update(bytes).digest('hex')},maxExecutableBytes:4,open})).rejects.toThrow('Executable byte bound');
 expect(length).not.toHaveBeenCalled();expect(closed).toBe(true);
});
it('uses the admitted byte bound without rereading an accessor-backed configuration',async()=>{
 const input=fixture();let reads=0;
 Object.defineProperty(input,'maxExecutableBytes',{get(){return ++reads===1?4:64;}});
 await expect(verifyMediaExecutableAssets(input)).rejects.toThrow('Executable byte bound');
 expect(reads).toBe(1);
});
it('retains the executable storage receiver and method through verification',async()=>{
 const input=fixture();const selected=input.open;
 const replacement=vi.fn(()=>{throw new Error('replacement storage must not run');});
 const storage={...input,selected,open(path:string){this.open=replacement;return this.selected(path);}};
 await expect(verifyMediaExecutableAssets(storage)).resolves.toBeUndefined();
 expect(replacement).not.toHaveBeenCalled();
 expect(selected.mock.calls.map(([path])=>path)).toEqual(['/assets/ffmpeg','/assets/magick']);
});
