import { expect, it } from 'vitest';
import { validateWire } from './wire-validation.js';
import type {JobRequest} from './wire.generated.js';
const jobRequest:JobRequest={buildDigest:'a'.repeat(64),toolId:'tool',args:[[],[255]],namespaceId:'n',materializationRevision:null,cwd:'/work',env:{},stdin:{kind:'stream',seekable:false},descriptors:[],grants:[],freshness:'live',limits:{maxJobs:1,maxHandles:4,maxArgvBytes:64,maxManifestEntries:8,maxFrameBytes:4096,maxInflightBytes:8192,maxBlobBytes:8192,maxReplayBytes:65536,maxCallbacks:8,maxNativeMemoryBytes:8192,maxNativeProcesses:4,maxJobDurationMs:10000}};
it('enforces materialization readiness binding conditionals', () => {
  const binding={operationId:'prepared',root:'/work'};
  for (const value of [jobRequest,{...jobRequest,materializationRevision:'1',materializationBinding:binding}]) expect(() => validateWire('JobRequest',value)).not.toThrow();
  for (const value of [{...jobRequest,materializationRevision:'1'},{...jobRequest,materializationBinding:binding}]) expect(() => validateWire('JobRequest',value)).toThrow();
});
it('admits the dependency streaming job schema with original argv and rejects buffered legacy results',()=>{
  const request={...jobRequest,materializationRevision:'revision',materializationBinding:{operationId:'prepared',root:'/work'},dependencyBinding:{bindingId:'host-binding',sourceAuthorityId:'source',materializationId:'prepared',invocation:{manifestId:'manifest',manifestRevision:'manifest-revision',directoryRevision:'revision',cwd:[47,119,111,114,107],originalArgv:[[],[255]]}}};
  expect(()=>validateWire('DependencyJobRequest',request)).not.toThrow();
  for(const value of [{...request,dependencyBinding:undefined},{...request,materializationBinding:undefined},{...request,stdout:[255]},{...request,args:[[null]]}])expect(()=>validateWire('DependencyJobRequest',value)).toThrow();
});
it('rejects sparse argv and octets even when their prototype supplies a value',()=>{
 const args=new Array(1);Object.setPrototypeOf(args,Object.assign(Object.create(Array.prototype),{0:[]}));
 const octets=new Array(1);Object.setPrototypeOf(octets,Object.assign(Object.create(Array.prototype),{0:1}));
 for(const value of [args,[octets]])expect(()=>validateWire('JobRequest',{...jobRequest,args:value})).toThrow();
});
it('admits canonical directory removal with byte paths', () => {
  expect(() => validateWire('Operation', { operation: 'rmdir', path: [47, 255] })).not.toThrow();
  expect(() => validateWire('Operation', { operation: 'rmdir', path: [0] })).toThrow();
});
it('selects streaming effects for direct records and nested control/recovery records', () => {
  const effect = { operationId:'op', sequence:'1', operation:'write', state:'applied', namespaceId:'work' };
  expect(() => validateWire('Effect', effect)).not.toThrow();
  for (const bytes of [[], [0, 255]]) {
    const legacy = { ...effect, bytes };
    expect(() => validateWire('Effect', legacy)).toThrow();
    expect(() => validateWire('Control', {type:'Effect', effect:legacy})).toThrow();
    expect(() => validateWire('EffectManifest', {jobId:'j',effects:[legacy],outputs:[],effectBarrier:'1',outputComplete:true})).toThrow();
  }
});
it('strictly validates control fields and semantic integer bounds without accepting rounded positions', () => {
  const ack = { type: 'Ack', laneId: 'a', sequence: '18446744073709551615', offsets: [{ channelId: 2, offset: '0' }] };
  expect(() => validateWire('Control', ack)).not.toThrow();
  for (const value of [{ ...ack, extra: 1 }, { ...ack, sequence: '18446744073709551616' }, { ...ack, sequence: '01' }, { ...ack, offsets: [{ channelId: 2.1, offset: '0' }] }]) expect(() => validateWire('Control', value)).toThrow();
});
it('rejects signed seek overflow and negative zero', () => {
  for (const offset of ['-0','9223372036854775808','-9223372036854775809']) expect(() => validateWire('FileOperation', { op: 'seek', handleId: 'h', offset, whence: 'set' })).toThrow();
});
it('validates byte manifest paths against the versioned canonical extension and rejects ambiguous representations',()=>{
  const entry={type:'file',pathBytes:[97],blobId:'b'};
  expect(()=>validateWire('Manifest',{version:1,capture:'observed-traversal',entries:[entry]})).not.toThrow();
  for(const invalid of [{...entry,path:'a'},{...entry,pathBytes:[0]},{...entry,pathBytes:[256]},{type:'file',blobId:'b'},{type:'symlink',path:'a',target:'b',targetBytes:[98]}])expect(()=>validateWire('Entry',invalid)).toThrow();
});
it('validates canonical file offsets and timestamps directly without rounding',()=>{
  expect(()=>validateWire('FileOffset','9223372036854775807')).not.toThrow();
  expect(()=>validateWire('Timestamp','-9223372036854775808')).not.toThrow();
  for(const value of ['01','-0','-1','9223372036854775808','1e3'])expect(()=>validateWire('FileOffset',value)).toThrow();
});
