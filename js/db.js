import { clone, uuid, validateWorkout, validateDraft, contentKey, DEFAULT_SETTINGS } from './domain.js';

const request = req => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
export async function openDatabase(name = 'form-fitness-v1') {
  const req = indexedDB.open(name, 1);
  req.onupgradeneeded = () => {
    const db = req.result;
    const workouts = db.createObjectStore('workouts', { keyPath: 'key' });
    workouts.createIndex('owner', 'owner');
    workouts.createIndex('ownerDate', ['owner', 'date'], { unique: true });
    const ops = db.createObjectStore('ops', { keyPath: 'key' });
    ops.createIndex('owner', 'owner');
    db.createObjectStore('drafts', { keyPath: 'owner' });
    db.createObjectStore('settings', { keyPath: 'owner' });
    db.createObjectStore('meta', { keyPath: 'key' });
  };
  const db = await request(req);
  db.onversionchange = () => db.close();
  return db;
}
export function transaction(db, names, mode, operation) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(names, mode);
    const stores = Object.fromEntries(names.map(name => [name, tx.objectStore(name)]));
    let result, failure;
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(failure || tx.error || new Error('Local storage transaction was cancelled.'));
    tx.onerror = () => { /* onabort reports the final transaction error */ };
    Promise.resolve().then(() => operation(stores)).then(value => { result = value; }).catch(error => { failure = error; try { tx.abort(); } catch { reject(error); } });
  });
}
export const getMeta = (db, key) => transaction(db, ['meta'], 'readonly', async ({ meta }) => (await request(meta.get(key)))?.value);
export const setMeta = (db, key, value) => transaction(db, ['meta'], 'readwrite', ({ meta }) => { meta.put({ key, value: clone(value) }); });
export class DuplicateDateError extends Error {
  constructor(record) { super('A workout already exists for this date. Open it with Edit workout.'); this.record = record; }
}
export class StaleEditError extends Error {
  constructor(record) { super('This workout changed after you opened this draft. Review both versions before saving.'); this.record = record; }
}
export class Repository {
  constructor(db, owner = 'device') { this.db = db; this.owner = owner; }
  key(id) { return `${this.owner}:${id}`; }
  all() { return transaction(this.db, ['workouts'], 'readonly', ({ workouts }) => request(workouts.index('owner').getAll(this.owner))); }
  operations() { return transaction(this.db, ['ops'], 'readonly', ({ ops }) => request(ops.index('owner').getAll(this.owner))); }
  async draft() { return transaction(this.db, ['drafts'], 'readonly', async ({ drafts }) => (await request(drafts.get(this.owner)))?.value || null); }
  saveDraft(value) { const copy = clone(value); return transaction(this.db, ['drafts'], 'readwrite', ({ drafts }) => { drafts.put({ owner: this.owner, value: copy }); }); }
  clearDraft() { return transaction(this.db, ['drafts'], 'readwrite', ({ drafts }) => { drafts.delete(this.owner); }); }
  settings() { return transaction(this.db, ['settings'], 'readonly', async ({ settings }) => (await request(settings.get(this.owner)))?.value || clone(DEFAULT_SETTINGS)); }
  saveSettings(value) { return transaction(this.db, ['settings'], 'readwrite', ({ settings }) => { settings.put({ owner: this.owner, value: clone(value) }); }); }
  async queue(stores, record, existing) {
    const key = this.key(record.id);
    const previousOp = await request(stores.ops.get(key));
    const op = { key, owner: this.owner, id: uuid(), workoutId: record.id, baseRevision: existing?.revision || 0, createdAt: new Date().toISOString(), conflict: previousOp?.conflict || null };
    const saved = { ...validateWorkout(record), key, owner: this.owner, revision: existing?.revision || 0, updatedAt: new Date().toISOString(), localVersion: op.id, sync: op.conflict ? 'conflict' : 'pending' };
    stores.workouts.put(saved);
    stores.ops.put({ ...op, record: saved });
    return saved;
  }
  saveFinal(record, { editing = false, clearDraft = true, baseRevision, baseLocalVersion } = {}) {
    return transaction(this.db, ['workouts', 'ops', 'drafts'], 'readwrite', async stores => {
      record = clone(record);
      const sameDate = await request(stores.workouts.index('ownerDate').get([this.owner, record.date]));
      const original = await request(stores.workouts.get(this.key(record.id)));
      if (editing && baseRevision !== undefined && (!original || original.revision !== baseRevision || (original.localVersion || null) !== (baseLocalVersion || null))) throw new StaleEditError(original || null);
      if (sameDate && !sameDate.deleted && (!editing || sameDate.id !== record.id)) throw new DuplicateDateError(sameDate);
      if (sameDate?.deleted && !original) record.id = sameDate.id;
      const result = await this.queue(stores, record, original || sameDate);
      if (clearDraft) stores.drafts.delete(this.owner);
      return result;
    });
  }
  deleteWorkout(id) {
    return transaction(this.db, ['workouts', 'ops', 'drafts'], 'readwrite', async stores => {
      const record = await request(stores.workouts.get(this.key(id)));
      if (!record) throw new Error('This workout is no longer available.');
      const draft = await request(stores.drafts.get(this.owner));
      if (draft?.value.id === id) stores.drafts.delete(this.owner);
      return this.queue(stores, { ...record, deleted: true }, record);
    });
  }
  acknowledge(op, serverRecord) {
    return transaction(this.db, ['workouts', 'ops'], 'readwrite', async stores => {
      const server = validateWorkout(serverRecord);
      const key = this.key(op.workoutId);
      const currentOp = await request(stores.ops.get(key));
      const local = await request(stores.workouts.get(key));
      if (!local || local.revision > server.revision) return;
      if (currentOp?.id === op.id) {
        stores.workouts.put({ ...server, key, owner: this.owner, sync: 'synced' });
        stores.ops.delete(key);
      } else if (currentOp) {
        currentOp.baseRevision = server.revision;
        currentOp.record.revision = server.revision;
        stores.ops.put(currentOp);
        stores.workouts.put({ ...local, revision: server.revision });
      }
    });
  }
  markConflict(op, server) {
    return transaction(this.db, ['workouts', 'ops'], 'readwrite', async stores => {
      const key = this.key(op.workoutId);
      const currentOp = await request(stores.ops.get(key));
      const local = await request(stores.workouts.get(key));
      if (!currentOp || !local) return;
      currentOp.conflict = { server: server ? validateWorkout(server) : null, detectedAt: new Date().toISOString() };
      stores.ops.put(currentOp);
      stores.workouts.put({ ...local, sync: 'conflict' });
    });
  }
  mergeRemote(records) {
    return transaction(this.db, ['workouts', 'ops'], 'readwrite', async stores => {
      for (const value of records) {
        const server = validateWorkout(value), key = this.key(server.id);
        const op = await request(stores.ops.get(key));
        const local = await request(stores.workouts.get(key));
        if (op) {
          if (server.revision !== op.baseRevision && server.lastOperationId !== op.id) {
            op.conflict = { server, detectedAt: new Date().toISOString() };
            stores.ops.put(op);
            stores.workouts.put({ ...local, sync: 'conflict' });
          }
          continue;
        }
        const sameDate = await request(stores.workouts.index('ownerDate').get([this.owner, server.date]));
        if (sameDate && sameDate.id !== server.id) {
          const dateOp = await request(stores.ops.get(this.key(sameDate.id)));
          if (dateOp) {
            dateOp.conflict = { server, detectedAt: new Date().toISOString() };
            stores.ops.put(dateOp);
            stores.workouts.put({ ...sameDate, sync: 'conflict' });
          }
          continue;
        }
        if (!local || server.revision >= local.revision) stores.workouts.put({ ...server, key, owner: this.owner, sync: 'synced' });
      }
    });
  }
  resolve(workoutId, choice) {
    return transaction(this.db, ['workouts', 'ops', 'drafts'], 'readwrite', async stores => {
      const key = this.key(workoutId), op = await request(stores.ops.get(key));
      if (!op?.conflict) throw new Error('This conflict has already been resolved.');
      const server = op.conflict.server;
      stores.ops.delete(key);
      if (choice === 'server') {
        stores.workouts.delete(key);
        if (server) stores.workouts.put({ ...server, key: this.key(server.id), owner: this.owner, sync: 'synced' });
      } else if (choice === 'local') {
        const record = clone(op.record);
        if (server && server.id !== record.id) { stores.workouts.delete(key); record.id = server.id; }
        // Clear the previous conflict before creating a new, explicitly based operation.
        await this.queue(stores, record, server);
      } else throw new Error('Choose the device or cloud version.');
      // Avoid subsequently saving a stale edit over a resolved conflict.
      const draft = await request(stores.drafts.get(this.owner));
      if (draft?.value.id === workoutId || draft?.value.id === server?.id) stores.drafts.delete(this.owner);
    });
  }
  importBackup(backup, decisions = {}, { restoreDraft = false } = {}) {
    return transaction(this.db, ['workouts', 'ops', 'settings', 'drafts'], 'readwrite', async stores => {
      let imported = 0, skipped = 0;
      for (const incoming of backup.workouts) {
        const byDate = await request(stores.workouts.index('ownerDate').get([this.owner, incoming.date]));
        const byId = await request(stores.workouts.get(this.key(incoming.id)));
        if (byDate && byId && byDate.id !== byId.id) throw new Error('A backup ID and date match different workouts. Resolve those dates before importing.');
        const existing = byId || byDate;
        if (existing && contentKey(existing) === contentKey(incoming)) { skipped++; continue; }
        if (existing && decisions[incoming.id] !== 'replace') { skipped++; continue; }
        if (existing?.sync === 'conflict') throw new Error('Resolve cloud conflicts before replacing these workouts.');
        await this.queue(stores, { ...incoming, id: existing?.id || incoming.id }, existing);
        imported++;
      }
      stores.settings.put({ owner: this.owner, value: clone(backup.settings) });
      const currentDraft = await request(stores.drafts.get(this.owner));
      if (backup.draft && (restoreDraft || !currentDraft)) stores.drafts.put({ owner: this.owner, value: validateDraft(backup.draft) });
      return { imported, skipped };
    });
  }
}
