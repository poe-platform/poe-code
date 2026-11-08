import {createHash} from 'node:crypto'; if(createHash('sha256').update('').digest('hex').length!==64)throw Error('HASH');process.stdout.write('LOADER_READY\n');
