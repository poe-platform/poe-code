import {functionalProfile} from './functional-profile.mjs';
export { referenceData, envelopeData, reviewData, authorityReceiptData, runIdentifier } from '../../../executor-v7-r2/contracts.mjs';
import { grantData as admissionGrantData } from '../../../executor-v7-r2/contracts.mjs';
import { dataObject } from '../../../executor-v7-r2/schema.mjs';
export function grantData(value) {
  const row=dataObject(value,['role','phase','attempts','runId','outputRoot','recipeSha256','reviewSha256','planSha256','bootstrapProfile','reportProtocol','candidate','packSha256','command','acceptedAdmission','functionalProfile']);
  if(!row || row.functionalProfile!==functionalProfile || row.phase!=='cohort' || row.reportProtocol!=='BOUNDED_SEMANTIC_TERMINAL_V2')return null;
  const {functionalProfile:selectedProfile,...original}=row;
  const checked=admissionGrantData({...original,reportProtocol:'BOUNDED_TERMINAL_V3'});
  return checked?{...checked,reportProtocol:'BOUNDED_SEMANTIC_TERMINAL_V2',functionalProfile:selectedProfile}:null;
}

