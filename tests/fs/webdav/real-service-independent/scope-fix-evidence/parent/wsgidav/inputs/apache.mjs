import { createServer } from 'node:net';
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';

export async function apacheConfig(workspace) {
  const listener = createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const { port } = listener.address();
  await new Promise(resolve => listener.close(resolve));
  await mkdir(`${workspace}/locks`);
  const modules = ['mpm_prefork', 'unixd', 'auth_basic', 'authn_file', 'authn_core', 'authz_core', 'authz_user', 'authz_host', 'alias', 'ssl', 'dav', 'dav_fs'];
  const config = `ServerRoot "${workspace}"
DefaultRuntimeDir "${workspace}"
PidFile "${workspace}/httpd.pid"
Mutex file:${workspace}
Listen 127.0.0.1:${port}
ServerName 127.0.0.1
${modules.map(name => `LoadModule ${name}_module /usr/libexec/apache2/mod_${name}.so`).join('\n')}
User #${process.getuid()}
Group #${process.getgid()}
ErrorLog "${workspace}/error.log"
LogLevel warn
ServerTokens Full
Timeout 10
KeepAlive Off
SSLEngine on
SSLCertificateFile "${workspace}/cert.pem"
SSLCertificateKeyFile "${workspace}/key.pem"
SSLSessionCache none
DocumentRoot "${workspace}/root"
DavLockDB "${workspace}/locks/DavLock"
Alias /dav "${workspace}/root"
Alias /alias "${workspace}/root"
Alias /readonly "${workspace}/root"
<Directory "${workspace}/root">
  Dav On
  Options FollowSymLinks
  AllowOverride None
  FileETag INode MTime Size
  AuthType Basic
  AuthName fixture
  AuthBasicProvider file
  AuthUserFile "${workspace}/passwords"
  Require user fixture
</Directory>
<Location /readonly>
  <LimitExcept GET HEAD OPTIONS PROPFIND>
    Require all denied
  </LimitExcept>
</Location>
`;
  await writeFile(`${workspace}/httpd.conf`, config);
  await writeFile(`${workspace}/passwords`, `fixture:{SHA}${createHash('sha1').update('fixture-only-password').digest('base64')}\n`);
  const artifacts = {};
  for (const file of ['/usr/sbin/httpd', ...modules.map(name => `/usr/libexec/apache2/mod_${name}.so`)]) {
    artifacts[file] = createHash('sha256').update(await readFile(file)).digest('hex');
  }
  return { port, config, artifacts };
}
