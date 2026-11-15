import { SCHEMA_VERSION, validateWorkout, validateDraft, validateSettings, contentKey } from './domain.js';
import { validateTemplate, validateSession, completedSets } from './model.js';

export function createBackup(workouts, settings, draft = null, {templates=[],activeSession=null}={}) {
  const active=activeSession?validateSession(activeSession):null;
  if(active)for(const key of ['key','owner','sync','localVersion'])delete active[key];
  return { app: 'G-Track', schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), settings: validateSettings(settings), workouts: workouts.map(validateWorkout), draft: draft ? validateDraft(draft) : null, templates:templates.map(validateTemplate),activeSession:active };
}
export function parseBackup(text) {
  if (typeof text !== 'string' || text.length > 25 * 1024 * 1024) throw new Error('Choose a JSON backup smaller than 25 MB.');
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('This file is not valid JSON.'); }
  if (!((data?.app==='FORM'&&data.schemaVersion===1)||(['FORM','G-Track'].includes(data?.app)&&data.schemaVersion===SCHEMA_VERSION)) || !Array.isArray(data.workouts) || data.workouts.length > 20000) throw new Error('This is not a supported G-Track backup (versions 1–2).');
  const ids = new Set(), dates = new Set();
  const workouts = data.workouts.map(value => {
    const workout = validateWorkout(value);
    if (ids.has(workout.id) || dates.has(workout.date)) throw new Error('The backup contains duplicate workout IDs or dates.');
    ids.add(workout.id); dates.add(workout.date);
    return workout;
  });
  const templates=(data.templates||[]).map(validateTemplate);if(new Set(templates.map(t=>t.id)).size!==templates.length)throw new Error('Duplicate template IDs in backup.');
  return { workouts, settings: validateSettings(data.settings), draft: data.draft ? validateDraft(data.draft) : null,templates,activeSession:data.activeSession?validateSession(data.activeSession):null };
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
  const rows = [['workout_id', 'date', 'exercise_id', 'exercise', 'position', 'equipment', 'notes', 'rep_convention', 'set', 'reps', 'weight_kg', 'total_reps', 'volume_kg','workout_name','template_id','planned_reps','planned_weight_kg','duration_seconds','borg_rpe','workout_duration_seconds','completed_at']];
  for (const w of workouts.filter(w => !w.deleted).sort((a, b) => a.date.localeCompare(b.date))) for (const e of w.exercises.filter(e=>!e.skipped)) e.sets.forEach((s, i) => {
    if(s.completed===false||s.skipped)return;
    const reps = s.reps * (e.repMode === 'per-leg' ? 2 : 1);
    rows.push([w.id, w.date, e.exerciseId, e.name, e.position, e.variation, e.notes, e.repMode, i + 1, s.reps, s.weight, reps, reps * s.weight,w.name||'Workout',w.templateId||'',s.plannedReps??'',s.plannedWeight??'',s.durationSeconds??'',s.borgRpe??'',w.durationSeconds??'',s.completedAt||'']);
  });
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
}
export function download(name, data, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const anchor = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
