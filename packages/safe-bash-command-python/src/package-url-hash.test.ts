import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {pythonPackageUrlHash} from './package-url-hash.js';
const python=process.env.LLM_TEST_PYTHON??'python3';
const available=spawnSync(python,['-B','-c','import pip; assert pip.__version__ == "21.2.4"'],{timeout:5000}).status===0;
test('package URL hash selection matches pinned pip without URLSearchParams decoding',{skip:!available&&!process.env.LLM_TEST_PYTHON?'Requires pinned pip==21.2.4':false},()=>{
 const urls=['https://example.test/source.zip',...['sha1','sha224','sha384','sha256','sha512','md5'].flatMap(name=>[
  'https://example.test/source.zip#'+name+'=abc123',
  'https://example.test/source.zip?'+name+'=abc#sha256=def',
  'https://example.test/source.zip#'+name+'=ABC',
  'https://example.test/source.zip#'+name+'=abcXYZ',
  'https://example.test/source.zip#'+name+'=%61bc',
  'https://example.test/source.zip#not'+name+'=abc',
  'https://example.test/source.zip#'+name+'=&md5=def',
  'https://example.test/source.zip#'+name+'=abc&'+name+'=def',
 ])];
 const result=spawnSync(python,['-B','-c','import json,sys; from pip._internal.models.link import Link; print(json.dumps([[Link(url).hash_name,Link(url).hash] if Link(url).hash else None for url in json.load(sys.stdin)]))'],{input:JSON.stringify(urls),encoding:'utf8',timeout:5000});
 assert.ifError(result.error);assert.equal(result.status,0,result.stderr);
 assert.deepEqual(urls.map(url=>pythonPackageUrlHash(url)??null),JSON.parse(result.stdout));
});
