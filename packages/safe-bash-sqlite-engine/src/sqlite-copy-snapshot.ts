import {FsError,type FileReadHandle} from 'safe-bash-contracts';
import type {SqliteSources} from './sqlite-sources.js';
import type {createPrivateSqliteStorage} from './sqlite-private.js';
import {createSqliteWalSnapshot} from './sqlite-wal.js';
import {writeSqliteFile} from './file-io.js';

/** Copy a retained source set into caller-owned private storage. Source binding
 * guards remain owned by the caller; WAL scratch handles are retired here. */
export async function copySqliteSnapshot(options:{sources:SqliteSources;storage:Awaited<ReturnType<typeof createPrivateSqliteStorage>>;path:string;signal:AbortSignal;maxFileBytes:number;maxIndexBytes:number}):Promise<{walMode:boolean}>{
 const {sources,storage,path:privatePath,signal,maxFileBytes,maxIndexBytes}=options;
 const path=sources.path,cleanups:(()=>Promise<void>)[]=[];
 const errors:unknown[]=[];let result!:{walMode:boolean};
 try{
  const copy = async (source: FileReadHandle, target: string): Promise<void> => {
      const stat = await source.stat({ signal });
      if (!Number.isSafeInteger(stat.size) || stat.size < 0 || stat.size > maxFileBytes) throw new FsError('EFBIG', { path: target });
      const file = await storage.fs.open!(target, { access: 'readwrite', creation: 'exclusive', signal });
      try {
        for (let position = 0; position < stat.size;) {
          const bytes = await source.read(position, Math.min(16384, stat.size - position), { signal });
          if (!bytes.length || bytes.length > Math.min(16384, stat.size - position)) throw new FsError('EIO', { path: target });
          await writeSqliteFile(file, bytes, position, signal);
          position += bytes.length;
        }
      } finally { await file.close(); }
    };
    let snapshot = sources.database?.file;
    if (snapshot && sources.wal?.stat.size) {
      const index = await storage.fs.open!(`${privatePath}-index`, { access: 'readwrite', creation: 'exclusive', signal });
      cleanups.push(() => index.close());
      snapshot = await createSqliteWalSnapshot(snapshot, sources.wal.file, index, { signal, maxIndexBytes });
      const overlay = snapshot;
      cleanups.push(() => overlay.close());
    }
    if (!snapshot && (sources.wal?.stat.size || sources.journal?.stat.size)) throw new FsError('EIO', { path, message: 'SQLite sidecar has no database' });
    let walMode = false;
    if (snapshot) {
      await copy(snapshot, privatePath);
      const file = await storage.fs.open!(privatePath, { access: 'readwrite', creation: 'never', signal });
      try {
        const header = new Uint8Array(20);
        let count = 0;
        while (count < header.length) {
          const read = await file.read(header.subarray(count), count, { signal });
          if (!read) break;
          count += read;
        }
        walMode = count === 20 && header[18] === 2 && header[19] === 2;
        if (walMode) await writeSqliteFile(file, new Uint8Array([1, 1]), 18, signal);
      } finally { await file.close(); }
    }
    if (sources.journal?.stat.size) {
      if (walMode) throw new FsError('EIO', { path, message: 'SQLite WAL database has a rollback journal' });
      await copy(sources.journal.file, `${privatePath}-journal`);
    }
    sources.validate();
    result={walMode};
 }catch(error){errors.push(error);}
 for(const cleanup of cleanups.reverse())try{await cleanup();}catch(error){errors.push(error);}
 if(errors.length===1)throw errors[0];
 if(errors.length)throw new AggregateError(errors,'SQLite snapshot copy and cleanup failed');
 return result;
}
