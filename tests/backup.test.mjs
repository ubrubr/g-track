import test from 'node:test';
import assert from 'node:assert/strict';
import { newDraft, completeExercise, finalizeDraft, DEFAULT_SETTINGS, clone } from '../js/domain.js';
import { createBackup, parseBackup, planImport, exportCSV } from '../js/backup.js';
const workout=()=>{const d=newDraft('2026-10-01'); d.exercises[0].notes='Notes, with "quotes"\nand a new line'; completeExercise(d); return finalizeDraft(d);};
test('complete backup round trip preserves settings, historical conventions and draft',()=>{
  const w=workout(); w.exercises[0].repMode='per-leg'; const d=newDraft(); d.current=5;
  const backup=createBackup([w],{...DEFAULT_SETTINGS,defaultRepMode:'per-leg'},d);
  const parsed=parseBackup(JSON.stringify(backup)); assert.deepEqual(parsed.workouts,backup.workouts); assert.deepEqual(parsed.draft,d); assert.equal(parsed.settings.defaultRepMode,'per-leg');
  assert.equal(JSON.stringify(backup).includes('access_token'),false);
});
test('bad versions, duplicate dates, invalid sets and invalid drafts fail before importing',()=>{
  const b=createBackup([workout()],DEFAULT_SETTINGS);
  assert.throws(()=>parseBackup('{nope'),/valid JSON/); assert.throws(()=>parseBackup(JSON.stringify({...b,schemaVersion:99})),/supported/);
  assert.throws(()=>parseBackup(JSON.stringify({...b,workouts:[...b.workouts,...b.workouts]})),/duplicate/);
  const bad=clone(b); bad.workouts[0].exercises[0].sets[0].reps=-1; assert.throws(()=>parseBackup(JSON.stringify(bad)));
});
test('duplicate import is skipped and differing data produces an explicit conflict',()=>{
  const w=workout(), b=parseBackup(JSON.stringify(createBackup([w],DEFAULT_SETTINGS)));
  assert.equal(planImport(b,[w])[0].kind,'duplicate'); b.workouts[0].exercises[0].sets[0].weight=20;
  assert.equal(planImport(b,[w])[0].kind,'conflict'); assert.equal(planImport(b,[])[0].kind,'new');
});
test('CSV has one completed set per row, escaped notes, formula protection and per-leg totals',()=>{
  const w=workout(); w.exercises[0].notes='=HYPERLINK("bad")'; w.exercises[0].repMode='per-leg'; w.exercises[0].sets=[{reps:12,weight:60}];
  const csv=exportCSV([w,{...clone(w),deleted:true}]); assert.equal(csv.split('\r\n').length,2); assert.match(csv,/"24","1440"/); assert.match(csv,/'=HYPERLINK/);
});
