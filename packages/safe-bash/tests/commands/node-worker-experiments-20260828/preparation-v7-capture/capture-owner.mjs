export function createCaptureOwner(io, { maxBytes = 1048576, maxWritesPerChunk = 64 } = {}) {
  const names = Reflect.ownKeys(io);
  if (names.length !== 3 || names.some((name,index) => name !== ['open','write','close'][index])) throw Error('capture IO shape');
  for (const name of names) { const descriptor = Object.getOwnPropertyDescriptor(io,name); if (!Object.hasOwn(descriptor,'value') || typeof descriptor.value !== 'function') throw Error('capture own callbacks'); }
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 1048576 || !Number.isSafeInteger(maxWritesPerChunk) || maxWritesPerChunk < 1 || maxWritesPerChunk > 64) throw Error('capture limits');
  const slots = [{acquired:false,descriptor:undefined,closeAttempted:false,closed:false},{acquired:false,descriptor:undefined,closeAttempted:false,closed:false}];
  const primary = {present:false,value:undefined,origin:null};
  const secondary = [];
  let seen = 0; let written = 0; let writes = 0;
  function record(value,origin) { if (!primary.present) { primary.present=true;primary.value=value;primary.origin=origin; } else if (secondary.length < 8) secondary.push({present:true,value,origin}); }
  function close() {
    for (const slot of slots) {
      if (!slot.acquired || slot.closeAttempted) continue;
      slot.closeAttempted=true;
      try { io.close(slot.descriptor); slot.closed=true; } catch(value) { record(value,'capture-close'); }
    }
    return slots.every(slot=>!slot.acquired||slot.closed);
  }
  function acquire(paths) {
    try {
      for (let index=0;index<2;index+=1) { slots[index].descriptor=io.open(paths[index]);slots[index].acquired=true; }
      return true;
    } catch(value) { record(value,'capture-open');close();return false; }
  }
  function write(index,bytes) {
    if (primary.present) return false;
    try {
      if (index!==0&&index!==1 || !ArrayBuffer.isView(bytes) || bytes.BYTES_PER_ELEMENT!==1 || !Number.isSafeInteger(bytes.byteLength)) throw Error('capture chunk');
      const slot=slots[index]; if(!slot.acquired||slot.closeAttempted)throw Error('capture closed');
      if(bytes.byteLength>maxBytes-seen)throw Error('capture byte ceiling');seen+=bytes.byteLength;
      let offset=0;let attempts=0;
      while(offset<bytes.byteLength){if(++attempts>maxWritesPerChunk)throw Error('capture short-write bound');const count=io.write(slot.descriptor,bytes,offset,bytes.byteLength-offset);writes+=1;if(!Number.isSafeInteger(count)||count<=0||count>bytes.byteLength-offset)throw Error('capture zero/invalid write');offset+=count;written+=count;}
      return true;
    } catch(value) { record(value,'capture-write');return false; }
  }
  function snapshot(){return{primary:{present:primary.present,origin:primary.origin},secondary:secondary.map(record=>({present:record.present,origin:record.origin})),slots:slots.map(slot=>({acquired:slot.acquired,closeAttempted:slot.closeAttempted,closed:slot.closed})),bytesSeen:seen,bytesWritten:written,writeCalls:writes,cleanupComplete:slots.every(slot=>!slot.acquired||slot.closed)};}
  return {acquire,write,close,record,primary,secondary,snapshot};
}
