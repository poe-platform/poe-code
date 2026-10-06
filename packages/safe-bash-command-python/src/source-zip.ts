import type {CommandContext} from 'safe-bash-contracts';
import {openPythonPackageFile} from './package-file.js';
import {extractPythonSourceZipFile} from './source-zip-extract.js';

/** Extract a source ZIP into an owned, confined build directory using pip's flattening policy. */
export async function extractPythonSourceZip(source:string,directory:string,maxBytes:number,context:CommandContext):Promise<void>{
 if(maxBytes!==Infinity&&(!Number.isSafeInteger(maxBytes)||maxBytes<0))throw new RangeError('Invalid Python source archive size limit');
 if(!context.fs.writeStream)throw new Error('Python source archives require streaming writes');
 const input=await openPythonPackageFile(context,source,maxBytes);
 if(!input)throw new Error('Python source archives require retained reads');
 await extractPythonSourceZipFile(input,directory,maxBytes,context);
}
