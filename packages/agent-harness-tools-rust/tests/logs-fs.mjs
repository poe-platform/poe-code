import {createFsFromVolume,Volume} from 'memfs';
import path from 'node:path';
const volume=new Volume(),fs=createFsFromVolume(volume).promises;
volume.mkdirSync('/',{recursive:true});
export const mkdir=fs.mkdir.bind(fs),readdir=fs.readdir.bind(fs),rm=fs.rm.bind(fs),symlink=fs.symlink.bind(fs),realpath=fs.realpath.bind(fs);
export async function mkdtemp(prefix){await mkdir(path.dirname(prefix),{recursive:true});return fs.mkdtemp(prefix);}
