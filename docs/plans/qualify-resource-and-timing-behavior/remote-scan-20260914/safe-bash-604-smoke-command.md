# Installed safe-bash 0.1.604 smoke command

Run in the independent consumer directory recorded in `installed-604-smokes.json`, after installing the exact package version. Execute this source with Node; assertions remain bounded and no wall-clock unit test is added.

```javascript
import assert from 'node:assert/strict';
import {Shell, createMemoryFileSystem, agentCommands} from '@poe-platform/safe-bash';
const fs=createMemoryFileSystem(); await fs.writeFile('/note',new TextEncoder().encode('hello\n'));
const shell=new Shell({fs}).use(agentCommands());
try {const r=await shell.exec('cat /note'); assert.equal(r.exitCode,0); assert.equal(r.stdout,'hello\n'); const denied=await shell.exec('node --version'); assert.equal(denied.exitCode,127); console.log('Bash604 memory filesystem and explicit command admission passed');} finally {await shell.dispose();}
```
