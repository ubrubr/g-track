import { AuthError } from './cloud.js';

// A server-confirmed acknowledgement is the only path that clears a pending op.
// The same operation UUID is retried after a lost response, using server receipts.
export class Synchronizer {
  constructor(repository, cloud, { online = () => navigator.onLine, onState = () => {}, lock = callback => navigator.locks ? navigator.locks.request(`form-sync:${repository.owner}`, callback) : callback() } = {}) {
    this.repository = repository; this.cloud = cloud; this.online = online; this.onState = onState; this.lock = lock; this.running = null; this.again = false;
  }
  run() {
    if (this.running) { this.again = true; return this.running; }
    this.running = this.lock(async () => {
      do { this.again = false; await this.pass(); } while (this.again && this.online());
    }).finally(() => { this.running = null; });
    return this.running;
  }
  async pass() {
    const operations = await this.repository.operations();
    if (!this.cloud) { this.onState({ state: 'signin', pending: operations.length }); return; }
    if (!this.online()) { this.onState({ state: operations.length ? 'pending' : 'device', pending: operations.length }); return; }
    this.onState({ state: 'syncing', pending: operations.length });
    try {
      for (const op of operations) {
        if (op.conflict) continue;
        const result = await this.cloud.push(op);
        if (result.status === 'conflict') await this.repository.markConflict(op, result.record);
        else {
          if (!result.record) throw new Error('Cloud did not confirm the saved workout.');
          await this.repository.acknowledge(op, result.record);
        }
      }
      await this.repository.mergeRemote(await this.cloud.pull());
      const remaining = await this.repository.operations();
      const conflicts = remaining.filter(op => op.conflict).length;
      this.onState({ state: this.cloud.upgradeNeeded?'upgrade':conflicts ? 'conflict' : remaining.length ? 'pending' : 'synced', pending: remaining.length, conflicts });
    } catch (error) {
      const remaining = await this.repository.operations();
      if(error.name==='SchemaUpgradeRequired')try{await this.repository.mergeRemote(await this.cloud.pull());}catch(readError){this.onState({state:readError instanceof AuthError?'signin':'failed',pending:remaining.length,message:readError.message});return;}
      this.onState({ state: error.name==='SchemaUpgradeRequired'?'upgrade':error instanceof AuthError ? 'signin' : 'failed', pending: remaining.length, message: error.message });
    }
  }
}
