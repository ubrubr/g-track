import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from '../config.js';
import { getMeta, setMeta } from './db.js';
import { validateWorkout } from './domain.js';

export class AuthError extends Error {}
export function validateCloudConfig(url, key) {
  if (!url && !key) return { url: '', key: '' };
  let parsed;
  try { parsed = new URL(url.trim()); } catch { throw new Error('Enter a valid Supabase project URL.'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) throw new Error('Use an HTTPS Supabase project URL without a path.');
  key = key.trim();
  if (key.startsWith('sb_secret_')) throw new Error('A secret key cannot be used in the browser. Use a publishable key.');
  if (!key.startsWith('sb_publishable_')) {
    try {
      const claims = JSON.parse(atob(key.split('.')[1].replaceAll('-', '+').replaceAll('_', '/')));
      if (claims.role !== 'anon') throw new Error();
    } catch { throw new Error('Use a publishable key or a legacy anon key. Secret and service-role keys are not allowed.'); }
  }
  return { url: parsed.origin, key };
}
export class Auth extends EventTarget {
  constructor(db) { super(); this.db = db; this.session = null; this.config = { url: '', key: '' }; this.refreshing = null; this.epoch = 0; }
  get configured() { return Boolean(this.config.url && this.config.key); }
  get owner() { return this.session?.user?.id ? `${this.config.url}|${this.session.user.id}` : 'device'; }
  async initialize() {
    const custom = await getMeta(this.db, 'cloud-config');
    this.config = validateCloudConfig(custom?.url ?? SUPABASE_URL, custom?.key ?? SUPABASE_PUBLISHABLE_KEY);
    this.session = this.configured ? await getMeta(this.db, `session:${this.config.url}`) || null : null;
  }
  async configure(url, key) {
    const config = validateCloudConfig(url, key);
    await setMeta(this.db, 'cloud-config', config);
    this.epoch++;
    this.config = config;
    this.session = config.url ? await getMeta(this.db, `session:${config.url}`) || null : null;
    this.dispatchEvent(new Event('change'));
  }
  async authRequest(path, body, token) {
    const response = await fetch(`${this.config.url}/auth/v1/${path}`, {
      method: 'POST', headers: { apikey: this.config.key, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body), cache: 'no-store', signal: AbortSignal.timeout(20000)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 400 || response.status === 401 || response.status === 403) throw new AuthError(data.msg || data.error_description || data.message || 'Sign in again to sync.');
      throw new Error('Supabase is unavailable. Your device data is safe; try again.');
    }
    return data;
  }
  async persistSession(data) {
    if (!data?.user?.id || !data.access_token || !data.refresh_token) throw new AuthError('Supabase returned an incomplete session.');
    const session = { user: { id: data.user.id, email: data.user.email }, access_token: data.access_token, refresh_token: data.refresh_token, expires_at: data.expires_at || Math.floor(Date.now() / 1000) + data.expires_in, reauthRequired: false };
    await setMeta(this.db, `session:${this.config.url}`, session);
    this.session = session;
  }
  async signIn(email, password) {
    if (!this.configured) throw new Error('Add your Supabase project in Cloud setup first.');
    const epoch = ++this.epoch;
    const data = await this.authRequest('token?grant_type=password', { email: email.trim(), password });
    if (epoch !== this.epoch) throw new AuthError('Cloud setup changed. Please sign in again.');
    await this.persistSession(data);
    this.dispatchEvent(new Event('change'));
  }
  async accessToken(expectedOwner) {
    if (!this.session || expectedOwner !== this.owner) throw new AuthError('Sign in to sync.');
    if (this.session.reauthRequired) throw new AuthError('Sign in again to sync. Your pending changes are preserved.');
    if (this.session.expires_at > Date.now() / 1000 + 60) return this.session.access_token;
    if (!this.refreshing) {
      const refresh = async () => {
        const epoch = this.epoch;
        const cached = await getMeta(this.db, `session:${this.config.url}`);
        if (cached?.user?.id === this.session?.user.id && cached.expires_at > Date.now() / 1000 + 60) { this.session = cached; return; }
        try {
          const data = await this.authRequest('token?grant_type=refresh_token', { refresh_token: cached?.refresh_token || this.session.refresh_token });
          if (epoch !== this.epoch) throw new AuthError('The active account changed.');
          await this.persistSession(data);
        }
        catch (error) {
          if (error instanceof AuthError && this.session && epoch === this.epoch) { this.session.reauthRequired = true; await setMeta(this.db, `session:${this.config.url}`, this.session); }
          throw error;
        }
      };
      this.refreshing = (navigator.locks ? navigator.locks.request(`form-auth:${this.config.url}`, refresh) : refresh()).finally(() => { this.refreshing = null; });
    }
    await this.refreshing;
    if (expectedOwner !== this.owner) throw new AuthError('The account changed. Sign in to sync.');
    return this.session.access_token;
  }
  async signOut() {
    this.epoch++;
    const token = this.session?.access_token;
    // Clear this device's session even when the remote logout endpoint is offline.
    await setMeta(this.db, `session:${this.config.url}`, null);
    this.session = null;
    this.dispatchEvent(new Event('change'));
    if (token && navigator.onLine) this.authRequest('logout?scope=local', {}, token).catch(() => {});
  }
}
export function fromServer(row) {
  return validateWorkout({ id: row.id, date: row.workout_date, exercises: row.exercises, deleted: row.deleted, revision: row.revision, updatedAt: row.updated_at, lastOperationId: row.last_operation_id });
}
export class Cloud {
  constructor(auth, owner) { this.auth = auth; this.owner = owner; }
  async request(path, options = {}, retry = true) {
    const token = await this.auth.accessToken(this.owner);
    const { url, key } = this.auth.config;
    const response = await fetch(`${url}/rest/v1/${path}`, {
      ...options, headers: { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...options.headers },
      cache: 'no-store', signal: AbortSignal.timeout(25000)
    });
    if (response.status === 401 && retry) {
      this.auth.session.expires_at = 0;
      await setMeta(this.auth.db, `session:${this.auth.config.url}`, this.auth.session);
      return this.request(path, options, false);
    }
    if (response.status === 401) {
      this.auth.session.reauthRequired = true;
      await setMeta(this.auth.db, `session:${this.auth.config.url}`, this.auth.session);
      throw new AuthError('Sign in again to sync. Your pending changes are preserved.');
    }
    if (response.status === 403) throw new Error('Cloud access was denied. Check the database migration and owner access policies.');
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.message || `Cloud request failed (${response.status}). Your changes remain on this device.`);
    return data;
  }
  async push(op) {
    const data = await this.request('rpc/apply_workout', { method: 'POST', body: JSON.stringify({ p_operation_id: op.id, p_base_revision: op.baseRevision, p_workout: { id: op.record.id, date: op.record.date, exercises: op.record.exercises, deleted: op.record.deleted } }) });
    if (!data || !['ok', 'conflict'].includes(data.status)) throw new Error('Unexpected synchronization response.');
    return { status: data.status, record: data.workout ? fromServer(data.workout) : null };
  }
  async pull() {
    const records = [];
    for (let offset = 0; ; offset += 500) {
      const rows = await this.request(`workouts?select=id,workout_date,exercises,deleted,revision,updated_at,last_operation_id&order=id.asc&limit=500&offset=${offset}`);
      if (!Array.isArray(rows)) throw new Error('Unexpected cloud history response.');
      records.push(...rows.map(fromServer));
      if (rows.length < 500) return records;
    }
  }
}
