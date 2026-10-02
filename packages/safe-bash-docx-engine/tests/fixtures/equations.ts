import {chartFixture,chartContext,type FixtureResource} from './charts.js';
export const equationContext=chartContext;
export const equationNamespace=(strict=false)=>strict?'http://purl.oclc.org/ooxml/officeDocument/math':'http://schemas.openxmlformats.org/officeDocument/2006/math';
export function inlineEquation(strict=false,text='a'):string{return '<m:oMath xmlns:m="'+equationNamespace(strict)+'"><m:r><m:t>'+text+'</m:t></m:r></m:oMath>';}
export function displayEquation(strict=false):string{return '<m:oMathPara xmlns:m="'+equationNamespace(strict)+'"><m:oMathParaPr><m:jc m:val="center"/></m:oMathParaPr><m:oMath><m:f><m:num/><m:den/></m:f></m:oMath><m:oMath><m:sSub><m:e/><m:sub/></m:sSub></m:oMath></m:oMathPara>';}
export function equationFixture(options:{strict?:boolean;body?:string;resources?:readonly FixtureResource[]}={}):Promise<Uint8Array>{return chartFixture({strict:options.strict??false,definitions:[],relationships:[],resources:options.resources??[],body:options.body??'<w:p><w:r><w:t>coast</w:t></w:r>'+inlineEquation(options.strict)+displayEquation(options.strict)+'</w:p>'});}
