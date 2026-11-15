import { completedSets, trainingTotals } from './model.js';
import { localDate } from './domain.js';
const normalized=value=>String(value||'').trim().toLowerCase();
export function exerciseKey(exercise){return `${exercise.exerciseId}|${normalized(exercise.variation)}|${exercise.repMode}`;}
export const progressionKey=(templateId,exerciseId)=>`${templateId||'legacy'}:${exerciseId}`;
export const progressionToken=suggestion=>suggestion.sourceIds.slice().sort().join(':');
export function comparisonKey(workout,selectedExercises=workout.exercises){
  return `${workout.templateId?`template:${workout.templateId}`:'legacy'}|${selectedExercises.map(exerciseKey).sort().join('::')}`;
}
export function changeBetween(value,previous){return previous===null||previous===undefined||value===null||value===undefined?null:{absolute:value-previous,percent:previous===0?null:(value-previous)/previous*100};}
export function cutoffDate(period,today=localDate()){
  if(period==='all')return '1900-01-01';const date=new Date(`${today}T12:00:00Z`);
  if(period==='7d'||period==='30d')date.setUTCDate(date.getUTCDate()-(period==='7d'?6:29));
  else if(period==='3m'||period==='6m'){const day=date.getUTCDate();date.setUTCDate(1);date.setUTCMonth(date.getUTCMonth()-(period==='3m'?3:6));date.setUTCDate(Math.min(day,new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate()));}
  else throw new Error('Unsupported analysis period.');return date.toISOString().slice(0,10);
}
export function analysisRows(workouts,{templateId='*',exerciseId='*',variation='*'}={}){
  const rows=workouts.filter(w=>!w.deleted&&(templateId==='*'||w.templateId===templateId)).flatMap(workout=>{
    const exercises=workout.exercises.filter(e=>!e.skipped&&(exerciseId==='*'||e.exerciseId===exerciseId)&&(variation==='*'||e.variation===variation));
    const t=trainingTotals(exercises);if(!t.sets)return [];
    const sets=exercises.flatMap(completedSets),knownDurations=sets.filter(s=>s.durationSeconds!=null);
    return [{workout,workoutId:workout.id,date:workout.date,name:workout.name||'Workout',...t,exerciseCount:t.exercises,exercises,duration:exerciseId==='*'?(workout.durationSeconds??null):(knownDurations.length?knownDurations.reduce((n,s)=>n+s.durationSeconds,0):null),key:comparisonKey(workout,exercises)}];
  }).sort((a,b)=>a.date.localeCompare(b.date)||a.workoutId.localeCompare(b.workoutId));
  const previous=new Map();
  for(const row of rows){row.previous=previous.get(row.key)||null;previous.set(row.key,row);}
  return rows;
}
export function analyze(workouts,filters={},today=localDate()){
  const min=cutoffDate(filters.period||'30d',today),rows=analysisRows(workouts,filters).filter(r=>r.date>=min&&r.date<=today),metric=filters.metric||'volume';
  const values=rows.filter(r=>r[metric]!==null),t=trainingTotals(rows.flatMap(r=>r.exercises));
  const durations=rows.filter(r=>r.duration!==null);
  const latest=rows.at(-1),recent=latest?changeBetween(latest.volume,latest.previous?.volume):null;
  return {rows,points:values,latest,totals:{...t,workouts:rows.length,duration:durations.length?durations.reduce((n,r)=>n+r.duration,0):null,durationCount:durations.length},recent};
}
export function compareWorkout(workout,workouts){
  const key=comparisonKey(workout),previous=workouts.filter(w=>!w.deleted&&w.id!==workout.id&&w.date<workout.date&&comparisonKey(w)===key).sort((a,b)=>b.date.localeCompare(a.date))[0]||null;
  const current=trainingTotals(workout.exercises),prior=previous?trainingTotals(previous.exercises):null;
  return {previous,current,prior,volume:changeBetween(current.volume,prior?.volume),rpe:changeBetween(current.rpe,prior?.rpe),duration:changeBetween(workout.durationSeconds??null,previous?.durationSeconds??null)};
}
function matchingHistory(current,workouts,templateId=null){
  return workouts.filter(w=>!w.deleted&&(!templateId||w.templateId===templateId)).sort((a,b)=>b.date.localeCompare(a.date)).flatMap(workout=>{
    const candidates=workout.exercises.filter(e=>exerciseKey(e)===exerciseKey(current)&&completedSets(e).length);
    const exercise=candidates.find(e=>e.id===current.id)||candidates[0];return exercise?[{workout,exercise,totals:trainingTotals([exercise])}]:[];
  });
}
export function progressionSuggestion(current,workouts,{templateId=null,beforeDate='2200-12-31'}={}){
  const history=matchingHistory(current,workouts.filter(w=>w.date<beforeDate),templateId).slice(0,2);
  if(history.length<2)return null;
  const targets=current.plan||current.sets.map(s=>({targetWeight:s.plannedWeight,targetReps:s.plannedReps}));
  if(!targets.length)return null;
  for(const {exercise,totals} of history){
    if(exercise.version!==2||exercise.skipped||exercise.sets.length!==targets.length||totals.ratingCount!==exercise.sets.length||totals.rpe>15)return null;
    if(exercise.sets.some((s,i)=>!s.completed||s.skipped||s.reps<s.plannedReps||s.plannedReps!==targets[i].targetReps||s.reps<targets[i].targetReps||s.weight<s.plannedWeight||s.weight!==targets[i].targetWeight))return null;
  }
  const [latest,previous]=history,weight=targets[0].targetWeight;
  if(latest.totals.rpe>previous.totals.rpe||weight<=0||targets.some(t=>t.targetWeight!==weight))return null;
  const sourceIds=history.map(h=>h.workout.id);
  if(current.acceptedProgression?.sourceIds?.every(id=>sourceIds.includes(id)))return null;
  const increase=Math.min(2.5,Math.max(.5,Math.floor(weight*.025*2)/2));
  if(increase/weight>.05||weight+increase>300)return null;
  return {fromWeight:weight,toWeight:weight+increase,increase,sourceIds,explanation:`All planned sets and reps were achieved in two comparable sessions. Every set was rated on Borg 6–20; the average stayed at or below 15 and did not rise. Suggesting a small ${increase} kg increase. This is a training suggestion, not an RIR estimate.`};
}
export function acceptProgression(exercise,suggestion,now=Date.now()){
  if(!suggestion||suggestion.toWeight<=suggestion.fromWeight)throw new Error('This progression is no longer available.');
  const targets=exercise.plan||exercise.sets.filter(s=>!s.completed&&!s.skipped);
  for(const s of targets){if(exercise.plan)s.targetWeight=suggestion.toWeight;else{if(s.weight===s.plannedWeight)s.weight=suggestion.toWeight;s.plannedWeight=suggestion.toWeight;}}
  exercise.acceptedProgression={fromWeight:suggestion.fromWeight,toWeight:suggestion.toWeight,sourceIds:[...suggestion.sourceIds],acceptedAt:new Date(now).toISOString()};return exercise;
}
export function exertionInsight(exercise,workouts,templateId=null){
  const history=matchingHistory(exercise,workouts,templateId).filter(h=>h.totals.rpe!==null).slice(0,2);
  if(history.length<2)return null;const [latest,previous]=history;
  const workload=e=>JSON.stringify(completedSets(e).map(s=>[s.weight,s.reps,e.repMode]));
  if(workload(latest.exercise)!==workload(previous.exercise))return {latest,previous,comparable:false,text:'Recorded loads or repetitions differ, so these Borg ratings describe different workloads.'};
  const delta=latest.totals.rpe-previous.totals.rpe;
  return {latest,previous,comparable:true,delta,text:delta<0?'The same recorded workload was rated as less demanding in the latest session.':delta>0?'The same recorded workload was rated as more demanding in the latest session.':'The same recorded workload received a similar exertion rating.',caution:'Borg ratings are subjective and can vary with fatigue, recovery, and other conditions.'};
}
export function exerciseAverages(rows){
  const grouped=new Map();for(const row of rows)for(const e of row.exercises){const key=exerciseKey(e),entry=grouped.get(key)||{exercise:e,sum:0,count:0};for(const s of completedSets(e))if(s.borgRpe!==null&&s.borgRpe!==undefined){entry.sum+=s.borgRpe;entry.count++;}grouped.set(key,entry);}
  return [...grouped.values()].filter(e=>e.count).map(e=>({...e,average:e.sum/e.count})).sort((a,b)=>a.exercise.name.localeCompare(b.exercise.name));
}
