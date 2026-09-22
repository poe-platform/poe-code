import type {ContainerProviderConfig} from '../deployment.js';
export default {
 port:8080,
 transferLimits:{maxChunkBytes:1024*1024,maxBytes:256*1024*1024,maxWallClockMs:5*60*1000},
 lifecycle:{sleepAfter:'5m',keepAlive:false,enableDefaultSession:false,containerTimeouts:{instanceGetTimeoutMS:30000,portReadyTimeoutMS:90000}},
 transport:'rpc'
} satisfies ContainerProviderConfig;
