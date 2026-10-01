# SQLite runtime

Run native SQLite with a caller-owned virtual filesystem in Node or Cloudflare Workers. Each runtime has its own native memory and one reusable unicode61 callback slot. Worker builds import precompiled WebAssembly assets; Node compiles the same embedded executable bytes on first use, including after bundling.

The runtime provides SQLite 3.53.0 from `@journeyapps/wa-sqlite` 2.0.6 and its `FacadeVFS` bridge. Register your filesystem before opening a database. The caller owns bounded I/O, connection lifetimes, cancellation, private storage and atomic publication; this package does not create temporary data files or install a memory filesystem.

```js
import { createSqliteRuntime, FacadeVFS } from 'safe-bash-sqlite-engine';
const runtime = await createSqliteRuntime({ signal });
const vfs = Object.assign(new FacadeVFS('private', runtime.module), callbacks);
runtime.module.vfs_register(vfs, true);
```
