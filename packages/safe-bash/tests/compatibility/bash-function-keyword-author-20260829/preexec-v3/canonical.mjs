import fs from 'node:fs';
import path from 'node:path';
export function canonicalRoot(root){if(!path.isAbsolute(root)||!root.startsWith('/private/tmp/')||fs.realpathSync(root)!==root)throw Error('CANONICAL_ROOT');return root;}
export function assertOwned(root,filename){if(filename!==root&&!filename.startsWith(root+'/'))throw Error('OWNED_PATH');if(filename.split('/').some(part=>part==='.'||part==='..'))throw Error('PATH_COMPONENT');return filename;}
export function validateCanonicalRole(root,role,env){canonicalRoot(root);for(const name of ['app','entry','guard','trace','rolePath'])assertOwned(root,role[name]);for(const filename of [...role.readFiles,...Object.keys(role.files)])assertOwned(root,filename);for(const name of ['HOME','TMPDIR','PATH'])assertOwned(root,env[name]);if(fs.realpathSync(role.app)!==role.app)throw Error('APP_CANONICAL');return role;}
