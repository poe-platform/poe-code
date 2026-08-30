import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {admitPackage} from './package-admission.mjs';
import {validateTar,archiveFailureRecord} from './parse-manifest.mjs';
export {validateTar,archiveFailureRecord};
export async function admitOwnerArchive(spec,observation={}){
 const events=[],ledger={current:0,peak:0,maximum:67108864};let tarBuffer;observation.events=events;observation.decodeCalls=0;observation.ledger=ledger;
 const admission=await admitPackage(spec.archive.path,{bytes:spec.archive.bytes,sha256:spec.archive.sha256,decodedLimit:33554432},ledger,{events,decode(bytes,limits){observation.decodeCalls++;observation.decoderInput={bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};return gunzipSync(bytes,limits);},parse(bytes){tarBuffer=bytes;return validateTar(bytes,spec.shipping,spec.archive.shippingMembers);}});
 return {admission,events,ledger,tarBuffer};
}
