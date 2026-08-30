export { referenceData, envelopeData, reviewData, authorityReceiptData, runIdentifier } from '../../../executor-v7-r2/contracts.mjs';
import { grantData as admissionGrantData } from '../../../executor-v7-r2/contracts.mjs';
import { dataObject } from '../../../executor-v7-r2/schema.mjs';
export function grantData(value) {
  const row=dataObject(value,['role','phase','attempts','runId','outputRoot','recipeSha256','reviewSha256','planSha256','bootstrapProfile','reportProtocol','candidate','packSha256','command','acceptedAdmission']);
  if(!row || row.phase!=='cohort' || row.reportProtocol!=='BOUNDED_SEMANTIC_TERMINAL_V1')return null;
  const checked=admissionGrantData({...row,reportProtocol:'BOUNDED_TERMINAL_V3'});
  return checked?{...checked,reportProtocol:'BOUNDED_SEMANTIC_TERMINAL_V1'}:null;
}
