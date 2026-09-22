import {createServer} from 'node:http';
import {createMediaDeployment} from './media-server.mjs';
import {createMediaHttpHandler} from './http-server.mjs';
import {createContainerMediaLifecycle} from './container-lifecycle.mjs';
// This module must supply authentication, a deployment-qualified native
// namespace driver, build inventory, admissions, upload storage and all limits.
// No host-directory, FUSE or R2 mount is inferred as canonical live access.
const {default:options}=await import('./deployment.mjs');
const port=Number(process.env.POE_CODE_SERVER_PORT??8080);
if(!Number.isSafeInteger(port)||port<1||port>65535)throw new Error('Valid service port required');
if(!options.server.driver.features.some(feature=>feature.name==='live-files'&&feature.evidence.length))throw new Error('Sandbox native namespace qualification required');
const media=await createMediaDeployment(options);
const server=createServer(createMediaHttpHandler({origin:options.origin,maxConnections:options.maxConnections,fetch:media.fetch}));
const shutdown=createContainerMediaLifecycle({server,media,intervalMs:options.sweepIntervalMs,onError:error=>console.error('Lease sweep failed',error),closeOperator:()=>options.close()});
server.listen(port,'0.0.0.0');
// Deployment owner must drain jobs and delegates; exiting alone is not proof
// of canonical output settlement. A failed cleanup prevents a success exit.
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,async()=>{
 try{await shutdown();process.exitCode=0;}catch(error){console.error(error);process.exitCode=1;}
});
