def read_source_origin(request):
 import re, json
 from urllib.parse import urlsplit, urlunsplit
 source = request['source']
 if source.startswith('/'):
  from pathlib import Path
  source = Path(source).as_uri()
 url = urlsplit(source)
 netloc = url.netloc
 if '@' in netloc:
  credentials, host = netloc.split('@', 1)
  if not re.match(r'^\$\{[A-Za-z0-9-_]+\}(:\$\{[A-Za-z0-9-_]+\})?$', credentials): netloc = host
 result = {'url': urlunsplit((url.scheme, netloc, url.path, url.query, ''))}
 subdirectory = re.search(r'[#&]subdirectory=([^&]*)', source)
 if subdirectory: result['subdirectory'] = subdirectory.group(1)
 info = {}
 if not request['directory']:
  hashed = re.search(r'(sha1|sha224|sha384|sha256|sha512|md5)=([a-f0-9]+)', source)
  if hashed: info['hash'] = hashed.group(1) + '=' + hashed.group(2)
 result['dir_info' if request['directory'] else 'archive_info'] = info
 return json.dumps(result, sort_keys=True)
