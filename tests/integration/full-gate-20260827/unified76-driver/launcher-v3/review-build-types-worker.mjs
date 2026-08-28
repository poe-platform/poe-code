import {parseReviewArgs,reviewBuildTypes} from './review-build-types.mjs';

if(import.meta.main){
  try{process.exitCode=await reviewBuildTypes(parseReviewArgs(process.argv.slice(2)));}
  catch(error){console.error(error.stack);process.exitCode=error.exitCode??78;}
}
