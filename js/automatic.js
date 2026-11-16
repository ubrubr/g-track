import * as M from './model.js';
import { validateRoutine,validateAutomaticSession,validateAutomaticWorkout } from './schema3.js';
const iso=now=>new Date(now).toISOString();
export const blankRoutine=name=>({version:3,entity:'template',id:M.newId(),name:name||'New routine',exercises:[],deleted:false,revision:0,updatedAt:iso(Date.now())});
export function plannedExercise(definition,{sets=4,reps=10,weight=0,rest=180,repMode='total'}={}){const e=M.plannedExercise(definition,{sets,reps,weight,rest,repMode});e.version=3;delete e.acceptedProgression;return e;}
export function upgradeRoutine(value){if(value.version===3)return M.copy(value);const t=M.copy(value);t.version=3;t.entity='template';t.exercises.forEach(e=>e.version=3);return {...validateRoutine(t),localVersion:value.localVersion,sync:value.sync};}
function actualExercise(e){return {version:3,id:e.id,position:e.position,exerciseId:e.exerciseId,name:e.name,variation:e.variation,notes:e.notes,repMode:e.repMode,restSeconds:e.restSeconds,skipped:false,timing:M.newTimer(),durationSeconds:null,timingSource:'recorded',selectedSetId:e.plan[0].id,sets:e.plan.map(p=>({id:p.id,plannedReps:p.targetReps,plannedWeight:p.targetWeight,reps:p.targetReps,weight:p.targetWeight,completed:false,skipped:false,borgRpe:null,durationSeconds:null,startedAt:null,endedAt:null,completedAt:null}))};}
export function startWorkout(routine,date,now=Date.now()){
 const r=validateRoutine(upgradeRoutine(routine)),s={version:3,entity:'session',id:M.newId(),templateId:r.id,name:r.name,date,startedAt:iso(now),endedAt:null,editing:false,paused:false,deleted:false,current:0,timingSource:'recorded',workoutTimer:M.newTimer(),prompt:null,rest:null,exercises:r.exercises.map(actualExercise),revision:0,updatedAt:iso(now)};
 M.startTimer(s.workoutTimer,now);enterExercise(s,0,now);return validateAutomaticSession(s);
}
export function upgradeSession(value,now=Date.now()){
 if(value.version===3)return M.copy(value);
 const old=M.validateSession(value),s={...M.copy(old),version:3,paused:true,rest:null,prompt:null,workoutTimer:{accumulatedMs:(M.sessionElapsed(old,now)||0)*1000,runningSince:null,touched:old.startedAt!==null},exercises:old.exercises.map(e=>({...e,version:3,timing:M.newTimer(),durationSeconds:null,timingSource:'resumed',selectedSetId:e.sets.find(s=>!s.completed&&!s.skipped)?.id||e.sets[0].id,sets:e.sets.map(set=>{const copy=M.copy(set);if(copy.timer?.touched)copy.durationSeconds=Math.floor(M.timerElapsed(copy.timer,now)/1000);delete copy.timer;return copy;})}))};
 if(old.prompt){const e=s.exercises.find(e=>e.id===old.prompt.exerciseId),set=e.sets.find(set=>set.id===old.prompt.setId);set.completed=true;set.completedAt=set.completedAt||iso(now);s.prompt={token:old.prompt.token,exerciseId:e.id,setId:set.id,mode:old.prompt.wasCompleted?'edit':'completion'};}
 if(old.rest){s.rest={...old.rest,id:M.newId()};if(s.rest.status==='running'){M.pauseRest(s.rest,now);s.rest.resumeOnWorkout=true;}}
 return validateAutomaticSession(s);
}
export function enterExercise(s,index,now=Date.now()){
 if(index<0||index>=s.exercises.length)throw new Error('Exercise unavailable.');
 for(const e of s.exercises){M.pauseTimer(e.timing,now);if(e.timing.touched)e.durationSeconds=Math.floor(e.timing.accumulatedMs/1000);}
 const previous=s.exercises[s.current];s.current=index;const e=s.exercises[index];
 if(previous?.id!==e.id&&s.rest?.status==='running')M.skipRest(s.rest);
 if(!s.paused&&!s.editing&&!e.skipped&&e.sets.some(set=>!set.completed&&!set.skipped))M.startTimer(e.timing,now);
 return e;
}
export function pauseWorkout(s,now=Date.now()){
 if(s.paused)return s;for(const e of s.exercises){M.pauseTimer(e.timing,now);if(e.timing.touched)e.durationSeconds=Math.floor(e.timing.accumulatedMs/1000);}
 M.pauseTimer(s.workoutTimer,now);if(s.rest?.status==='running'){M.pauseRest(s.rest,now);s.rest.resumeOnWorkout=true;}s.paused=true;return s;
}
export function resumeWorkout(s,now=Date.now()){
 if(s.editing)return s;s.paused=false;M.startTimer(s.workoutTimer,now);enterExercise(s,s.current,now);if(s.rest?.resumeOnWorkout){M.resumeRest(s.rest,now);s.rest.resumeOnWorkout=false;}return s;
}
export function activeSet(e){return e.sets.find(set=>set.id===e.selectedSetId)||e.sets.find(set=>!set.completed&&!set.skipped)||e.sets.at(-1);}
export function completeSet(s,exerciseId,setId,{checked=true,rpeEnabled=true,now=Date.now()}={}){
 const {exercise:e,set}=M.getSet(s,exerciseId,setId);if(set.completed===checked)return false;
 if(checked&&s.prompt&&s.prompt.setId!==setId)return false;
 if(s.editing)throw new Error('Historical corrections do not use the live completion flow.');
 if(!checked){set.completed=false;set.completedAt=null;set.skipped=false;e.selectedSetId=set.id;if(s.prompt?.setId===set.id)s.prompt=null;if(s.rest?.afterSetId===set.id)M.skipRest(s.rest);if(s.current===s.exercises.indexOf(e)&&!s.paused)M.startTimer(e.timing,now);return true;}
 set.completed=true;set.skipped=false;set.completedAt=iso(now);e.selectedSetId=e.sets.find(x=>!x.completed&&!x.skipped)?.id||set.id;
 if(!e.sets.some(x=>!x.completed&&!x.skipped)){M.pauseTimer(e.timing,now);if(e.timing.touched)e.durationSeconds=Math.floor(e.timing.accumulatedMs/1000);}
 const token=M.newId();if(rpeEnabled){s.prompt={exerciseId:e.id,setId:set.id,token,mode:'completion',selection:null};}else{set.borgRpe=null;startRest(s,e,set,token,now);}return true;
}
function startRest(s,e,set,id,now){s.rest={id,status:e.restSeconds?'running':'finished',remainingMs:e.restSeconds*1000,deadline:e.restSeconds?now+e.restSeconds*1000:null,afterExerciseId:e.id,afterSetId:set.id,resumeOnWorkout:false};}
export function rateSet(s,rating,token=s.prompt?.token,now=Date.now()){
 if(!M.validBorg(rating))throw new Error('Choose Borg 6–20 or skip.');const p=s.prompt;if(!p||p.token!==token)return false;const {exercise:e,set}=M.getSet(s,p.exerciseId,p.setId);set.borgRpe=rating;s.prompt=null;if(p.mode==='completion'&&set.completed)startRest(s,e,set,p.token,now);return true;
}
export function editRating(s,exerciseId,setId){const {set}=M.getSet(s,exerciseId,setId);if(!set.completed)throw new Error('Complete this set first.');s.prompt={token:M.newId(),exerciseId,setId,mode:'edit',selection:set.borgRpe};}
export function resetRest(s,now=Date.now()){const e=s.exercises[s.current],set=activeSet(e);startRest(s,e,set,M.newId(),now);if(s.paused){M.pauseRest(s.rest,now);s.rest.resumeOnWorkout=true;}return s.rest;}
export function setRestDuration(s,seconds,now=Date.now()){if(!Number.isInteger(seconds)||seconds<0||seconds>3600)throw new Error('Use 0–3600 seconds.');s.exercises[s.current].restSeconds=seconds;if(s.rest&&s.rest.afterExerciseId===s.exercises[s.current].id&&['running','paused','finished'].includes(s.rest.status))resetRest(s,now);}
export function addSet(s,exerciseId,now=Date.now()){const e=s.exercises.find(e=>e.id===exerciseId);if(!e||e.sets.length>=30)throw new Error('Use at most 30 sets.');const last=e.sets.at(-1),set={...M.copy(last),id:M.newId(),weight:last.plannedWeight,reps:last.plannedReps,completed:false,skipped:false,borgRpe:null,durationSeconds:null,startedAt:null,endedAt:null,completedAt:null};e.sets.push(set);e.selectedSetId=set.id;if(!s.paused&&s.current===s.exercises.indexOf(e))M.startTimer(e.timing,now);return set;}
export function removeSet(s,exerciseId,setId,now=Date.now()){const e=s.exercises.find(e=>e.id===exerciseId);if(e.sets.length<=1)throw new Error('Keep at least one set.');e.sets=e.sets.filter(set=>set.id!==setId);if(s.prompt?.setId===setId)s.prompt=null;if(s.rest?.afterSetId===setId)M.skipRest(s.rest);if(!e.sets.some(set=>set.id===e.selectedSetId))e.selectedSetId=e.sets.find(set=>!set.completed)?.id||e.sets.at(-1).id;enterExercise(s,s.current,now);}
export const plannedVolume=e=>(e.plan||e.sets.map(set=>({targetWeight:set.plannedWeight??set.weight,targetReps:set.plannedReps??set.reps}))).reduce((n,p)=>n+p.targetWeight*p.targetReps*(e.repMode==='per-leg'?2:1),0);
export const exerciseKey=e=>`${e.exerciseId}|${(e.variation||'').trim().toLowerCase()}|${e.repMode}`;
export const workoutOrder=(a,b)=>a.date.localeCompare(b.date)||String(a.endedAt||a.updatedAt||a.id).localeCompare(String(b.endedAt||b.updatedAt||b.id));
export function progression(exercise,history,{excludeId=null}={}){
 const previous=history.filter(w=>!w.deleted&&w.id!==excludeId).sort(workoutOrder).reverse().flatMap(w=>{const matches=w.exercises.filter(e=>exerciseKey(e)===exerciseKey(exercise)&&M.completedSets(e).length);return matches.length?[{workout:w,exercise:matches.find(e=>e.id===exercise.id)||matches[0]}]:[];})[0]||null;
 const baseline=previous?M.trainingTotals([previous.exercise]).volume:null,planned=plannedVolume(exercise),actual=exercise.sets?M.trainingTotals([exercise]).volume:0;
 return {previous,baseline,planned,actual,plannedChange:baseline===null?null:planned-baseline,currentChange:baseline===null?null:actual-baseline};
}
export function changePlan(e,targets){if(targets.length!==e.sets.length)throw new Error('The set list changed. Reopen the plan.');for(let i=0;i<targets.length;i++){const set=e.sets[i],p=targets[i],untouched=!set.completed&&set.weight===set.plannedWeight&&set.reps===set.plannedReps;set.plannedWeight=p.targetWeight;set.plannedReps=p.targetReps;if(untouched){set.weight=p.targetWeight;set.reps=p.targetReps;}}return e;}
export function finishWorkout(s,history=[],now=Date.now()){
 const snapshot=M.copy(s);if(snapshot.prompt)rateSet(snapshot,null,snapshot.prompt.token,now);pauseWorkout(snapshot,now);
 for(const e of snapshot.exercises){const comparison=progression(e,history,{excludeId:s.id});e.progression={baselineWorkoutId:comparison.previous?.workout.id||null,baselineVolume:comparison.baseline};if(e.timing.touched)e.durationSeconds=Math.floor(e.timing.accumulatedMs/1000);}
 return validateAutomaticWorkout({version:3,id:s.id,templateId:s.templateId,name:s.name,date:s.date,startedAt:s.startedAt,endedAt:iso(now),durationSeconds:s.workoutTimer.touched?Math.floor(M.timerElapsed(snapshot.workoutTimer,now)/1000):null,timingSource:s.timingSource,exercises:snapshot.exercises,deleted:false,revision:s.revision,updatedAt:iso(now)});
}
export const toDisplayWeight=(kg,units='kg')=>units==='lb'?kg*2.20462262185:kg;
export const toKilograms=(value,units='kg')=>Math.round((units==='lb'?value/2.20462262185:value)*1e6)/1e6;
export const durationForExercise=(e,now=Date.now())=>e.timing?.touched?Math.floor(M.timerElapsed(e.timing,now)/1000):e.durationSeconds??null;
export function historicalCopy(workout){
 if(workout.version===3)return M.copy(workout);
 return {...M.copy(workout),version:3,templateId:workout.templateId||null,name:workout.name||'Workout',startedAt:workout.startedAt||null,endedAt:workout.endedAt||null,durationSeconds:workout.durationSeconds??null,timingSource:workout.timingSource||'unknown',exercises:workout.exercises.map((e,i)=>({version:3,id:e.id||M.newId(),position:i+1,exerciseId:e.exerciseId,name:e.name,variation:e.variation||'',notes:e.notes||'',repMode:e.repMode,restSeconds:e.restSeconds??180,skipped:e.skipped||false,timing:M.newTimer(),durationSeconds:null,timingSource:'unknown',planSource:workout.version===2?'recorded':'unknown',sets:e.sets.map(set=>({id:set.id||M.newId(),plannedWeight:set.plannedWeight??set.weight,plannedReps:set.plannedReps??set.reps,weight:set.weight,reps:set.reps,completed:set.completed!==false&&!set.skipped,skipped:set.skipped||false,borgRpe:set.borgRpe??null,durationSeconds:set.durationSeconds??null,startedAt:set.startedAt||null,endedAt:set.endedAt||null,completedAt:set.completedAt||null}))}))};
}
