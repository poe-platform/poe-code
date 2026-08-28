import {parseReviewArgs,reviewBuildTypes} from './review-build-types.mjs';

if(import.meta.main){
  try{const{openFencedWorker}=await import('./fenced-supervisor.mjs');process.exitCode=await reviewBuildTypes(parseReviewArgs(process.argv.slice(2)),openFencedWorker());}
  catch(error){console.error(error.stack);process.exitCode=error.exitCode??78;}
}
