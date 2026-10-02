# SQLite runtime

Run native SQLite with a caller-owned virtual filesystem in Node or Cloudflare Workers. Each runtime has its own native memory and one reusable unicode61 callback slot. Worker builds import precompiled WebAssembly assets; Node compiles the same embedded executable bytes on first use, including after bundling.

The runtime provides SQLite 3.53.0 from `@journeyapps/wa-sqlite` 2.0.6 and its `FacadeVFS` bridge. Register your filesystem before opening a database. The caller owns bounded I/O, connection lifetimes, cancellation, private storage and atomic publication; this package does not create temporary data files or install a memory filesystem.

```js
import { createSqliteRuntime, FacadeVFS } from 'safe-bash-sqlite-engine';
const runtime = await createSqliteRuntime({ signal });
const vfs = Object.assign(new FacadeVFS('private', runtime.module), callbacks);
runtime.module.vfs_register(vfs, true);
```

For a caller-owned private directory, `safe-bash-sqlite-engine/safe-fs` provides
`createSqliteVfs({ fs, directory, signal, maxOpenFiles, maxFileBytes })`. Assign
its callbacks to `FacadeVFS` as above. The filesystem must support positioned
descriptor reads/writes, truncate and sync. Transfers use owned buffers of at
most 16 KiB, retry short transfers, and preserve the original filesystem or
cancellation error through `callbacks.throwIfFailed()`. Close the native
connection before awaiting `callbacks.dispose()` to release remaining handles.

The caller must exclusively own the directory for the connection's lifetime;
the adapter does not lock shared database paths or publish staged databases.
Only direct child files are admitted, temporary files are exclusively created
and removed on close, and file growth and open handles are budgeted. Use this
adapter for private transaction working files, with the caller responsible for
retained source acquisition, atomic publication and removal of the directory.
