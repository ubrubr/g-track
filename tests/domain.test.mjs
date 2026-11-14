import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { EXERCISES, CUSTOM_EXERCISES, newDraft, resizeSets, completeExercise, finalizeDraft, draftFromWorkout, validateExercise, validateDraft, validateWorkout, validDate, localDate, totals, progressSeries, clone } from '../js/domain.js';
const record = () => { const d = newDraft('2026-10-01'); completeExercise(d); return finalizeDraft(d); };

test('the eight exercise positions are exact, including 05 and 07', () => {
  assert.deepEqual(EXERCISES.map(e => e.name), ['Squats','Lunges','Step-Up Box','Calf Raises','Romanian Deadlift','Single-Leg Press','Custom Workout','Abs']);
  assert.equal(newDraft().exercises[4].position,5); assert.equal(newDraft().exercises[6].position,7);
});
test('reducing sets restores hidden individual values within a draft', () => {
  const e = newDraft().exercises[0]; resizeSets(e,4);
  e.sets = [{reps:12,weight:60},{reps:10,weight:70},{reps:8,weight:80},{reps:8,weight:80}]; e.selectedSet = 3;
  resizeSets(e,2); assert.equal(e.selectedSet,1); resizeSets(e,4);
  assert.deepEqual(e.sets[3],{reps:8,weight:80}); assert.equal(validateExercise(e).sets.length,4);
});
test('partial saves exclude skipped and unvisited exercises', () => {
  const d = newDraft(); completeExercise(d); d.exercises[1].status = 'skipped'; d.current = 4; completeExercise(d);
  assert.deepEqual(finalizeDraft(d).exercises.map(e=>e.position),[1,5]);
});
test('custom selection is required and each exercise has a stable, separate identity', () => {
  const d = newDraft(); d.current = 6; assert.throws(()=>completeExercise(d),/Choose an exercise/);
  Object.assign(d.exercises[6],{exerciseId:CUSTOM_EXERCISES[0].id,name:CUSTOM_EXERCISES[0].name}); completeExercise(d);
  const bench = finalizeDraft(d); d.id = crypto.randomUUID(); d.date = '2026-10-02';
  Object.assign(d.exercises[6],CUSTOM_EXERCISES.find(e=>e.name==='Lat Pulldown')); // use actual persisted field name below
  d.exercises[6].exerciseId = CUSTOM_EXERCISES.find(e=>e.name==='Lat Pulldown').id;
  const lat = finalizeDraft(d);
  assert.equal(progressSeries([bench,lat],bench.exercises[0].exerciseId,'*','all','2026-12-31').length,1);
  assert.notEqual(bench.exercises[0].exerciseId,lat.exercises[0].exerciseId);
});
test('copy last is suggestions; editing retains completed sets and metadata', () => {
  const w = record(); w.exercises[0].notes = 'Slow eccentric'; w.exercises[0].repMode = 'per-leg';
  const copy = draftFromWorkout(w,{copy:true,date:'2026-10-03'});
  assert.notEqual(copy.id,w.id); assert.equal(copy.exercises[0].status,'pending'); assert.throws(()=>finalizeDraft(copy));
  const edit = draftFromWorkout(w); assert.equal(edit.id,w.id); assert.equal(edit.editing,true); assert.equal(edit.exercises[0].notes,'Slow eccentric');
  assert.deepEqual(finalizeDraft(edit).exercises,w.exercises);
});
test('drafts preserve position, selected set, hidden values and statuses through JSON', () => {
  const d = newDraft(); d.current=4; resizeSets(d.exercises[4],5); d.exercises[4].selectedSet=3; d.exercises[4].sets[4]={reps:9,weight:82.5}; resizeSets(d.exercises[4],4);
  const restored = validateDraft(JSON.parse(JSON.stringify(d)));
  assert.equal(restored.current,4); assert.equal(restored.exercises[4].selectedSet,3); resizeSets(restored.exercises[4],5); assert.equal(restored.exercises[4].sets[4].weight,82.5);
});
test('volume and repetitions preserve per-leg convention; bodyweight is not estimated', () => {
  const w=record(), e=w.exercises[0]; e.repMode='per-leg'; e.sets=[{reps:12,weight:60},{reps:8,weight:0}];
  assert.deepEqual(totals([e]),{reps:40,volume:1440,maxWeight:60,sets:2});
  e.repMode='total'; assert.equal(totals([e]).reps,20);
});
test('missing and deleted results never become zero-valued chart points; variation filters apply', () => {
  const w=record(), skipped=clone(w), deleted=clone(w); skipped.exercises[0].exerciseId='abs'; skipped.exercises[0].name='Abs'; skipped.exercises[0].position=8;
  deleted.deleted=true; w.exercises[0].variation='Barbell';
  assert.equal(progressSeries([w,skipped,deleted],'squats','*','all','2026-12-31').length,1);
  assert.equal(progressSeries([w],'squats','Dumbbells','all','2026-12-31').length,0);
});
test('range, name, date and duplicate exercise validation rejects malformed input', () => {
  const w=record(); assert.equal(validDate('2026-02-30'),false); assert.equal(validDate('2026-99-01'),false); assert.equal(validDate('2024-02-29'),true);
  for (const change of [{reps:0,weight:0},{reps:10,weight:300.5},{reps:10,weight:1.25},{reps:101,weight:0}]) { const bad=clone(w); bad.exercises[0].sets=[change]; assert.throws(()=>validateWorkout(bad)); }
  const bad=clone(w); bad.exercises.push(clone(bad.exercises[0])); assert.throws(()=>validateWorkout(bad),/twice/);
});
test('month filters clamp month-end boundaries without skipping into the next month', () => {
  const w=record(); w.date='2026-02-28';
  assert.equal(progressSeries([w],'squats','*','3m','2026-05-31').length,1);
  w.date='2026-02-27';
  assert.equal(progressSeries([w],'squats','*','3m','2026-05-31').length,0);
});
test('calendar dates and display dates survive timezone and daylight saving changes', () => {
  const moduleURL=new URL('../js/domain.js',import.meta.url).href;
  for (const TZ of ['Pacific/Honolulu','Pacific/Kiritimati','America/New_York','Europe/Budapest']) {
    const result=spawnSync(process.execPath,['--input-type=module','-e',`import {localDate,formatDate} from ${JSON.stringify(moduleURL)}; console.log(localDate(new Date(2026,2,29,0,10))); console.log(formatDate('2026-03-29'));`],{env:{...process.env,TZ},encoding:'utf8'});
    assert.equal(result.status,0,result.stderr); assert.equal(result.stdout.trim(),'2026-03-29\nMar 29, 2026');
  }
  assert.equal(localDate(new Date(2026,10,13,23,59)),'2026-11-13');
});
