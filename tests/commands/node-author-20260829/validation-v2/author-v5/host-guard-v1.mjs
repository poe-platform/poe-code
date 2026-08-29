import childProcess from 'node:child_process';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import dgram from 'node:dgram';
import {syncBuiltinESMExports} from 'node:module';
const denied=()=>{throw new Error('AUTHOR_GUARD_NO_SUBPROCESS_OR_NETWORK');};
for(const key of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])childProcess[key]=denied;
for(const target of [net,http,https])for(const key of ['connect','createConnection','createServer','request','get'])if(key in target)target[key]=denied;
dgram.createSocket=denied;globalThis.fetch=denied;syncBuiltinESMExports();

