/** pip 21.2.4 Link selects the first supported lowercase hash anywhere in the URL. */
export function pythonPackageUrlHash(url:string):readonly [algorithm:'sha1'|'sha224'|'sha384'|'sha256'|'sha512'|'md5',digest:string]|undefined {
 const match=/(sha1|sha224|sha384|sha256|sha512|md5)=([a-f0-9]+)/.exec(url);
 return match?[match[1] as 'sha1'|'sha224'|'sha384'|'sha256'|'sha512'|'md5',match[2]!]:undefined;
}
