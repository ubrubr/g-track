// Version 3 adds automatic whole-exercise timing and independently resumable workouts.
// This module is independent of the legacy model so old documents remain readable.
const fail=message=>{throw new Error(message);};
export const idValid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export const numeric=(value,min,max,step=1)=>typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max&&Math.abs(value/step-Math.round(value/step))<1e-6;
const text=(value,max,required=false)=>typeof value==='string'&&value.length<=max&&(!required||value.trim())?value.trim():fail('Check the entered text.');
const stamp=value=>value===null||(typeof value==='string'&&/^\d{4}-\d\d-\d\dT/.test(value)&&Number.isFinite(Date.parse(value)))?value:fail('Invalid saved timestamp.');
const day=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&value>='1900-01-01'&&value<='2200-12-31'&&Number.isFinite(Date.parse(`${value}T12:00:00Z`))&&new Date(`${value}T12:00:00Z`).toISOString().slice(0,10)===value;
const meta=v=>({revision:Number.isSafeInteger(v.revision)&&v.revision>=0?v.revision:0,updatedAt:v.updatedAt||new Date().toISOString(),lastOperationId:v.lastOperationId||null});
const unique=values=>{if(new Set(values).size!==values.length)fail('Duplicate saved identifier.');};
export function clock(value){if(!value||!numeric(value.accumulatedMs,0,315360000000)||(value.runningSince!==null&&!numeric(value.runningSince,0,10000000000000))||typeof value.touched!=='boolean'||(value.runningSince!==null&&!value.touched))fail('Invalid exercise timing.');return {accumulatedMs:value.accumulatedMs,runningSince:value.runningSince,touched:value.touched};}
const weight=value=>numeric(value,0,10000,.000001);
function set(value,planned){
  if(!value||!idValid(value.id))fail('Invalid saved set.');
  if(planned){if(!numeric(value.targetReps,1,100)||!weight(value.targetWeight))fail('Use 1–100 reps and a valid non-negative weight.');return {id:value.id,targetReps:value.targetReps,targetWeight:value.targetWeight};}
  if(!numeric(value.plannedReps,1,100)||!weight(value.plannedWeight)||!numeric(value.reps,1,100)||!weight(value.weight)||typeof value.completed!=='boolean'||typeof value.skipped!=='boolean'||(value.completed&&value.skipped)||(value.borgRpe!==null&&!numeric(value.borgRpe,6,20))||(value.durationSeconds!==null&&!numeric(value.durationSeconds,0,315360000)))fail('Check the set values and Borg rating.');
  return {id:value.id,plannedReps:value.plannedReps,plannedWeight:value.plannedWeight,reps:value.reps,weight:value.weight,completed:value.completed,skipped:value.skipped,borgRpe:value.borgRpe,durationSeconds:value.durationSeconds,startedAt:stamp(value.startedAt??null),endedAt:stamp(value.endedAt??null),completedAt:stamp(value.completedAt??null)};
}
function exercise(v,planned,active){
  if(!v||!idValid(v.id)||!numeric(v.position,1,50)||typeof v.exerciseId!=='string'||!/^[a-z0-9][a-z0-9:.-]{0,95}$/.test(v.exerciseId)||!['total','per-leg'].includes(v.repMode)||!numeric(v.restSeconds,0,3600))fail('Check this exercise.');
  const result={version:3,id:v.id,position:v.position,exerciseId:v.exerciseId,name:text(v.name,80,true),variation:text(v.variation??'',120),notes:text(v.notes??'',2000),repMode:v.repMode,restSeconds:v.restSeconds};
  if(v.planSource!==undefined){if(!['recorded','unknown'].includes(v.planSource))fail('Invalid historical plan source.');result.planSource=v.planSource;}
  const list=planned?v.plan:v.sets;if(!Array.isArray(list)||list.length<1||list.length>30)fail('Use 1–30 sets per exercise.');unique(list.map(s=>s.id));
  if(planned)result.plan=list.map(s=>set(s,true));
  else{
    if(typeof v.skipped!=='boolean')fail('Invalid exercise state.');result.skipped=v.skipped;result.sets=list.map(s=>set(s,false));result.timing=clock(v.timing);result.durationSeconds=v.durationSeconds??null;result.timingSource=v.timingSource||'recorded';
    if((result.durationSeconds!==null&&!numeric(result.durationSeconds,0,315360000))||!['recorded','resumed','unknown'].includes(result.timingSource)||(!active&&result.timing.runningSince!==null))fail('Invalid exercise duration.');
    result.selectedSetId=v.selectedSetId??result.sets.find(s=>!s.completed&&!s.skipped)?.id??result.sets.at(-1).id;if(!result.sets.some(s=>s.id===result.selectedSetId))fail('Invalid selected set.');
    if(v.progression){const p=v.progression;if((p.baselineWorkoutId!==null&&!idValid(p.baselineWorkoutId))||(p.baselineVolume!==null&&(!Number.isFinite(p.baselineVolume)||p.baselineVolume<0||p.baselineVolume>1e12)))fail('Invalid progression baseline.');result.progression={baselineWorkoutId:p.baselineWorkoutId,baselineVolume:p.baselineVolume};}
  }
  return result;
}
export const validateExercise3=(value,{planned=false,active=false}={})=>exercise(value,planned,active);
function exercises(values,planned=false,active=false){if(!Array.isArray(values)||values.length<1||values.length>50)fail('Add 1–50 exercises.');unique(values.map(v=>v.id));const result=values.map((v,i)=>{const e=exercise(v,planned,active);if(e.position!==i+1)fail('Invalid exercise order.');return e;});unique(result.flatMap(e=>(planned?e.plan:e.sets).map(s=>s.id)));return result;}
export function validateRoutine(v){if(!v||v.version!==3||v.entity!=='template'||!idValid(v.id)||typeof v.deleted!=='boolean')fail('Invalid routine.');return {version:3,entity:'template',id:v.id,name:text(v.name,80,true),exercises:exercises(v.exercises,true),deleted:v.deleted,...meta(v)};}
export function validateAutomaticSession(v){
  if(!v||v.version!==3||v.entity!=='session'||!idValid(v.id)||!idValid(v.templateId)&&v.templateId!==null||!day(v.date)||typeof v.deleted!=='boolean'||typeof v.paused!=='boolean'||typeof v.editing!=='boolean')fail('Invalid saved workout.');
  const result={...structuredClone(v),name:text(v.name,80,true),startedAt:stamp(v.startedAt),endedAt:stamp(v.endedAt),workoutTimer:clock(v.workoutTimer),exercises:exercises(v.exercises,false,true),...meta(v)};
  if(!numeric(v.current,0,result.exercises.length-1)||!['recorded','resumed','unknown'].includes(v.timingSource))fail('Invalid workout position.');
  if(v.paused&&(result.workoutTimer.runningSince!==null||result.exercises.some(e=>e.timing.runningSince!==null)))fail('Paused workouts cannot have a running exercise clock.');
  if(result.exercises.filter(e=>e.timing.runningSince!==null).length>1||result.exercises.some((e,i)=>e.timing.runningSince!==null&&i!==result.current))fail('Only the current exercise can be timed.');
  if(v.prompt){const p=v.prompt,e=result.exercises.find(e=>e.id===p.exerciseId);if(!idValid(p.token)||!['completion','edit'].includes(p.mode)||!e?.sets.some(s=>s.id===p.setId&&s.completed))fail('Invalid pending Borg input.');if(p.selection!==undefined&&p.selection!==null&&!numeric(p.selection,6,20))fail('Invalid pending rating.');result.prompt={token:p.token,exerciseId:p.exerciseId,setId:p.setId,mode:p.mode,selection:p.selection??null};}else result.prompt=null;
  if(v.rest){const r=v.rest;if(!idValid(r.id)||!['running','paused','finished','skipped'].includes(r.status)||!numeric(r.remainingMs,0,3600000)||(r.deadline!==null&&!numeric(r.deadline,0,10000000000000))||(r.status==='running'&&r.deadline===null)||(r.status!=='running'&&r.deadline!==null)||!idValid(r.afterExerciseId)||!idValid(r.afterSetId))fail('Invalid saved rest.');result.rest={...r};}else result.rest=null;
  return result;
}
export function validateAutomaticWorkout(v){
  if(!v||v.version!==3||!idValid(v.id)||(v.templateId!==null&&!idValid(v.templateId))||!day(v.date)||typeof v.deleted!=='boolean'||(v.durationSeconds!==null&&!numeric(v.durationSeconds,0,315360000)))fail('Invalid workout record.');
  const result={version:3,id:v.id,templateId:v.templateId,name:text(v.name,80,true),date:v.date,startedAt:stamp(v.startedAt),endedAt:stamp(v.endedAt),durationSeconds:v.durationSeconds,timingSource:v.timingSource||'recorded',exercises:exercises(v.exercises),deleted:v.deleted,...meta(v)};
  if(!['recorded','resumed','unknown'].includes(result.timingSource)||(result.startedAt&&result.endedAt&&Date.parse(result.endedAt)<Date.parse(result.startedAt)))fail('Invalid workout time.');return result;
}
export function validateProfile(v){if(!v||v.version!==3||v.entity!=='profile'||!idValid(v.id)||!['kg','lb'].includes(v.units)||!numeric(v.defaultRestSeconds,0,3600)||typeof v.rpeEnabled!=='boolean'||typeof v.deleted!=='boolean'||!Array.isArray(v.routineOrder)||!v.routineOrder.every(idValid))fail('Check your profile preferences.');unique(v.routineOrder);return {version:3,entity:'profile',id:v.id,displayName:text(v.displayName,80),units:v.units,defaultRestSeconds:v.defaultRestSeconds,rpeEnabled:v.rpeEnabled,routineOrder:[...v.routineOrder],deleted:v.deleted,...meta(v)};}
export const validateDocument=v=>v.entity==='profile'?validateProfile(v):v.entity==='template'?validateRoutine(v):validateAutomaticSession(v);
