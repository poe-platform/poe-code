import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

export async function browserProcessInventory(maxAttempts = 3) {
  for (let attempt = 0; ; attempt++) {
    try {
      return execFileSync('ps', ['-axo', 'pid=,args='], { encoding: 'utf8', timeout: 5000 });
    } catch (error) {
      if (error.code !== 'ETIMEDOUT' || attempt === maxAttempts - 1) throw error;
      await delay(100);
    }
  }
}
