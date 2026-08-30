if (process.argv.length !== 2 || typeof process.send !== 'function') {
  throw new Error('This static control requires its supervisor IPC channel');
}

let received = false;
process.on('message', (message) => {
  if (received || message !== 'start') throw new Error('Unexpected control message');
  received = true;
  process.send('started', (error) => { if (error) throw error; });
});
process.send('ready', (error) => { if (error) throw error; });
