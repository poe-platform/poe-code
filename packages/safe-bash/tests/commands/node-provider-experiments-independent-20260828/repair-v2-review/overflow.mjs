process.stdout.write(Buffer.alloc(65537, 120));
const held = setInterval(() => {}, 1000);
setTimeout(() => { clearInterval(held); process.exitCode = 3; }, 4000);
