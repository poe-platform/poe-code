import adapter from './engine-adapter-v1.mjs';
export default Object.freeze({abi:adapter.abi,identity:adapter.identity,async execute(input){process.stdout.write('AUTHOR_NATIVE_STDOUT_PROBE\n');process.stderr.write('AUTHOR_NATIVE_STDERR_PROBE\n');return adapter.execute(input);}});

