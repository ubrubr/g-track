export const SCHEMA_VERSION = 1;
export const LIMITS = Object.freeze({ sets: { min: 1, max: 10, step: 1 }, reps: { min: 1, max: 100, step: 1 }, weight: { min: 0, max: 300, step: 0.5 } });
export const EXERCISES = Object.freeze([
  { id: 'squats', name: 'Squats' },
  { id: 'lunges', name: 'Lunges' },
  { id: 'step-up-box', name: 'Step-Up Box' },
  { id: 'calf-raises', name: 'Calf Raises' },
  { id: 'romanian-deadlift', name: 'Romanian Deadlift' },
  { id: 'single-leg-press', name: 'Single-Leg Press' },
  { id: 'custom', name: 'Custom Workout' },
  { id: 'abs', name: 'Abs' }
]);
export const CUSTOM_GROUPS = Object.freeze({
  'Chest and shoulders': ['Barbell Bench Press', 'Dumbbell Bench Press', 'Incline Dumbbell Press', 'Overhead Press', 'Lateral Raise', 'Cable Fly'],
  'Back': ['Pull-Up', 'Chin-Up', 'Lat Pulldown', 'Seated Cable Row', 'Barbell Row', 'Chest-Supported Row', 'Face Pull'],
  'Legs and glutes': ['Deadlift', 'Hip Thrust', 'Leg Press', 'Hack Squat', 'Goblet Squat', 'Leg Extension', 'Leg Curl'],
  'Arms and core': ['Biceps Curl', 'Hammer Curl', 'Triceps Pushdown', 'Overhead Triceps Extension', 'Cable Crunch', 'Hanging Leg Raise']
});
export const customId = name => `custom:${name.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replace(/-$/, '')}`;
export const CUSTOM_EXERCISES = Object.values(CUSTOM_GROUPS).flat().map(name => ({ id: customId(name), name }));
export const ALL_EXERCISES = [...EXERCISES.filter(e => e.id !== 'custom'), ...CUSTOM_EXERCISES];
export const DEFAULT_SETTINGS = Object.freeze({ defaultRepMode: 'total', reducedMotion: false });
export const clone = value => structuredClone(value);
export const uuid = () => crypto.randomUUID();
export const localDate = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01' || value > '2200-12-31') return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
export const formatDate = (date, options = {}) => new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC', ...options }).format(new Date(`${date}T12:00:00Z`));
export const number = value => new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(value);
export const inRange = (value, range) => typeof value === 'number' && Number.isFinite(value) && value >= range.min && value <= range.max && Number.isInteger((value - range.min) / range.step);
export function newExercise(definition, settings = DEFAULT_SETTINGS) {
  return { position: EXERCISES.findIndex(e => e.id === definition.id) + 1, exerciseId: definition.id, name: definition.name, variation: '', notes: '', repMode: settings.defaultRepMode, count: 3, selectedSet: 0, sets: Array.from({ length: 3 }, () => ({ reps: 10, weight: 0 })), status: 'pending' };
}
export function newDraft(date = localDate(), settings = DEFAULT_SETTINGS) {
  return { id: uuid(), date, current: 0, editing: false, exercises: EXERCISES.map(e => newExercise(e, settings)) };
}
export function resizeSets(exercise, count) {
  if (!inRange(count, LIMITS.sets)) throw new Error('Choose between 1 and 10 sets.');
  while (exercise.sets.length < count) exercise.sets.push(clone(exercise.sets.at(-1) || { reps: 10, weight: 0 }));
  exercise.count = count;
  exercise.selectedSet = Math.min(exercise.selectedSet, count - 1);
}
export function validateExercise(exercise) {
  const definition = ALL_EXERCISES.find(e => e.id === exercise.exerciseId);
  if (!definition || definition.name !== exercise.name) throw new Error('Choose an exercise before saving Custom Workout.');
  const expected = EXERCISES[exercise.position - 1];
  if (!expected || (expected.id === 'custom' ? !exercise.exerciseId.startsWith('custom:') : expected.id !== exercise.exerciseId)) throw new Error('The exercise position is invalid.');
  if (!['total', 'per-leg'].includes(exercise.repMode)) throw new Error('Choose a repetition convention.');
  if (typeof exercise.variation !== 'string' || exercise.variation.length > 120 || typeof exercise.notes !== 'string' || exercise.notes.length > 2000) throw new Error('Equipment or notes are too long.');
  const sets = exercise.count === undefined ? exercise.sets : exercise.sets.slice(0, exercise.count);
  if (!Array.isArray(sets) || !inRange(sets.length, LIMITS.sets)) throw new Error('Choose between 1 and 10 sets.');
  for (const set of sets) if (!inRange(set.reps, LIMITS.reps) || !inRange(set.weight, LIMITS.weight)) throw new Error('Reps must be 1–100 and weight must be 0–300 kg in 0.5 kg steps.');
  return { position: exercise.position, exerciseId: definition.id, name: definition.name, variation: exercise.variation.trim(), notes: exercise.notes.trim(), repMode: exercise.repMode, sets: sets.map(s => ({ reps: s.reps, weight: s.weight })) };
}
export function completeExercise(draft) {
  validateExercise(draft.exercises[draft.current]);
  draft.exercises[draft.current].status = 'completed';
}
export function finalizeDraft(draft) {
  if (!validDate(draft.date)) throw new Error('Choose a valid workout date.');
  const exercises = draft.exercises.filter(e => e.status === 'completed').map(validateExercise);
  if (!exercises.length) throw new Error('Complete at least one exercise to save a workout.');
  return { id: draft.id, date: draft.date, exercises, deleted: false, revision: 0, updatedAt: new Date().toISOString() };
}
export function draftFromWorkout(workout, { copy = false, date = workout.date, settings = DEFAULT_SETTINGS } = {}) {
  const draft = newDraft(date, settings);
  if (!copy) { draft.id = workout.id; draft.editing = true; draft.baseRevision = workout.revision || 0; draft.baseLocalVersion = workout.localVersion || null; }
  for (const saved of workout.exercises) {
    const item = draft.exercises[saved.position - 1];
    Object.assign(item, clone(saved), { count: saved.sets.length, selectedSet: 0, status: copy ? 'pending' : 'completed' });
  }
  return draft;
}
export function validateDraft(value) {
  if (!value || !validDate(value.date) || !isUUID(value.id) || !Number.isInteger(value.current) || value.current < 0 || value.current > 7 || !Array.isArray(value.exercises) || value.exercises.length !== 8) throw new Error('The saved draft is invalid.');
  const draft = clone(value);
  draft.exercises.forEach((e, index) => {
    if (e.position !== index + 1 || !['pending', 'completed', 'skipped'].includes(e.status) || !inRange(e.count, LIMITS.sets) || !Number.isInteger(e.selectedSet) || e.selectedSet < 0 || e.selectedSet >= e.count || !Array.isArray(e.sets) || e.sets.length < e.count || e.sets.length > 10) throw new Error('The saved draft has invalid sets.');
    // An unselected custom slot is valid only as an unfinished suggestion.
    const checked = e.exerciseId === 'custom' && index === 6 && e.status !== 'completed' ? { ...e, exerciseId: CUSTOM_EXERCISES[0].id, name: CUSTOM_EXERCISES[0].name } : e;
    validateExercise({ ...checked, count: e.sets.length });
  });
  return draft;
}
export const isUUID = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export function validateWorkout(value) {
  if (!value || !isUUID(value.id) || !validDate(value.date) || typeof value.deleted !== 'boolean' || !Array.isArray(value.exercises) || value.exercises.length > 8 || (!value.deleted && !value.exercises.length)) throw new Error('Invalid workout in backup or server response.');
  const positions = new Set();
  const exercises = value.exercises.map(e => {
    if (positions.has(e.position)) throw new Error('An exercise position occurs twice.');
    positions.add(e.position);
    return validateExercise(e);
  }).sort((a, b) => a.position - b.position);
  return { id: value.id, date: value.date, deleted: value.deleted, exercises, revision: Number.isSafeInteger(value.revision) && value.revision >= 0 ? value.revision : 0, updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString(), lastOperationId: value.lastOperationId || null };
}
export function totals(exercises) {
  return exercises.reduce((result, e) => {
    for (const s of e.sets) { const reps = s.reps * (e.repMode === 'per-leg' ? 2 : 1); result.reps += reps; result.volume += reps * s.weight; result.maxWeight = Math.max(result.maxWeight, s.weight); result.sets++; }
    return result;
  }, { reps: 0, volume: 0, maxWeight: 0, sets: 0 });
}
export const contentKey = record => JSON.stringify({ date: record.date, deleted: record.deleted, exercises: record.exercises.map(validateExercise).sort((a, b) => a.position - b.position) });
export function progressSeries(workouts, id, variation = '*', period = 'all', today = localDate()) {
  const cutoff = new Date(`${today}T12:00:00Z`);
  if (period === '4w') cutoff.setUTCDate(cutoff.getUTCDate() - 28);
  if (period === '3m') cutoff.setUTCMonth(cutoff.getUTCMonth() - 3);
  if (period === '6m') cutoff.setUTCMonth(cutoff.getUTCMonth() - 6);
  const min = period === 'all' ? '1900-01-01' : cutoff.toISOString().slice(0, 10);
  return workouts.filter(w => !w.deleted && w.date >= min && w.date <= today).flatMap(w => {
    const exercises = w.exercises.filter(e => e.exerciseId === id && (variation === '*' || e.variation === variation));
    return exercises.length ? [{ date: w.date, workoutId: w.id, exercises, ...totals(exercises) }] : [];
  }).sort((a, b) => a.date.localeCompare(b.date));
}
export function validateSettings(value) {
  if (!value || !['total', 'per-leg'].includes(value.defaultRepMode) || typeof value.reducedMotion !== 'boolean') throw new Error('Invalid settings in backup.');
  return { defaultRepMode: value.defaultRepMode, reducedMotion: value.reducedMotion };
}
