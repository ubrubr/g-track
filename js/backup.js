import { SCHEMA_VERSION, validateWorkout, validateDraft, validateSettings, contentKey } from './domain.js';

export function createBackup(workouts, settings, draft = null) {
  return { app: 'FORM', schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), settings: validateSettings(settings), workouts: workouts.map(validateWorkout), draft: draft ? validateDraft(draft) : null };
}
export function parseBackup(text) {
  if (typeof text !== 'string' || text.length > 10 * 1024 * 1024) throw new Error('Choose a JSON backup smaller than 10 MB.');
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('This file is not valid JSON.'); }
  if (data?.app !== 'FORM' || data.schemaVersion !== SCHEMA_VERSION || !Array.isArray(data.workouts) || data.workouts.length > 20000) throw new Error('This is not a supported FORM backup (schema version 1).');
  const ids = new Set(), dates = new Set();
  const workouts = data.workouts.map(value => {
    const workout = validateWorkout(value);
    if (ids.has(workout.id) || dates.has(workout.date)) throw new Error('The backup contains duplicate workout IDs or dates.');
    ids.add(workout.id); dates.add(workout.date);
    return workout;
  });
  return { workouts, settings: validateSettings(data.settings), draft: data.draft ? validateDraft(data.draft) : null };
}
export function planImport(backup, existing) {
  return backup.workouts.map(incoming => {
    const byId = existing.find(w => w.id === incoming.id), byDate = existing.find(w => w.date === incoming.date);
    if (byId && byDate && byId.id !== byDate.id) throw new Error('A backup ID and date match different workouts. Resolve those dates before importing.');
    const current = byId || byDate;
    return { incoming, existing: current, kind: !current ? 'new' : contentKey(current) === contentKey(incoming) ? 'duplicate' : 'conflict' };
  });
}
const csvCell = value => {
  let text = String(value ?? '');
  if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
};
export function exportCSV(workouts) {
  const rows = [['workout_id', 'date', 'exercise_id', 'exercise', 'position', 'equipment', 'notes', 'rep_convention', 'set', 'reps', 'weight_kg', 'total_reps', 'volume_kg']];
  for (const w of workouts.filter(w => !w.deleted).sort((a, b) => a.date.localeCompare(b.date))) for (const e of w.exercises) e.sets.forEach((s, i) => {
    const reps = s.reps * (e.repMode === 'per-leg' ? 2 : 1);
    rows.push([w.id, w.date, e.exerciseId, e.name, e.position, e.variation, e.notes, e.repMode, i + 1, s.reps, s.weight, reps, reps * s.weight]);
  });
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
}
export function download(name, data, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const anchor = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
