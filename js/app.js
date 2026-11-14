import { EXERCISES, ALL_EXERCISES, CUSTOM_GROUPS, CUSTOM_EXERCISES, DEFAULT_SETTINGS, localDate, formatDate, number, clone, newDraft, resizeSets, completeExercise, finalizeDraft, draftFromWorkout, validateDraft, totals, progressSeries, customId } from './domain.js';
import { openDatabase, Repository, DuplicateDateError, StaleEditError } from './db.js';
import { Auth, Cloud } from './cloud.js';
import { Synchronizer } from './sync.js';
import { createBackup, parseBackup, planImport, exportCSV, download } from './backup.js';
import './wheel.js';

const $ = selector => document.querySelector(selector);
const escape = text => String(text ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const main = $('#main'), modal = $('#modal');
let db, auth, repo, sync, draft, settings = clone(DEFAULT_SETTINGS), records = [], operations = [];
let view = 'workout', busy = false, transitioning = false, initialized = false, generation = 0, draftWrite = Promise.resolve(), toastTimer, retryTimer, retryDelay = 3000;
let syncState = { state: 'device', pending: 0 }, progress = { exerciseId: 'squats', variation: '*', period: '3m', metric: 'volume', metricChosen: false, point: null };
const statusLabels = { device: 'Saved on device', pending: 'Sync pending', synced: 'Synced', failed: 'Sync failed', signin: 'Sign in to sync', syncing: 'Syncing…', conflict: 'Resolve conflict' };
const repLabel = mode => mode === 'per-leg' ? 'Reps per leg · one set = both legs' : 'Total reps';
const activeRecords = () => records.filter(w => !w.deleted).sort((a, b) => b.date.localeCompare(a.date));
const matchingDate = () => records.find(w => !w.deleted && w.date === draft.date && (!draft.editing || w.id !== draft.id));

function toast(message) { clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').hidden = false; toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 5000); }
function storageFailure(error) {
  $('#storage-error').hidden = false;
  $('#storage-error').textContent = `Could not save on this device. ${error?.name === 'QuotaExceededError' ? 'Storage is full. Export a backup and free some space.' : 'Keep this page open, export a backup, and check browser storage permissions.'}`;
}
function guarded(callback) { return async event => { try { await callback(event); } catch (error) { if (error instanceof DuplicateDateError) await offerExisting(error.record); else if (error instanceof StaleEditError) offerStaleEdit(error.record); else toast(error.message || 'Something went wrong. Your previous saves are preserved.'); } }; }
function persistDraft() {
  if (!repo || !draft) return Promise.resolve();
  const owner = repo, version = generation;
  const promise = owner.saveDraft(draft);
  draftWrite = promise;
  promise.then(() => { if (version === generation) { const note = $('#draft-save-state'); if (note) note.textContent = 'Draft saved on device'; $('#storage-error').hidden = true; } }).catch(storageFailure);
  return promise;
}
async function refreshRecords() { const source = repo, version = generation; const data = await Promise.all([source.all(), source.operations()]); if (source === repo && version === generation) [records, operations] = data; }
function updateStatus() {
  const label = statusLabels[syncState.state] || statusLabels.device;
  $('#sync-label').textContent = label;
  $('#sync-status').dataset.state = syncState.state;
  $('#sync-status').setAttribute('aria-label', `Synchronization status: ${label}`);
}
function requestSync() { clearTimeout(retryTimer); sync?.run().catch(error => { storageFailure(error); }); }
async function activateOwner() {
  generation++; clearTimeout(retryTimer); const currentGeneration = generation;
  repo = new Repository(db, auth.owner);
  await refreshRecords(); settings = await repo.settings();
  const stored = await repo.draft();
  draft = stored ? validateDraft(stored) : newDraft(localDate(), settings);
  document.documentElement.classList.toggle('reduce-motion', settings.reducedMotion);
  syncState = { state: auth.session ? 'device' : 'signin', pending: operations.length };
  sync = new Synchronizer(repo, auth.session ? new Cloud(auth, repo.owner) : null, { onState: state => {
    if (generation !== currentGeneration) return;
    syncState = state; updateStatus();
    if (!['syncing'].includes(state.state)) refreshRecords().then(() => { if (generation === currentGeneration && view !== 'workout') render(); }).catch(storageFailure);
    if (state.state === 'failed' && document.visibilityState === 'visible') {
      retryTimer = setTimeout(requestSync, retryDelay); retryDelay = Math.min(retryDelay * 2, 60000);
    } else if (state.state === 'synced') retryDelay = 3000;
  } });
  updateStatus(); render(); await persistDraft(); requestSync();
}
function render() {
  main.classList.toggle('workout-view',view === 'workout');
  document.querySelectorAll('.bottom-nav button').forEach(b => b.getAttribute('data-view') === view ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'));
  if (view === 'workout') renderWorkout(); else if (view === 'history') renderHistory(); else renderProgress();
}
function renderWorkout() {
  const item = draft.exercises[draft.current], duplicate = matchingDate();
  const subtitle = [item.variation?.trim(), item.repMode === 'per-leg' ? repLabel(item.repMode) : ''].filter(Boolean).join(' · ');
  const set = item.sets[item.selectedSet];
  main.innerHTML = `<div class="view-heading workout-heading"><div><h1>${draft.editing ? 'Edit workout' : 'Your workout'}</h1></div><span class="tag">${draft.editing ? 'EDITING' : draft.date === localDate() ? 'TODAY' : 'TRAINING'}</span></div>
    <div class="date-row"><label class="date-control">${icon('calendar')}<span>${escape(formatDate(draft.date, { weekday: 'short' }))}</span><input id="workout-date" type="date" aria-label="Workout date" value="${draft.date}" min="1900-01-01" max="2200-12-31"></label></div>
    ${duplicate ? `<div class="notice">You already saved a workout for this date.<button class="button outline" data-action="edit-existing" data-id="${duplicate.id}">${icon('edit')}Edit workout</button></div>` : ''}
    ${draft.editing ? `<div class="notice">Changes stay in this draft until you finish.<button class="text-button" data-action="cancel-edit">Cancel editing</button></div>` : ''}
    <section aria-labelledby="exercise-name">
    <div class="exercise-meta"><span class="eyebrow">EXERCISE ${String(draft.current + 1).padStart(2, '0')} / 08</span><span class="exercise-count">${draft.exercises.filter(e => e.status === 'completed').length} completed</span></div>
    
    <div class="exercise-title"><div><h2 id="exercise-name">${draft.current === 6 ? 'Custom Workout' : escape(item.name)}</h2>${subtitle ? `<p class="exercise-subtitle">${escape(subtitle)}</p>` : ''}</div><button class="details-link" data-action="details">Details ${icon('info')}</button></div>
    ${draft.current === 6 ? `<div class="custom-choice"><label class="field-label" for="custom-exercise">Choose your exercise</label><select id="custom-exercise" required><option value="">Select an exercise</option>${Object.entries(CUSTOM_GROUPS).map(([group, names]) => `<optgroup label="${group}">${names.map(name => `<option value="${customId(name)}" ${item.exerciseId === customId(name) ? 'selected' : ''}>${escape(name)}</option>`).join('')}</optgroup>`).join('')}</select></div>` : ''}
    <div class="workout-quick-actions"><button data-action="copy-last" class="button outline">${icon('copy')}Copy previous</button><button data-action="skip" class="button outline">Skip exercise ${icon('arrow')}</button></div><div class="picker-card">
    <div class="wheel-labels" aria-hidden="true"><span>SETS</span><span>REPS</span><span>KG</span></div>
    <div class="wheels"><number-wheel kind="sets" label="Number of sets" value="${item.count}"></number-wheel><number-wheel kind="reps" label="Repetitions for set ${item.selectedSet + 1}" value="${set.reps}"></number-wheel><number-wheel kind="weight" label="Weight in kilograms for set ${item.selectedSet + 1}" value="${set.weight}"></number-wheel></div>
    <p class="picker-footnote">${icon('info')}<span>KG is the total external load. Combine both dumbbells. Use 0 for bodyweight.${item.repMode === 'per-leg' ? '<br>Reps are per leg. Each set includes both legs.' : ''}</span></p></div>
    <div class="apply-row"><button data-action="apply-all">${icon('copy')} Apply selected set to all</button></div>
    <div class="exercise-actions"><button class="button outline" data-action="previous" ${draft.current === 0 ? 'disabled' : ''}>${icon('back')}Previous</button><button id="next-button" class="button primary" data-action="next" ${duplicate || busy ? 'disabled' : ''}>${draft.current === 7 ? 'Finish workout' : 'Save & Next'}${icon(draft.current === 7 ? 'check' : 'arrow')}</button></div>
    <div class="sets-heading"><span class="eyebrow">SET SUMMARY</span></div>
    <div id="set-selectors" class="set-selectors" role="group" aria-label="Choose a set to edit">${setSelectors(item)}</div>
    <div class="secondary-actions"><button class="button primary full finish-workout-button" data-action="finish-now" ${duplicate || busy ? 'disabled' : ''}>${icon('check')} Finish and save workout</button></div>
    <p class="draft-note">${icon('check')}<span id="draft-save-state">Draft saved on device</span></p><p class="field-help wheel-help">Drag a wheel, scroll, or tap a nearby number. With a keyboard, use arrow keys.</p></section>`;
}
function setSelectors(item) {
  return item.sets.slice(0, item.count).map((s, i) => `<button class="set-selector" data-action="select-set" data-index="${i}" aria-pressed="${i === item.selectedSet}" aria-label="Set ${i + 1}, ${s.reps} ${item.repMode === 'per-leg' ? 'reps per leg' : 'reps'}, ${s.weight} kilograms"><span class="set-num">SET ${String(i + 1).padStart(2, '0')}</span><span class="set-values">${number(s.reps)} <small>×</small> ${number(s.weight)} <small>kg</small></span></button>`).join('');
}
function updateSetUI() {
  const item = draft.exercises[draft.current];
  $('#set-selectors').innerHTML = setSelectors(item);
  const reps = main.querySelector('number-wheel[kind=reps]'), kg = main.querySelector('number-wheel[kind=weight]');
  reps.value = item.sets[item.selectedSet].reps; kg.value = item.sets[item.selectedSet].weight;
  reps.setAttribute('aria-label', `Repetitions for set ${item.selectedSet + 1}`); kg.setAttribute('aria-label', `Weight in kilograms for set ${item.selectedSet + 1}`);
}
main.addEventListener('valuechange', event => {
  const item = draft.exercises[draft.current], kind = event.target.kind;
  if (kind === 'sets') resizeSets(item, event.detail); else item.sets[item.selectedSet][kind] = event.detail;
  updateSetUI(); persistDraft().catch(() => {});
});
main.addEventListener('change', guarded(async event => {
  if (event.target.id === 'workout-date') { draft.date = event.target.value || localDate(); await persistDraft(); renderWorkout(); }
  if (event.target.id === 'custom-exercise') {
    const definition = CUSTOM_EXERCISES.find(e => e.id === event.target.value);
    if (!definition) { draft.exercises[6].exerciseId = 'custom'; draft.exercises[6].name = 'Custom Workout'; }
    else Object.assign(draft.exercises[6], { exerciseId: definition.id, name: definition.name });
    draft.exercises[6].status = 'pending'; await persistDraft(); renderWorkout();
  }
  if (event.target.id === 'progress-exercise') { progress.exerciseId = event.target.value; progress.variation = '*'; progress.point = null; progress.metricChosen = false; progress.metric = 'volume'; renderProgress(); }
  if (event.target.id === 'progress-variation') { progress.variation = event.target.value; progress.point = null; renderProgress(); }
}));
async function navigateExercise(index) { await persistDraft(); draft.current = index; await persistDraft(); renderWorkout(); window.scrollTo({ top:0, behavior:'instant' }); $('#exercise-name').setAttribute('tabindex', '-1'); $('#exercise-name').focus({ preventScroll: true }); }
async function finishWorkout(includeCurrent = true) {
  if (busy) return;
  if (matchingDate()) return offerExisting(matchingDate());
  if (includeCurrent) completeExercise(draft);
  const workout = finalizeDraft(draft);
  busy = true; $('#next-button')?.setAttribute('disabled', '');
  try {
    await persistDraft(); await draftWrite;
    await repo.saveFinal(workout, { editing: draft.editing, baseRevision: draft.baseRevision, baseLocalVersion: draft.baseLocalVersion });
    await refreshRecords(); draft = newDraft(localDate(), settings);
    view = 'history'; render(); toast('Workout saved on device. Nice work.'); requestSync();
  } catch (error) { if (!(error instanceof DuplicateDateError || error instanceof StaleEditError)) storageFailure(error); throw error; }
  finally { busy = false; if (view === 'workout') renderWorkout(); }
}
async function editWorkout(id) {
  const workout = records.find(w => w.id === id && !w.deleted);
  if (!workout) throw new Error('This workout is no longer available.');
  const edit = async () => { draft = draftFromWorkout(workout); await persistDraft(); view = 'workout'; modal.close(); render(); window.scrollTo({ top: 0, behavior: 'instant' }); };
  if (draft.exercises.some(e => e.status === 'completed') || draft.editing) confirmDialog('Open saved workout?', 'Your current unfinished draft will be replaced. Saved history stays available.', 'Open workout', edit);
  else await edit();
}
async function offerExisting(record) { confirmDialog('Workout already saved', `There is already a workout for ${formatDate(record.date)}. Open the saved workout to make changes.`, 'Edit workout', async () => { draft = draftFromWorkout(record); await persistDraft(); view = 'workout'; modal.close(); render(); }); }
function offerStaleEdit(record) {
  const current = finalizeDraft(draft);
  openModal('Review newer changes', `<p class="modal-description">This workout changed after you opened your draft. Review the saved sets before replacing them.</p><div class="comparison-grid"><div><strong>Your draft</strong>${current.exercises.map(exerciseDetails).join('')}</div><div><strong>Saved version</strong>${record?.deleted ? '<p>Workout deleted</p>' : record ? record.exercises.map(exerciseDetails).join('') : '<p>No saved workout</p>'}</div></div><button id="keep-stale-draft" class="button primary full">Save my draft instead</button><button id="use-newer-workout" class="button outline full" style="margin-top:10px">Use saved version</button>`);
  $('#keep-stale-draft').onclick = guarded(async () => { draft.baseRevision = record?.revision || 0; draft.baseLocalVersion = record?.localVersion || null; await persistDraft(); await finishWorkout(false); modal.close(); });
  $('#use-newer-workout').onclick = guarded(async () => { draft = record && !record.deleted ? draftFromWorkout(record) : newDraft(draft.date,settings); await persistDraft(); modal.close(); await refreshRecords(); render(); });
}
async function copyLast() {
  const last = activeRecords().find(w => w.date < draft.date);
  if (!last) { toast('No earlier workout to copy yet.'); return; }
  confirmDialog('Copy your last workout?', `Use the values from ${formatDate(last.date)} as editable suggestions. Each exercise is included only after you save it. This replaces your current draft.`, 'Copy last', async () => { const baseline = { id:draft.id, editing:draft.editing, baseRevision:draft.baseRevision, baseLocalVersion:draft.baseLocalVersion }; draft = draftFromWorkout(last, { copy: true, date: draft.date, settings }); if (baseline.editing) Object.assign(draft,baseline); await persistDraft(); modal.close(); renderWorkout(); toast('Values copied. Save each exercise you complete.'); });
}
main.addEventListener('click', guarded(async event => {
  const target = event.target.closest('[data-action]'); if (!target || busy || transitioning || target.disabled) return;
  const action = target.dataset.action, item = draft.exercises[draft.current];
  const flowAction = ['previous','next','skip','finish-now'].includes(action);
  if (flowAction) { transitioning = true; target.disabled = true; }
  try {
  if (action === 'previous') await navigateExercise(Math.max(0, draft.current - 1));
  if (action === 'next') { if (draft.current === 7) await finishWorkout(); else { completeExercise(draft); await navigateExercise(draft.current + 1); } }
  if (action === 'skip') {
    if (draft.current === 7) confirmDialog('Finish without Abs?', 'Abs will be excluded. Previously completed exercises will be saved.', 'Finish workout', async () => { item.status = 'skipped'; await finishWorkout(false); modal.close(); });
    else { item.status = 'skipped'; await navigateExercise(draft.current + 1); }
  }
  if (action === 'finish-now') await finishWorkout();
  if (action === 'select-set') { item.selectedSet = Number(target.dataset.index); updateSetUI(); await persistDraft(); main.querySelector('number-wheel[kind=reps]').focus({ preventScroll: true }); }
  if (action === 'apply-all') { const selected = clone(item.sets[item.selectedSet]); for (let i = 0; i < item.count; i++) item.sets[i] = clone(selected); updateSetUI(); await persistDraft(); toast('This set was applied to all active sets.'); }
  if (action === 'details') showDetails();
  if (action === 'copy-last') await copyLast();
  if (action === 'edit-existing' || action === 'edit-workout') await editWorkout(target.dataset.id);
  if (action === 'cancel-edit') confirmDialog('Discard these edits?', 'The saved workout will stay as it was.', 'Discard edits', async () => { draft = newDraft(localDate(), settings); await persistDraft(); modal.close(); renderWorkout(); });
  if (action === 'delete-workout') {
    const workout = records.find(w => w.id === target.dataset.id);
    confirmDialog('Delete this workout?', `Remove the workout from ${formatDate(workout.date)}? Its deletion will sync to your other devices. You can restore an exported backup.`, 'Delete workout', async () => { await repo.deleteWorkout(workout.id); if (draft.id === workout.id) { draft = newDraft(localDate(), settings); await persistDraft(); } await refreshRecords(); modal.close(); render(); toast('Workout deleted on device.'); requestSync(); }, true);
  }
  if (action === 'start-workout') { view = 'workout'; render(); }
  if (action === 'period') { progress.period = target.dataset.period; progress.point = null; renderProgress(); }
  if (action === 'metric') { progress.metric = target.dataset.metric; progress.metricChosen = true; renderProgress(); }
  if (action === 'point') { progress.point = target.dataset.date; renderProgress(); $('#point-details')?.focus({ preventScroll: true }); }
  } finally { if (flowAction) { transitioning = false; if (target.isConnected) target.disabled = false; } }
}));
document.querySelector('.bottom-nav').addEventListener('click', guarded(async event => {
  const button = event.target.closest('[data-view]'); if (!button || !initialized || busy) return;
  if (transitioning) return;
  if (view === 'workout') await persistDraft();
  await refreshRecords(); view = button.dataset.view; render(); window.scrollTo({ top: 0, behavior: 'instant' });
}));

function exerciseDetails(exercise) {
  return `<div class="history-exercise"><h3>${escape(exercise.name)}</h3><p class="exercise-subtitle">${escape(exercise.variation || 'No equipment specified')} · ${repLabel(exercise.repMode)}</p>${setsList(exercise)}${exercise.notes ? `<p class="notes">${escape(exercise.notes)}</p>` : ''}</div>`;
}
function setsList(exercise) { return `<ol class="set-list">${exercise.sets.map((s, i) => `<li><span>SET ${String(i + 1).padStart(2, '0')}</span><span>${number(s.reps)} ${exercise.repMode === 'per-leg' ? 'reps / leg' : 'reps'} × ${number(s.weight)} kg</span></li>`).join('')}</ol>`; }
function workoutSync(workout) { return workout.sync === 'synced' ? 'Synced' : workout.sync === 'conflict' ? 'Resolve conflict in Settings' : auth.session ? 'Sync pending' : 'Saved on device · Sign in to sync'; }
function renderHistory() {
  const workouts = activeRecords(), total = totals(workouts.flatMap(w => w.exercises));
  main.innerHTML = `<div class="view-heading"><div><h1>Your history</h1><p>Every session. Every bit of progress.</p></div>${icon('history')}</div>
    <div class="stats-row"><div class="stat"><strong>${workouts.length}</strong><small>WORKOUTS</small></div><div class="stat"><strong>${number(total.sets)}</strong><small>COMPLETED SETS</small></div><div class="stat"><strong>${number(total.reps)}</strong><small>TOTAL REPS</small></div></div>
    ${workouts.length ? `<div class="section-label eyebrow">YOUR SESSIONS · NEWEST FIRST</div>${workouts.map(w => {
      const t = totals(w.exercises);
      return `<details class="history-card" data-workout="${w.id}"><summary><div><h3>${formatDate(w.date, { weekday: 'short' })}</h3><p>${w.exercises.length} exercises · ${t.sets} sets · ${number(t.volume)} kg volume</p><span class="workout-sync ${w.sync}">${icon(w.sync === 'synced' ? 'check' : 'sync')}${workoutSync(w)}</span></div>${icon('chevron')}</summary><div class="workout-content">${w.exercises.map(exerciseDetails).join('')}<div class="workout-footer"><button class="text-button" data-action="edit-workout" data-id="${w.id}">${icon('edit')}Edit workout</button><button class="text-button delete-button" data-action="delete-workout" data-id="${w.id}">${icon('trash')}Delete</button></div></div></details>`;
    }).join('')}` : `<div class="empty-state">${icon('dumbbell')}<h2>Your story starts with a set.</h2><p>Finish your first workout and it will be waiting here, with every set you logged.</p><button class="button primary" data-action="start-workout">Start your workout ${icon('arrow')}</button></div>`}`;
}
function renderProgress() {
  const available = ALL_EXERCISES.filter(e => records.some(w => !w.deleted && w.exercises.some(x => x.exerciseId === e.id)));
  const definitions = [...EXERCISES.filter(e => e.id !== 'custom'), ...available.filter(e => e.id.startsWith('custom:'))];
  const variations = [...new Set(activeRecords().flatMap(w => w.exercises.filter(e => e.exerciseId === progress.exerciseId).map(e => e.variation)))].sort();
  const points = progressSeries(records, progress.exerciseId, progress.variation, progress.period);
  const bodyweight = points.length > 0 && points.every(p => p.maxWeight === 0);
  // Keep volume as the default, including for bodyweight sessions.
  const selected = points.find(p => p.date === progress.point) || points.at(-1);
  const latest = points.at(-1);
  const previous = points.length > 1 ? points.at(-2) : null;
  const delta = previous ? latest[progress.metric] - previous[progress.metric] : null;
  const deltaPercent = previous && previous[progress.metric] !== 0 ? delta / previous[progress.metric] * 100 : null;
  const deltaLabel = delta === null ? 'First recorded session' : `${delta > 0 ? '+' : delta < 0 ? '−' : '±'}${number(Math.abs(delta))} ${progress.metric === 'reps' ? 'reps' : 'kg'}${deltaPercent === null ? '' : ` (${deltaPercent > 0 ? '+' : deltaPercent < 0 ? '−' : '±'}${number(Math.abs(deltaPercent))}%)`} vs previous session`;
  const label = { maxWeight: 'Maximum set weight', volume: 'Training volume', reps: 'Completed repetitions' }[progress.metric];
  const units = progress.metric === 'reps' ? 'reps' : 'kg';
  main.innerHTML = `<div class="view-heading"><div><h1>Your progress</h1><p>Small steps. Measurable strength.</p></div>${icon('chart')}</div>
    <div class="select-field"><label class="field-label" for="progress-exercise">EXERCISE</label><select id="progress-exercise">${definitions.map(e => `<option value="${e.id}" ${progress.exerciseId === e.id ? 'selected' : ''}>${escape(e.name)}</option>`).join('')}</select></div>
    ${variations.length > 1 || (variations.length === 1 && variations[0]) ? `<div class="select-field"><label class="field-label" for="progress-variation">EQUIPMENT / VARIATION</label><select id="progress-variation"><option value="*">All variations</option>${variations.map(v => `<option value="${escape(v)}" ${progress.variation === v ? 'selected' : ''}>${escape(v || 'No equipment specified')}</option>`).join('')}</select></div>` : ''}
    <div class="period-picker" role="group" aria-label="Date range">${[['4w','Last 4 weeks'],['3m','3 months'],['6m','6 months'],['all','All time']].map(([key,text]) => `<button data-action="period" data-period="${key}" aria-pressed="${key === progress.period}">${text}</button>`).join('')}</div>
    <div class="metric-tabs" role="group" aria-label="Progress metric">${[['volume','Volume'],['maxWeight','Max weight'],['reps','Repetitions']].map(([key,text]) => `<button data-action="metric" data-metric="${key}" aria-pressed="${key === progress.metric}">${text}</button>`).join('')}</div>
    ${points.length ? `<div class="chart-card"><p class="chart-title">${label}</p><p class="chart-value">${number(latest[progress.metric])}<small>${units}</small></p><p class="chart-caption">Latest session · ${formatDate(latest.date)}</p><p class="volume-change" data-trend="${delta > 0 ? 'up' : delta < 0 ? 'down' : 'same'}">${deltaLabel}</p>${chart(points, selected)}<p class="field-help">Tap a point to see its date and completed sets.</p></div>
      <div class="session-comparison"><h2>Session comparison</h2>${points.slice(-12).reverse().map((point, index, recent) => { const preceding = points.find(p => p.date < point.date); const diff = preceding ? point[progress.metric] - preceding[progress.metric] : null; return `<div class="session-comparison-row"><time>${formatDate(point.date)}</time><span>${number(point[progress.metric])} ${units}</span><span class="difference" data-trend="${diff > 0 ? 'up' : diff < 0 ? 'down' : 'same'}">${diff === null ? '—' : `${diff > 0 ? '+' : diff < 0 ? '−' : '±'}${number(Math.abs(diff))}`}</span></div>`; }).join('')}</div><div id="point-details" class="chart-details" tabindex="-1"><span class="eyebrow">${formatDate(selected.date, { weekday: 'short' })}</span><h3>${escape(selected.exercises[0].name)}</h3><p>${number(selected.maxWeight)} kg max · ${number(selected.volume)} kg volume · ${number(selected.reps)} total reps</p>${selected.exercises.map(exerciseDetails).join('')}</div><p class="field-help">Volume = reps × total external load. Reps per leg are doubled for repetitions and volume. Missing sessions are excluded.</p>` : `<div class="empty-state">${icon('chart')}<h2>Progress takes a first session.</h2><p>No completed results for this exercise and date range yet.</p><button class="button outline" data-action="start-workout">Log a workout ${icon('arrow')}</button></div>`}`;
}
function chart(points, selected) {
  const W = 420, H = 210, left = 37, right = 12, top = 13, bottom = 20;
  const values = points.map(p => p[progress.metric]), max = Math.max(1, ...values) * 1.15;
  const dates = points.map(p => Date.parse(`${p.date}T12:00:00Z`)), minDate = Math.min(...dates), span = Math.max(...dates) - minDate;
  const coords = points.map((p, i) => ({ x: span ? left + (dates[i] - minDate) / span * (W - left - right) : (W + left - right) / 2, y: top + (1 - values[i] / max) * (H - top - bottom) }));
  return `<div class="chart-wrap"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${escape(progress.metric)} over ${points.length} workout sessions. Use the point buttons to inspect each result.">${[0,1,2,3].map(i => {
    const y = top + i / 3 * (H - top - bottom);
    return `<line x1="${left}" y1="${y}" x2="${W-right}" y2="${y}" stroke="#414141" stroke-dasharray="2 5"/><text x="${left-8}" y="${y+3}" text-anchor="end" fill="#a0a0a0" font-size="9" font-family="system-ui">${number(max * (1 - i / 3))}</text>`;
  }).join('')}<polyline points="${coords.map(c => `${c.x},${c.y}`).join(' ')}" fill="none" stroke="#a7b2ac" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>${coords.map((c,i) => `<circle cx="${c.x}" cy="${c.y}" r="${selected.date === points[i].date ? 5 : 3.5}" fill="#a7b2ac" stroke="#262626" stroke-width="2"/>`).join('')}</svg>${coords.map((c,i) => `<button class="chart-point" data-action="point" data-date="${points[i].date}" style="left:${c.x/W*100}%;top:${c.y/H*100}%" aria-label="${formatDate(points[i].date)}: ${number(values[i])} ${progress.metric === 'reps' ? 'repetitions' : 'kilograms'}" aria-pressed="${selected.date === points[i].date}"></button>`).join('')}</div><div class="chart-labels"><span>${formatDate(points[0].date,{year:undefined})}</span><span>${points.length > 1 ? formatDate(points.at(-1).date,{year:undefined}) : ''}</span></div>`;
}

function openModal(title, body) {
  $('#modal-content').innerHTML = `<div class="modal-heading"><h2 id="modal-title">${escape(title)}</h2><button class="icon-button" data-modal-action="close" aria-label="Close dialog">${icon('close')}</button></div>${body}`;
  if (!modal.open) modal.showModal();
  modal.scrollTop = 0;
}
function modalError(error) { let element = $('#modal-error'); if (!element) { element = document.createElement('p'); element.id = 'modal-error'; element.className = 'form-error'; element.setAttribute('role','alert'); $('#modal-content').append(element); } element.textContent = error.message || String(error); element.scrollIntoView({ block: 'nearest' }); }
function confirmDialog(title, message, label, callback, danger = false) {
  openModal(title, `<p class="modal-description">${escape(message)}</p><div class="form-actions"><button class="button outline" data-modal-action="close">Cancel</button><button id="confirm-action" class="button ${danger ? 'danger' : 'primary'}">${escape(label)}</button></div>`);
  $('#confirm-action').onclick = async () => { $('#confirm-action').disabled = true; try { await callback(); } catch (error) { if (error instanceof StaleEditError) offerStaleEdit(error.record); else modalError(error); if ($('#confirm-action')) $('#confirm-action').disabled = false; } };
}
function showDetails() {
  const item = draft.exercises[draft.current];
  openModal('Exercise details', `<p class="modal-description">${escape(item.name)} · these details belong to this workout.</p><form id="details-form"><div class="form-field"><label for="variation">Equipment or variation</label><input id="variation" name="variation" maxlength="120" value="${escape(item.variation)}" placeholder="e.g. Barbell, Smith machine, bodyweight"></div><div class="form-field"><label for="rep-mode">Repetition convention</label><select id="rep-mode" name="repMode"><option value="total" ${item.repMode === 'total' ? 'selected' : ''}>Total reps</option><option value="per-leg" ${item.repMode === 'per-leg' ? 'selected' : ''}>Reps per leg</option></select><p class="field-help">In Reps per leg, one set includes both legs. Progress counts twice the entered reps and volume.</p></div><div class="form-field"><label for="notes">Exercise notes</label><textarea id="notes" name="notes" maxlength="2000" placeholder="Cues, tempo, or anything to remember">${escape(item.notes)}</textarea></div><p class="field-help">Weight is always total external load. For two dumbbells, enter their combined weight. Bodyweight is 0 kg.</p><button class="button primary full" type="submit">Save details ${icon('check')}</button></form>`);
  $('#details-form').onsubmit = async event => { event.preventDefault(); try { const data = new FormData(event.target); item.variation = data.get('variation').trim(); item.notes = data.get('notes').trim(); item.repMode = data.get('repMode'); await persistDraft(); modal.close(); renderWorkout(); } catch (error) { modalError(error); } };
}
async function showSettings() {
  await refreshRecords();
  const conflicts = operations.filter(op => op.conflict);
  openModal('Settings', `<div class="account-card"><h3>${auth.session ? escape(auth.session.user.email || 'Your account') : 'Your training belongs to you.'}</h3><p>${auth.session ? 'History and drafts are separated by account on this device.' : 'You can log offline on this device. Sign in to add cloud backup and use other devices.'}</p></div>
    ${!auth.session || auth.session.reauthRequired ? `<form id="sign-in-form"><div class="form-field"><label for="email">Email</label><input id="email" type="email" name="email" autocomplete="username" required value="${escape(auth.session?.user.email || '')}"></div><div class="form-field"><label for="password">Password</label><input id="password" type="password" name="password" autocomplete="current-password" required></div><button class="button primary full" type="submit" ${!auth.configured ? 'disabled' : ''}>Sign in ${icon('arrow')}</button><p class="field-help">Owner account only. Public registration is not available in FORM.</p></form>` : `<button class="text-button" data-modal-action="sign-out">Sign out on this device</button>`}
    <div class="modal-section"><h3>Cloud synchronization</h3><p>${statusLabels[syncState.state]}${operations.length ? ` · ${operations.length} pending ${operations.length === 1 ? 'change' : 'changes'}` : ''}</p>${syncState.message ? `<p class="field-help">${escape(syncState.message)}</p>` : ''}<button class="button full outline" data-modal-action="sync">${icon('sync')}Sync now</button>${conflicts.map(op => `<div class="conflict-card"><strong>${formatDate(op.record.date)}</strong><p>This workout changed on another device. Choose the version to keep.</p><button class="button outline" data-modal-action="resolve" data-id="${op.workoutId}">Review conflict</button></div>`).join('')}${auth.session ? '<button class="text-button" data-modal-action="move-device">Import workouts from device-only mode</button>' : ''}</div>
    <div class="modal-section"><h3>Backup & export</h3><p>Keep a personal backup alongside cloud sync. JSON restores your workouts, notes, settings, and unfinished draft.</p><div class="settings-grid"><button class="button outline" data-modal-action="export-json">${icon('download')}JSON backup</button><button class="button outline" data-modal-action="export-csv">${icon('download')}Export CSV</button></div><button class="button full outline" data-modal-action="import">Restore JSON backup</button><input type="file" id="import-file" accept=".json,application/json" hidden><p class="field-help">CSV contains one completed set per row. Backup files do not include sign-in tokens.</p></div>
    <div class="modal-section"><h3>Logging preferences</h3><div class="form-field"><label for="default-rep-mode">Default for new workouts</label><select id="default-rep-mode"><option value="total" ${settings.defaultRepMode === 'total' ? 'selected' : ''}>Total reps</option><option value="per-leg" ${settings.defaultRepMode === 'per-leg' ? 'selected' : ''}>Reps per leg</option></select></div><label class="checkbox-row"><input id="reduce-motion" type="checkbox" ${settings.reducedMotion ? 'checked' : ''}>Reduce motion</label><p class="field-help">Existing workouts keep their recorded repetition convention.</p></div>
    <details class="settings-details"><summary>Cloud setup</summary><p class="field-help">Use only your project URL and publishable key. Apply the included Supabase migration before signing in.</p><form id="cloud-config-form"><div class="form-field"><label for="project-url">Supabase project URL</label><input id="project-url" type="url" value="${escape(auth.config.url)}" autocomplete="off" placeholder="https://your-project.supabase.co"></div><div class="form-field"><label for="publishable-key">Publishable key</label><input id="publishable-key" value="${escape(auth.config.key)}" autocomplete="off" spellcheck="false" placeholder="sb_publishable_…"></div><button type="submit" class="button full outline">Save cloud setup</button></form></details>
    <details class="settings-details"><summary>Install & offline storage</summary><p class="field-help">On iPhone, open FORM in Safari, tap Share, then Add to Home Screen. Open it once online before going offline. iOS can remove website storage; regular JSON backups protect your history.</p><p id="offline-state" class="field-help">${navigator.serviceWorker?.controller ? 'Offline app shell is ready on this device.' : 'Offline app shell is preparing. Reopen once after the first online load.'}</p><button class="button full outline" data-modal-action="persist-storage">Request durable device storage</button><p class="field-help">FORM ${'1.0.0'} · No analytics. No external fonts.</p></details>`);
  if ($('#sign-in-form')) $('#sign-in-form').onsubmit = async event => {
    event.preventDefault(); const button = event.target.querySelector('button[type=submit]'); button.disabled = true;
    try { await persistDraft(); const data = new FormData(event.target); await auth.signIn(data.get('email'), data.get('password')); event.target.reset(); await activateOwner(); await showSettings(); toast('Signed in. Your account history is opening.'); }
    catch (error) { modalError(error); button.disabled = false; }
  };
  $('#cloud-config-form').onsubmit = async event => { event.preventDefault(); try { await persistDraft(); await auth.configure($('#project-url').value, $('#publishable-key').value); await activateOwner(); await showSettings(); toast('Cloud setup saved on this device.'); } catch (error) { modalError(error); } };
  $('#default-rep-mode').onchange = async event => { settings.defaultRepMode = event.target.value; try { await repo.saveSettings(settings); } catch (error) { modalError(error); } };
  $('#reduce-motion').onchange = async event => { settings.reducedMotion = event.target.checked; document.documentElement.classList.toggle('reduce-motion', settings.reducedMotion); try { await repo.saveSettings(settings); } catch (error) { modalError(error); } };
  $('#import-file').onchange = async event => { try { const file = event.target.files[0]; if (!file) return; if (file.size > 10 * 1024 * 1024) throw new Error('Choose a backup smaller than 10 MB.'); showImport(parseBackup(await file.text())); } catch (error) { modalError(error); } };
}
function showConflict(id) {
  const op = operations.find(op => op.workoutId === id && op.conflict); if (!op) return showSettings();
  const server = op.conflict.server;
  const describe = workout => !workout ? '<p>No cloud record</p>' : `<p>${formatDate(workout.date)}</p><p>${workout.deleted ? 'Deleted workout' : `${workout.exercises.length} exercises · ${totals(workout.exercises).sets} sets`}</p>${workout.deleted ? '' : workout.exercises.map(e => `<p><strong>${escape(e.name)}</strong>${escape(e.variation)} · ${repLabel(e.repMode)}<br>${e.sets.map(s => `${s.reps} × ${s.weight} kg`).join(' / ')}${e.notes ? `<br>${escape(e.notes)}` : ''}</p>`).join('')}`;
  openModal('Choose a version', `<p class="modal-description">Both versions are preserved until you choose. Keeping this device will submit a new edit based on the cloud revision.</p><div class="comparison-grid"><div><strong>This device</strong>${describe(op.record)}</div><div><strong>Cloud · revision ${server?.revision ?? 0}</strong>${describe(server)}</div></div><button class="button primary full" data-modal-action="keep-local" data-id="${id}">Keep this device</button><button class="button outline full" style="margin-top:10px" data-modal-action="keep-server" data-id="${id}">Use cloud version</button>`);
}
function showImport(backup) {
  const plan = planImport(backup, records), conflicts = plan.filter(p => p.kind === 'conflict');
  openModal('Restore your backup', `<p class="modal-description">${plan.filter(p => p.kind === 'new').length} new workouts · ${plan.filter(p => p.kind === 'duplicate').length} duplicates skipped · ${conflicts.length} conflicts to review.<br>Backup settings will be restored.</p>${backup.draft ? '<label class="checkbox-row"><input id="restore-draft" type="checkbox">Replace my unfinished draft with the backup draft</label>' : ''}${conflicts.map(p => `<div class="import-row"><strong>${formatDate(p.incoming.date)}${p.incoming.deleted ? ' · Deleted in backup' : ''}</strong><p class="field-help">Device: ${totals(p.existing.exercises).sets} sets. Backup: ${totals(p.incoming.exercises).sets} sets.</p><label class="field-label" for="import-${p.incoming.id}">Version to keep</label><select id="import-${p.incoming.id}" data-import-id="${p.incoming.id}"><option value="keep">Keep existing workout</option><option value="replace">Use backup version</option></select></div>`).join('')}<button id="confirm-import" class="button primary full" style="margin-top:20px">Restore backup ${icon('check')}</button>`);
  $('#confirm-import').onclick = async () => {
    $('#confirm-import').disabled = true;
    try { await persistDraft(); const decisions = Object.fromEntries([...modal.querySelectorAll('[data-import-id]')].map(el => [el.dataset.importId, el.value])); const result = await repo.importBackup(backup, decisions, { restoreDraft: Boolean($('#restore-draft')?.checked) }); settings = await repo.settings(); document.documentElement.classList.toggle('reduce-motion', settings.reducedMotion); await refreshRecords(); const stored = await repo.draft(); if (stored) draft = validateDraft(stored); modal.close(); render(); requestSync(); toast(`${result.imported} workouts restored; ${result.skipped} skipped.`); }
    catch (error) { modalError(error); $('#confirm-import').disabled = false; }
  };
}
modal.addEventListener('click', async event => {
  const target = event.target.closest('[data-modal-action]'); if (!target || target.disabled) return;
  const action = target.dataset.modalAction;
  try {
    if (action === 'close') modal.close();
    if (action === 'sign-out') confirmDialog('Sign out on this device?', 'Your account history and pending changes stay in its separate device cache. Device-only workouts will open. Sign back in to access your account cache.', 'Sign out', async () => { await persistDraft(); await auth.signOut(); await activateOwner(); await showSettings(); });
    if (action === 'sync') { target.disabled = true; await sync.run(); await showSettings(); }
    if (action === 'export-json') { await draftWrite; download(`form-backup-${localDate()}.json`, JSON.stringify(createBackup(records, settings, draft), null, 2), 'application/json'); toast('JSON backup exported.'); }
    if (action === 'export-csv') { download(`form-sets-${localDate()}.csv`, exportCSV(records), 'text/csv;charset=utf-8'); toast('Completed sets exported.'); }
    if (action === 'import') $('#import-file').click();
    if (action === 'resolve') showConflict(target.dataset.id);
    if (action === 'keep-local' || action === 'keep-server') { await repo.resolve(target.dataset.id, action === 'keep-local' ? 'local' : 'server'); const stored = await repo.draft(); if (!stored) draft = newDraft(localDate(), settings); await refreshRecords(); render(); requestSync(); await showSettings(); toast('Conflict resolved.'); }
    if (action === 'persist-storage') { const result = await navigator.storage?.persist?.(); toast(result ? 'Durable storage granted.' : 'Your browser manages storage. Keep regular JSON backups.'); }
    if (action === 'move-device') {
      const deviceRepo = new Repository(db, 'device'), deviceRecords = await deviceRepo.all();
      if (!deviceRecords.length) toast('There are no device-only workouts to import.');
      else showImport({ workouts: deviceRecords, settings, draft: null });
    }
  } catch (error) { modalError(error); target.disabled = false; }
});
$('#settings-button').addEventListener('click', guarded(() => initialized ? showSettings() : null));
$('#sync-status').addEventListener('click', guarded(() => initialized ? showSettings() : null));
window.addEventListener('online', requestSync);
window.addEventListener('offline', () => { syncState = { state: operations.length ? 'pending' : 'device', pending: operations.length }; updateStatus(); });
document.addEventListener('visibilitychange', () => {
  if (!initialized) return;
  if (document.visibilityState === 'visible') { refreshRecords().then(() => { if (view !== 'workout') render(); requestSync(); }).catch(storageFailure); }
  else { if (view === 'workout') persistDraft().catch(() => {}); clearTimeout(retryTimer); }
});
window.addEventListener('pagehide', () => { if (initialized && view === 'workout') persistDraft().catch(() => {}); });
async function initialize() {
  try {
    db = await openDatabase(); auth = new Auth(db); await auth.initialize(); await activateOwner(); initialized = true;
  } catch (error) {
    storageFailure(error);
    main.innerHTML = `<div class="empty-state">${icon('info')}<h1>Device storage is unavailable</h1><p>FORM needs IndexedDB to preserve your history. Allow website storage and reopen the app.</p><p>${escape(error.message)}</p><button class="button primary" onclick="location.reload()">Try again</button></div>`;
  }
  if ('serviceWorker' in navigator && !(location.hostname === '127.0.0.1' && new URLSearchParams(location.search).has('dev'))) {
    try {
      const registration = await navigator.serviceWorker.register('./service-worker.js', { scope: './', updateViaCache: 'none' });
      registration.addEventListener('updatefound', () => { const worker = registration.installing; worker?.addEventListener('statechange', () => { if (worker.state === 'installed' && navigator.serviceWorker.controller) toast('A new version is ready. Reopen FORM when convenient.'); }); });
    } catch { toast('Offline app shell could not be cached. Reopen while online.'); }
  }
}
initialize();
