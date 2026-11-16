import { validateRoutine,validateAutomaticSession,validateAutomaticWorkout,validateExercise3 } from './schema3.js';
// Legacy version 2 training documents remain readable and editable.
export const TRAINING_VERSION = 2;
export const TRAINING_LIMITS = Object.freeze({ exercises: 50, sets: 30, reps: 100, weight: 300, rest: 3600 });
export const BORG_ANCHORS = Object.freeze([
  'No exertion at all', 'Extremely light', 'Between extremely light and very light',
  'Very light', 'Between very light and light', 'Light', 'Between light and somewhat hard',
  'Somewhat hard', 'Between somewhat hard and hard', 'Hard', 'Between hard and very hard',
  'Very hard', 'Between very hard and extremely hard', 'Extremely hard', 'Maximal exertion'
]);
export const copy = value => structuredClone(value);
export const newId = () => crypto.randomUUID();
const iso = now => new Date(now).toISOString();
const uuidValid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const finite = (n, min, max, step = 1) => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max && Number.isInteger(n / step);
const fail = message => { throw new Error(message); };
const text = (value, max, required = false) => typeof value === 'string' && value.length <= max && (!required || value.trim()) ? value.trim() : fail('A name, variation, or note is invalid.');
const timestamp = value => value === null || (typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value))) ? value : fail('Invalid training timestamp.');
const calendarDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= '1900-01-01' && value <= '2200-12-31' && Number.isFinite(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0,10) === value;
export const validBorg = value => value === null || finite(value, 6, 20);
export const borgDescription = value => validBorg(value) && value !== null ? BORG_ANCHORS[value - 6] : '';
export const borgColor = value => value < 8 ? '#8ac8ed' : value < 12 ? '#87c695' : value < 17 ? '#efa45d' : '#e77f79';
function metadata(value) {
  return { revision: Number.isSafeInteger(value.revision) && value.revision >= 0 ? value.revision : 0, updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : iso(Date.now()), lastOperationId: value.lastOperationId || null };
}
function unique(items, key, label) { const ids = items.map(key); if (new Set(ids).size !== ids.length) fail(`Duplicate ${label}.`); }
function target(value) {
  if (!uuidValid(value.id) || !finite(value.targetReps,1,100) || !finite(value.targetWeight,0,300,.5)) fail('Targets must be 1–100 reps and 0–300 kg in 0.5 kg steps.');
  return { id: value.id, targetReps: value.targetReps, targetWeight: value.targetWeight };
}
export function validateTimer(value) {
  if (!value || !finite(value.accumulatedMs,0,315360000000,1) || (value.runningSince !== null && !finite(value.runningSince,0,10000000000000,1)) || (value.runningSince!==null&&!value.touched) || typeof value.touched !== 'boolean') fail('Invalid saved stopwatch.');
  return { accumulatedMs: value.accumulatedMs, runningSince: value.runningSince, touched: value.touched };
}
function actualSet(value, active = false) {
  if (!uuidValid(value.id) || !finite(value.plannedReps,1,100) || !finite(value.plannedWeight,0,300,.5) || !finite(value.reps,1,100) || !finite(value.weight,0,300,.5)) fail('Set values are outside the supported range.');
  if (typeof value.completed !== 'boolean' || typeof value.skipped !== 'boolean' || (value.completed && value.skipped) || !validBorg(value.borgRpe) || (value.durationSeconds !== null && !finite(value.durationSeconds,0,315360000))) fail('Invalid completion, duration, or Borg RPE (6–20).');
  const result = { id: value.id, plannedReps: value.plannedReps, plannedWeight: value.plannedWeight, reps: value.reps, weight: value.weight, durationSeconds: value.durationSeconds, borgRpe: value.borgRpe, completed: value.completed, skipped: value.skipped, startedAt: timestamp(value.startedAt ?? null), endedAt: timestamp(value.endedAt ?? null), completedAt: timestamp(value.completedAt ?? null) };
  if (active) result.timer = validateTimer(value.timer);
  return result;
}
export function validateTrainingExercise(value, { planned = false, active = false } = {}) {
  if(value?.version===3)return validateExercise3(value,{planned,active});
  if (!value || !uuidValid(value.id) || !finite(value.position,1,50) || typeof value.exerciseId !== 'string' || !/^[a-z0-9][a-z0-9:.-]{0,95}$/.test(value.exerciseId) || !['total','per-leg'].includes(value.repMode) || !finite(value.restSeconds,0,3600)) fail('Invalid exercise identity, order, repetition convention, or rest duration.');
  const common = { version: 2, id: value.id, position: value.position, exerciseId: value.exerciseId, name: text(value.name,80,true), variation: text(value.variation,120), notes: text(value.notes,2000), repMode: value.repMode, restSeconds: value.restSeconds };
  const sets = planned ? value.plan : value.sets;
  if (!Array.isArray(sets) || sets.length < 1 || sets.length > 30) fail('Use 1–30 sets per exercise.');
  unique(sets,s=>s.id,'set ID');
  if (planned) {
    common.plan = sets.map(target);
    common.acceptedProgression = value.acceptedProgression ? validateAcceptance(value.acceptedProgression) : null;
  } else {
    if (typeof value.skipped !== 'boolean') fail('Invalid exercise status.');
    common.skipped = value.skipped;
    common.sets = sets.map(s=>actualSet(s,active));
    common.acceptedProgression = value.acceptedProgression ? validateAcceptance(value.acceptedProgression) : null;
  }
  return common;
}
function validateAcceptance(value) {
  if (!finite(value.fromWeight,0,300,.5) || !finite(value.toWeight,0,300,.5) || value.toWeight <= value.fromWeight || !Array.isArray(value.sourceIds) || !value.sourceIds.every(uuidValid)) fail('Invalid accepted progression.');
  return { fromWeight:value.fromWeight, toWeight:value.toWeight, sourceIds:[...value.sourceIds], acceptedAt:timestamp(value.acceptedAt) };
}
function exercises(value, options) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 50) fail('Add between 1 and 50 exercises.');
  unique(value,e=>e.id,'exercise entry ID');
  unique(value.flatMap(e=>options.planned?e.plan||[]:e.sets||[]),s=>s.id,'set ID across exercises');
  return value.map((e,i)=>{ const checked=validateTrainingExercise(e,options); if(checked.position!==i+1) fail('Exercise order must be consecutive.'); return checked; });
}
export function validateTemplate(value) {
  if(value?.version===3)return validateRoutine(value);
  if (!value || value.version !== 2 || !uuidValid(value.id) || typeof value.deleted !== 'boolean') fail('Invalid workout template.');
  return { version:2, entity:'template', id:value.id, name:text(value.name,80,true), exercises:exercises(value.exercises,{planned:true}), deleted:value.deleted, ...metadata(value) };
}
export function validateWorkoutV2(value) {
  if(value?.version===3)return validateAutomaticWorkout(value);
  if (!value || value.version !== 2 || !uuidValid(value.id) || !calendarDate(value.date) || typeof value.deleted !== 'boolean' || (value.templateId !== null && !uuidValid(value.templateId))) fail('Invalid version 2 workout.');
  const result = { version:2, id:value.id, date:value.date, name:text(value.name,80,true), templateId:value.templateId, startedAt:timestamp(value.startedAt), endedAt:timestamp(value.endedAt), durationSeconds:value.durationSeconds, timingSource:value.timingSource || 'recorded', exercises:exercises(value.exercises,{}), deleted:value.deleted, ...metadata(value) };
  if ((result.durationSeconds !== null && !finite(result.durationSeconds,0,315360000)) || !['recorded','resumed','unknown'].includes(result.timingSource)) fail('Invalid workout duration.');
  if (!result.deleted && !trainingTotals(result.exercises).sets) fail('Complete at least one set before finishing.');
  if (result.startedAt && result.endedAt && Date.parse(result.endedAt)<Date.parse(result.startedAt)) fail('Workout end precedes its start.');
  return result;
}
export function validateSession(value) {
  if(value?.version===3)return validateAutomaticSession(value);
  if (!value || value.version !== 2 || value.entity !== 'session' || !uuidValid(value.id) || !calendarDate(value.date) || typeof value.deleted !== 'boolean' || typeof value.editing !== 'boolean' || (value.templateId !== null && !uuidValid(value.templateId))) fail('Invalid active workout.');
  const result = { ...copy(value), name:text(value.name,80,true), exercises:exercises(value.exercises,{active:true}), startedAt:timestamp(value.startedAt), endedAt:timestamp(value.endedAt), ...metadata(value) };
  if (!finite(result.current,0,result.exercises.length-1) || !['recorded','resumed','unknown'].includes(result.timingSource) || (result.originalDurationSeconds !== null && !finite(result.originalDurationSeconds,0,315360000))) fail('Invalid saved session position or duration.');
  if (result.editing && (!Number.isSafeInteger(result.baseRevision) || result.baseRevision<0 || (result.baseLocalVersion!==null&&!uuidValid(result.baseLocalVersion)))) fail('An edit must retain its base revision.');
  if (result.prompt) {
    const e=result.exercises.find(e=>e.id===result.prompt.exerciseId),s=e?.sets.find(s=>s.id===result.prompt.setId);
    if(!s||!uuidValid(result.prompt.token)||typeof result.prompt.wasCompleted!=='boolean')fail('Invalid pending Borg prompt.');
  }
  if (result.rest) {
    const r=result.rest;
    if (!['running','paused','finished','skipped'].includes(r.status) || !finite(r.remainingMs,0,3630000) || (r.deadline!==null&&!finite(r.deadline,0,10000000000000)) || (r.status==='running'&&r.deadline===null) || (r.status!=='running'&&r.deadline!==null) || typeof r.notified!=='boolean') fail('Invalid saved rest countdown.');
  }
  return result;
}
export function blankTemplate(name='New workout') { return { version:2, entity:'template', id:newId(), name, exercises:[], deleted:false, revision:0, updatedAt:iso(Date.now()) }; }
export function plannedExercise(definition, { reps=10, weight=0, sets=3, rest=90, repMode='total' }={}) {
  return { version:2, id:newId(), exerciseId:definition.id, name:definition.name, position:1, variation:'', notes:'', repMode, restSeconds:rest, plan:Array.from({length:sets},()=>({id:newId(),targetReps:reps,targetWeight:weight})), acceptedProgression:null };
}
export function reorderExercises(template, from, to) {
  if (!finite(from,0,template.exercises.length-1)||!finite(to,0,template.exercises.length-1)) fail('Invalid exercise position.');
  const [exercise]=template.exercises.splice(from,1);template.exercises.splice(to,0,exercise);normalizeOrder(template);return template;
}
export function normalizeOrder(template) { template.exercises.forEach((e,i)=>e.position=i+1);return template; }
export function resizePlan(exercise,count) {
  if(!finite(count,1,30))fail('Use 1–30 planned sets.');
  exercise.reserve=exercise.reserve||[];
  while(exercise.plan.length>count)exercise.reserve.unshift(exercise.plan.pop());
  while(exercise.plan.length<count)exercise.plan.push(exercise.reserve.shift()||{...copy(exercise.plan.at(-1)),id:newId()});
}
export function estimateDuration(template) {
  // Thirty seconds per planned set; rest only between sets, including exercise transitions.
  const list=template.exercises.flatMap(e=>e.plan.map(()=>e.restSeconds));
  return list.length ? list.length*30+list.slice(0,-1).reduce((a,b)=>a+b,0) : null;
}
export function newTimer() { return {accumulatedMs:0,runningSince:null,touched:false}; }
export function timerElapsed(timer,now=Date.now()) { return timer.accumulatedMs+(timer.runningSince===null?0:Math.max(0,now-timer.runningSince)); }
export function startTimer(timer,now=Date.now()) { if(timer.runningSince===null){timer.runningSince=now;timer.touched=true;}return timer; }
export function pauseTimer(timer,now=Date.now()) { if(timer.runningSince!==null){timer.accumulatedMs=timerElapsed(timer,now);timer.runningSince=null;}return timer; }
export function resetTimer(timer) { Object.assign(timer,newTimer());return timer; }
export function formatTime(seconds,alwaysHours=false) {
  if(seconds===null||!Number.isFinite(seconds))return '—';
  seconds=Math.max(0,Math.floor(seconds));const hours=Math.floor(seconds/3600),minutes=Math.floor(seconds%3600/60),s=String(seconds%60).padStart(2,'0');
  return hours||alwaysHours?`${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}:${s}`:`${String(minutes).padStart(2,'0')}:${s}`;
}
export function sessionElapsed(session,now=Date.now()) { return session.editing?session.originalDurationSeconds:session.startedAt?Math.floor(Math.max(0,now-Date.parse(session.startedAt))/1000):null; }
export function sessionFromTemplate(template,date,now=Date.now()) {
  const t=validateTemplate(template);
  return { version:2,entity:'session',id:newId(),templateId:t.id,name:t.name,date,startedAt:iso(now),endedAt:null,timingSource:'recorded',originalDurationSeconds:null,current:0,editing:false,deleted:false,revision:0,rest:null,prompt:null,highlightSetId:null,
    exercises:t.exercises.map(e=>({ ...copy(e),plan:undefined,skipped:false,sets:e.plan.map(p=>({id:p.id,plannedReps:p.targetReps,plannedWeight:p.targetWeight,reps:p.targetReps,weight:p.targetWeight,durationSeconds:null,borgRpe:null,completed:false,skipped:false,startedAt:null,endedAt:null,completedAt:null,timer:newTimer()})) })) };
}
export function getSet(session,exerciseId,setId) { const exercise=session.exercises.find(e=>e.id===exerciseId),set=exercise?.sets.find(s=>s.id===setId);if(!set)fail('That set is unavailable.');return {exercise,set}; }
export function startSet(session,exerciseId,setId,now=Date.now()) {
  if(session.prompt)fail('Confirm or skip the pending Borg rating first.');
  const {exercise,set}=getSet(session,exerciseId,setId);if(set.completed||exercise.skipped||set.skipped)fail('Reopen this exercise or set before starting.');
  for(const e of session.exercises)for(const s of e.sets)if(s.id!==setId)pauseTimer(s.timer,now);
  startTimer(set.timer,now);set.startedAt=set.startedAt||iso(now);set.endedAt=null;return set;
}
export function pauseSet(session,exerciseId,setId,now=Date.now()) { const {set}=getSet(session,exerciseId,setId);pauseTimer(set.timer,now);set.durationSeconds=set.timer.touched?Math.floor(timerElapsed(set.timer,now)/1000):null;return set; }
export function resetSet(session,exerciseId,setId) { const {set}=getSet(session,exerciseId,setId);resetTimer(set.timer);set.durationSeconds=null;set.startedAt=null;set.endedAt=null;return set; }
export function beginCompletion(session,exerciseId,setId,now=Date.now()) {
  if(session.prompt)return session.prompt;
  const {set,exercise}=getSet(session,exerciseId,setId);if(exercise.skipped||set.skipped)fail('Restore this exercise before completing the set.');
  pauseSet(session,exerciseId,setId,now);if(set.timer.touched)set.endedAt=iso(now);
  session.prompt={exerciseId,setId,token:newId(),wasCompleted:set.completed};return session.prompt;
}
export function nextPending(session,afterSetId=null) {
  const all=session.exercises.flatMap((e,index)=>e.sets.map(s=>({exercise:e,set:s,index}))),start=all.findIndex(x=>x.set.id===afterSetId);
  const ordered=[...all.slice(start+1),...all.slice(0,start+1)];return ordered.find(x=>!x.exercise.skipped&&!x.set.completed&&!x.set.skipped)||null;
}
export function confirmCompletion(session,rpe,now=Date.now(),token=session.prompt?.token) {
  if(!validBorg(rpe))fail('Borg RPE must be 6–20, or skipped.');
  if(!session.prompt||session.prompt.token!==token)return false;
  const prompt=session.prompt,{exercise,set}=getSet(session,prompt.exerciseId,prompt.setId);
  set.completed=true;set.skipped=false;set.borgRpe=rpe;set.completedAt=set.completedAt||iso(now);session.prompt=null;
  const next=nextPending(session,set.id);
  if(!prompt.wasCompleted&&!session.editing&&next&&exercise.restSeconds>0) session.rest={status:'running',remainingMs:exercise.restSeconds*1000,deadline:now+exercise.restSeconds*1000,afterExerciseId:exercise.id,afterSetId:set.id,nextExerciseId:next.exercise.id,nextSetId:next.set.id,notified:false};
  session.highlightSetId=next?.set.id||null;return true;
}
export function restRemaining(rest,now=Date.now()) { return !rest?0:rest.status==='running'?Math.max(0,rest.deadline-now):rest.remainingMs; }
export function pauseRest(rest,now=Date.now()) { if(rest?.status==='running'){rest.remainingMs=restRemaining(rest,now);rest.deadline=null;rest.status='paused';}return rest; }
export function resumeRest(rest,now=Date.now()) { if(rest?.status==='paused'){rest.deadline=now+rest.remainingMs;rest.status='running';}return rest; }
export function addRest(rest,seconds=30,now=Date.now()) { if(!rest)return;rest.remainingMs=Math.min(3630000,restRemaining(rest,now)+seconds*1000);if(rest.status==='running')rest.deadline=now+rest.remainingMs;else if(rest.status==='finished'){rest.status='running';rest.deadline=now+rest.remainingMs;rest.notified=false;} }
export function skipRest(rest) { if(rest){rest.status='skipped';rest.deadline=null;rest.remainingMs=0;} }
export function checkRest(session,now=Date.now()) { if(session.rest?.status==='running'&&restRemaining(session.rest,now)===0){session.rest.status='finished';session.rest.remainingMs=0;session.rest.deadline=null;session.highlightSetId=session.rest.nextSetId;return true;}return false; }
export function addSessionSet(session,exerciseId) {
  const e=session.exercises.find(e=>e.id===exerciseId);if(!e||e.sets.length>=30)fail('Use at most 30 sets per exercise.');
  const last=e.sets.at(-1);const s={...copy(last),id:newId(),reps:last.plannedReps,weight:last.plannedWeight,completed:false,skipped:false,borgRpe:null,durationSeconds:null,startedAt:null,endedAt:null,completedAt:null,timer:newTimer()};e.sets.push(s);return s;
}
export function skipExercise(session,id,skipped=true,now=Date.now()) {
  const e=session.exercises.find(e=>e.id===id);if(!e)fail('Exercise unavailable.');e.skipped=skipped;
  if(skipped)for(const s of e.sets)pauseTimer(s.timer,now);
  return e;
}
export function completedSets(exercise) { return exercise.skipped?[]:exercise.sets.filter(s=>s.completed!==false&&!s.skipped); }
export function trainingTotals(exercises) {
  const result={volume:0,reps:0,sets:0,maxWeight:0,rpe:null,ratingCount:0,setDurationSeconds:0,exercises:0};let sum=0;
  for(const e of exercises){const sets=completedSets(e);if(sets.length)result.exercises++;for(const s of sets){const reps=s.reps*(e.repMode==='per-leg'?2:1);result.reps+=reps;result.volume+=reps*s.weight;result.sets++;result.maxWeight=Math.max(result.maxWeight,s.weight);if(s.durationSeconds!=null)result.setDurationSeconds+=s.durationSeconds;if(s.borgRpe!=null){sum+=s.borgRpe;result.ratingCount++;}}}
  result.rpe=result.ratingCount?sum/result.ratingCount:null;return result;
}
export function unfinishedSets(session) { return session.exercises.filter(e=>!e.skipped).reduce((n,e)=>n+e.sets.filter(s=>!s.completed&&!s.skipped).length,0); }
export function finishSession(session,now=Date.now()) {
  if(session.prompt)fail('Confirm or skip the pending Borg rating before finishing.');
  const snapshot=copy(session);for(const e of snapshot.exercises)for(const s of e.sets){pauseTimer(s.timer,now);if(s.timer.touched)s.durationSeconds=Math.floor(timerElapsed(s.timer,now)/1000);}
  return validateWorkoutV2({version:2,id:snapshot.id,templateId:snapshot.templateId,name:snapshot.name,date:snapshot.date,startedAt:snapshot.startedAt,endedAt:snapshot.editing?snapshot.endedAt:iso(now),durationSeconds:sessionElapsed(snapshot,now),timingSource:snapshot.timingSource,exercises:snapshot.exercises,deleted:false,revision:snapshot.revision,updatedAt:iso(now)});
}
export function workoutDetails(workout) { return [2,3].includes(workout.version)?{version:workout.version,name:workout.name,templateId:workout.templateId,startedAt:workout.startedAt,endedAt:workout.endedAt,durationSeconds:workout.durationSeconds,timingSource:workout.timingSource}:{}; }
export function sessionFromWorkout(workout) {
  const v2=workout.version===2;
  return {version:2,entity:'session',id:workout.id,templateId:workout.templateId||null,name:workout.name||'Workout',date:workout.date,startedAt:workout.startedAt||null,endedAt:workout.endedAt||null,timingSource:workout.timingSource||'unknown',originalDurationSeconds:workout.durationSeconds??null,current:0,editing:true,deleted:false,revision:workout.revision||0,baseRevision:workout.revision||0,baseLocalVersion:workout.localVersion||null,rest:null,prompt:null,highlightSetId:null,
    exercises:workout.exercises.map((e,i)=>({version:2,id:v2?e.id:newId(),position:i+1,exerciseId:e.exerciseId,name:e.name,variation:e.variation,notes:e.notes,repMode:e.repMode,restSeconds:e.restSeconds??90,skipped:e.skipped||false,acceptedProgression:e.acceptedProgression||null,sets:e.sets.map(s=>({...s,id:v2?s.id:newId(),plannedReps:s.plannedReps??s.reps,plannedWeight:s.plannedWeight??s.weight,completed:s.completed!==false,skipped:s.skipped||false,borgRpe:s.borgRpe??null,durationSeconds:s.durationSeconds??null,startedAt:s.startedAt||null,endedAt:s.endedAt||null,completedAt:s.completedAt||null,timer:{accumulatedMs:(s.durationSeconds||0)*1000,runningSince:null,touched:s.durationSeconds!=null}}))}))};
}
export function migrateLegacyDraft(draft,now=Date.now()) {
  const converted=sessionFromWorkout({id:draft.id,date:draft.date,exercises:draft.exercises.filter(e=>e.exerciseId!=='custom').map(e=>({...e,sets:e.sets.slice(0,e.count),skipped:e.status==='skipped'})),revision:0});
  converted.name='Resumed workout';converted.editing=Boolean(draft.editing);converted.startedAt=draft.editing?null:iso(now);converted.timingSource=draft.editing?'unknown':'resumed';converted.legacyDraftId=draft.id;
  converted.exercises.forEach(e=>{const old=draft.exercises.find(x=>x.exerciseId===e.exerciseId);e.sets.forEach(s=>s.completed=old.status==='completed');});
  converted.current=Math.max(0,Math.min(draft.current,converted.exercises.length-1));return validateSession(converted);
}
