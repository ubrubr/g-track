-- Additive release: automatic exercise timing, owner profiles and multiple workouts/drafts.
-- Apply after the two existing migrations. Does not rewrite workout or Auth rows.
begin;
create function gtrack_private.valid_clock_v3(v jsonb) returns boolean language plpgsql immutable set search_path='' as $$
begin
 if jsonb_typeof(v) is distinct from 'object' or not gtrack_private.valid_number(v->'accumulatedMs',0,315360000000) or jsonb_typeof(v->'touched') is distinct from 'boolean' then return false;end if;
 if not coalesce(jsonb_typeof(v->'runningSince')='null' or gtrack_private.valid_number(v->'runningSince',0,10000000000000),false) then return false;end if;
 return jsonb_typeof(v->'runningSince')='null' or (v->>'touched')::boolean;
exception when others then return false;end $$;
create function gtrack_private.valid_exercises_v3(payload jsonb,planned boolean,active boolean default false) returns boolean language plpgsql immutable set search_path='' as $$
declare e jsonb;s jsonb;items jsonb;pos integer:=0;seen_e text[]:='{}';seen_s text[]:='{}';p jsonb;
begin
 if jsonb_typeof(payload) is distinct from 'array' or jsonb_array_length(payload)<1 or jsonb_array_length(payload)>50 then return false;end if;
 for e in select value from jsonb_array_elements(payload) loop
  pos:=pos+1;
  if e->'version' is distinct from '3'::jsonb or not gtrack_private.valid_uuid(e->>'id') or e->>'id'=any(seen_e) or not gtrack_private.valid_number(e->'position',pos,pos) then return false;end if;seen_e:=array_append(seen_e,e->>'id');
  if not gtrack_private.valid_text(e->'exerciseId',96,1) or (e->>'exerciseId')!~'^[a-z0-9][a-z0-9:.-]{0,95}$' or not gtrack_private.valid_text(e->'name',80,1) or not gtrack_private.valid_text(e->'variation',120) or not gtrack_private.valid_text(e->'notes',2000) or coalesce(e->>'repMode','') not in ('total','per-leg') or not gtrack_private.valid_number(e->'restSeconds',0,3600) then return false;end if;
  if e?'planSource' and coalesce(e->>'planSource','') not in ('recorded','unknown') then return false;end if;
  items:=case when planned then e->'plan' else e->'sets' end;
  if jsonb_typeof(items) is distinct from 'array' or jsonb_array_length(items)<1 or jsonb_array_length(items)>30 then return false;end if;
  if not planned then
   if jsonb_typeof(e->'skipped') is distinct from 'boolean' or not gtrack_private.valid_clock_v3(e->'timing') or not coalesce(jsonb_typeof(e->'durationSeconds')='null' or gtrack_private.valid_number(e->'durationSeconds',0,315360000),false) or coalesce(e->>'timingSource','') not in ('recorded','resumed','unknown') then return false;end if;
   if not active and jsonb_typeof(e->'timing'->'runningSince') is distinct from 'null' then return false;end if;
   if not exists(select 1 from jsonb_array_elements(items)x where x->>'id'=e->>'selectedSetId') then return false;end if;
   if e?'progression' then p:=e->'progression';if not coalesce(jsonb_typeof(p->'baselineWorkoutId')='null' or gtrack_private.valid_uuid(p->>'baselineWorkoutId'),false) or not coalesce(jsonb_typeof(p->'baselineVolume')='null' or gtrack_private.valid_number(p->'baselineVolume',0,1000000000000,.000001),false) then return false;end if;end if;
  end if;
  for s in select value from jsonb_array_elements(items) loop
   if not gtrack_private.valid_uuid(s->>'id') or s->>'id'=any(seen_s) then return false;end if;seen_s:=array_append(seen_s,s->>'id');
   if planned then
    if not gtrack_private.valid_number(s->'targetReps',1,100) or not gtrack_private.valid_number(s->'targetWeight',0,10000,.000001) then return false;end if;
   else
    if not gtrack_private.valid_number(s->'plannedReps',1,100) or not gtrack_private.valid_number(s->'plannedWeight',0,10000,.000001) or not gtrack_private.valid_number(s->'reps',1,100) or not gtrack_private.valid_number(s->'weight',0,10000,.000001) or jsonb_typeof(s->'completed') is distinct from 'boolean' or jsonb_typeof(s->'skipped') is distinct from 'boolean' or ((s->>'completed')::boolean and (s->>'skipped')::boolean) or not gtrack_private.valid_borg(s->'borgRpe') then return false;end if;
    if not coalesce(jsonb_typeof(s->'durationSeconds')='null' or gtrack_private.valid_number(s->'durationSeconds',0,315360000),false) or not gtrack_private.valid_timestamp(s->'startedAt') or not gtrack_private.valid_timestamp(s->'endedAt') or not gtrack_private.valid_timestamp(s->'completedAt') then return false;end if;
   end if;
  end loop;
 end loop;return true;
exception when others then return false;end $$;
alter function gtrack_private.valid_workout(jsonb,jsonb,boolean) rename to valid_workout_v2;
create function gtrack_private.valid_workout(payload jsonb,details jsonb,deleted boolean) returns boolean language plpgsql immutable set search_path='' as $$
begin
 if details->'version' is distinct from '3'::jsonb then return gtrack_private.valid_workout_v2(payload,details,deleted);end if;
 if not gtrack_private.valid_text(details->'name',80,1) or not coalesce(jsonb_typeof(details->'templateId')='null' or gtrack_private.valid_uuid(details->>'templateId'),false) or not gtrack_private.valid_timestamp(details->'startedAt') or not gtrack_private.valid_timestamp(details->'endedAt') or coalesce(details->>'timingSource','') not in ('recorded','resumed','unknown') or not coalesce(jsonb_typeof(details->'durationSeconds')='null' or gtrack_private.valid_number(details->'durationSeconds',0,315360000),false) then return false;end if;
 if jsonb_typeof(details->'startedAt')='string' and jsonb_typeof(details->'endedAt')='string' and (details->>'endedAt')::timestamptz<(details->>'startedAt')::timestamptz then return false;end if;
 return gtrack_private.valid_exercises_v3(payload,false,false);
exception when others then return false;end $$;
alter table public.workouts drop constraint workouts_payload_check;
alter table public.workouts add constraint workouts_payload_check check(gtrack_private.valid_workout(exercises,details,deleted));
alter table public.workouts drop constraint workouts_user_id_workout_date_key;
create index workouts_owner_date on public.workouts(user_id,workout_date);

alter function gtrack_private.valid_document(text,jsonb,boolean) rename to valid_document_v2;
create function gtrack_private.valid_document(kind text,payload jsonb,deleted boolean) returns boolean language plpgsql immutable set search_path='' as $$
declare e jsonb;p jsonb;r jsonb;id jsonb;day date;running integer:=0;pos integer:=0;seen text[]:='{}';
begin
 if payload->'version' is distinct from '3'::jsonb then return gtrack_private.valid_document_v2(kind,payload,deleted);end if;
 if kind not in ('template','session','profile') or jsonb_typeof(payload) is distinct from 'object' or payload->>'entity' is distinct from kind or not gtrack_private.valid_uuid(payload->>'id') or payload->'deleted' is distinct from to_jsonb(deleted) or octet_length(payload::text)>512000 then return false;end if;
 if kind='profile' then
  if not gtrack_private.valid_text(payload->'displayName',80) or coalesce(payload->>'units','') not in ('kg','lb') or not gtrack_private.valid_number(payload->'defaultRestSeconds',0,3600) or jsonb_typeof(payload->'rpeEnabled') is distinct from 'boolean' or jsonb_typeof(payload->'routineOrder') is distinct from 'array' or jsonb_array_length(payload->'routineOrder')>2000 then return false;end if;
  for id in select value from jsonb_array_elements(payload->'routineOrder') loop if not gtrack_private.valid_uuid(id#>>'{}') or id#>>'{}'=any(seen) then return false;end if;seen:=array_append(seen,id#>>'{}');end loop;return true;
 end if;
 if not gtrack_private.valid_text(payload->'name',80,1) or not gtrack_private.valid_exercises_v3(payload->'exercises',kind='template',kind='session') then return false;end if;
 if kind='template' then return true;end if;
 if coalesce(payload->>'date','')!~'^\d{4}-\d{2}-\d{2}$' then return false;end if;day:=(payload->>'date')::date;
 if day<'1900-01-01'::date or day>'2200-12-31'::date or not gtrack_private.valid_number(payload->'current',0,jsonb_array_length(payload->'exercises')-1) or jsonb_typeof(payload->'paused') is distinct from 'boolean' or jsonb_typeof(payload->'editing') is distinct from 'boolean' or not gtrack_private.valid_clock_v3(payload->'workoutTimer') then return false;end if;
 if not coalesce(jsonb_typeof(payload->'templateId')='null' or gtrack_private.valid_uuid(payload->>'templateId'),false) or not gtrack_private.valid_timestamp(payload->'startedAt') or not gtrack_private.valid_timestamp(payload->'endedAt') or coalesce(payload->>'timingSource','') not in ('recorded','resumed','unknown') then return false;end if;
 for e in select value from jsonb_array_elements(payload->'exercises') loop
  if jsonb_typeof(e->'timing'->'runningSince')='number' then running:=running+1;if pos<>(payload->>'current')::integer then return false;end if;end if;pos:=pos+1;
 end loop;
 if running>1 or ((payload->>'paused')::boolean and (running>0 or jsonb_typeof(payload->'workoutTimer'->'runningSince')='number')) then return false;end if;
 p:=payload->'prompt';
 if jsonb_typeof(p) is distinct from 'null' then
  if p?'selection' and not gtrack_private.valid_borg(p->'selection') then return false;end if;
  if jsonb_typeof(p) is distinct from 'object' or not gtrack_private.valid_uuid(p->>'token') or coalesce(p->>'mode','') not in ('completion','edit') or not exists(select 1 from jsonb_array_elements(payload->'exercises') entries(value) cross join lateral jsonb_array_elements(entries.value->'sets') items(value) where entries.value->>'id'=p->>'exerciseId' and items.value->>'id'=p->>'setId' and items.value->'completed'='true'::jsonb) then return false;end if;
 end if;
 r:=payload->'rest';
 if jsonb_typeof(r) is distinct from 'null' then
  if jsonb_typeof(r) is distinct from 'object' or not gtrack_private.valid_uuid(r->>'id') or coalesce(r->>'status','') not in ('running','paused','finished','skipped') or not gtrack_private.valid_number(r->'remainingMs',0,3600000) or not gtrack_private.valid_uuid(r->>'afterExerciseId') or not gtrack_private.valid_uuid(r->>'afterSetId') then return false;end if;
  if r->>'status'='running' then if not gtrack_private.valid_number(r->'deadline',0,10000000000000) then return false;end if;elsif jsonb_typeof(r->'deadline') is distinct from 'null' then return false;end if;
 end if;
 if payload?'finishedWorkoutId' and not gtrack_private.valid_uuid(payload->>'finishedWorkoutId') then return false;end if;
 return true;
exception when others then return false;end $$;
alter table public.training_documents drop constraint training_documents_kind_check;
alter table public.training_documents add constraint training_documents_kind_check check(kind in ('template','session','profile'));
do $$declare c record;begin for c in select conname from pg_constraint where conrelid='public.training_documents'::regclass and contype='c' and pg_get_constraintdef(oid) like '%valid_document%' loop execute format('alter table public.training_documents drop constraint %I',c.conname);end loop;end$$;
alter table public.training_documents add constraint training_documents_payload_check check(gtrack_private.valid_document(kind,data,deleted));
drop index public.training_documents_one_active;
create unique index training_documents_one_profile on public.training_documents(user_id) where kind='profile' and not deleted;

create or replace function gtrack_private.apply_workout(p_operation_id uuid,p_base_revision bigint,p_workout jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid();target_id uuid;target_day date;details jsonb:=coalesce(p_workout->'details','{}'::jsonb);existing public.workouts%rowtype;collision public.workouts%rowtype;receipt public.sync_receipts%rowtype;fingerprint text;response jsonb;
begin
 if owner_id is null then raise exception 'Authentication required' using errcode='42501';end if;
 if p_operation_id is null or p_base_revision is null or p_base_revision<0 or jsonb_typeof(p_workout) is distinct from 'object' then raise exception 'Invalid operation';end if;
 target_id:=(p_workout->>'id')::uuid;target_day:=(p_workout->>'date')::date;
 if target_id is null or coalesce(p_workout->>'date','')!~'^\d{4}-\d{2}-\d{2}$' or jsonb_typeof(p_workout->'deleted') is distinct from 'boolean' then raise exception 'Invalid workout ID, date or deletion status';end if;
 if not gtrack_private.valid_workout(p_workout->'exercises',details,(p_workout->>'deleted')::boolean) then raise exception 'Invalid workout contents';end if;
 fingerprint:=md5(p_workout::text||':'||p_base_revision::text);perform pg_advisory_xact_lock(hashtextextended(owner_id::text,0));
 select * into receipt from public.sync_receipts where operation_id=p_operation_id;
 if found then
  if receipt.user_id<>owner_id or receipt.workout_id<>target_id or receipt.request_hash<>fingerprint then raise exception 'Operation ID cannot be reused' using errcode='42501';end if;return receipt.result;
 end if;
 select * into existing from public.workouts where id=target_id for update;
 if found and existing.user_id<>owner_id then raise exception 'Workout ID is unavailable' using errcode='42501';end if;
 if coalesce((existing.details->>'version')::integer,1)>coalesce((details->>'version')::integer,1) then raise exception 'Update G-Track before saving this record.' using errcode='22023';end if;
 if details->'version'='3'::jsonb and exists(select 1 from jsonb_array_elements(p_workout->'exercises') entries(value) join public.workouts baseline on baseline.id=(entries.value->'progression'->>'baselineWorkoutId')::uuid where baseline.user_id<>owner_id) then raise exception 'Baseline ownership mismatch' using errcode='42501';end if;
 if details->>'templateId' is not null and exists(select 1 from public.training_documents where id=(details->>'templateId')::uuid and user_id<>owner_id) then raise exception 'Template ownership mismatch' using errcode='42501';end if;
 if details->'version' is distinct from '3'::jsonb then
 select * into collision from public.workouts where user_id=owner_id and workout_date=target_day and id<>target_id for update;
 if found then return jsonb_build_object('status','conflict','workout',to_jsonb(collision));end if;
 end if;
 if existing.id is not null and existing.revision<>p_base_revision then return jsonb_build_object('status','conflict','workout',to_jsonb(existing));end if;
 if existing.id is null and p_base_revision<>0 then return jsonb_build_object('status','conflict','workout',null);end if;
 insert into public.workouts(id,user_id,workout_date,exercises,deleted,revision,last_operation_id,details)
 values(target_id,owner_id,target_day,p_workout->'exercises',(p_workout->>'deleted')::boolean,1,p_operation_id,details)
 on conflict(id) do update set workout_date=excluded.workout_date,exercises=excluded.exercises,deleted=excluded.deleted,revision=public.workouts.revision+1,last_operation_id=p_operation_id,updated_at=clock_timestamp(),details=excluded.details returning * into existing;
 response:=jsonb_build_object('status','ok','workout',to_jsonb(existing));
 insert into public.sync_receipts(operation_id,user_id,workout_id,request_hash,result) values(p_operation_id,owner_id,target_id,fingerprint,response);return response;
end $$;
create or replace function gtrack_private.apply_training_document(p_operation_id uuid,p_base_revision bigint,p_document jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid();target_id uuid;kind_value text;payload jsonb;is_deleted boolean;existing public.training_documents%rowtype;collision public.training_documents%rowtype;receipt public.training_receipts%rowtype;fingerprint text;response jsonb;
begin
 if owner_id is null then raise exception 'Authentication required' using errcode='42501';end if;
 if p_operation_id is null or p_base_revision is null or p_base_revision<0 or jsonb_typeof(p_document) is distinct from 'object' then raise exception 'Invalid operation';end if;
 target_id:=(p_document->>'id')::uuid;kind_value:=p_document->>'kind';payload:=p_document->'data';
 if jsonb_typeof(p_document->'deleted') is distinct from 'boolean' or target_id is null then raise exception 'Invalid document';end if;is_deleted:=(p_document->>'deleted')::boolean;
 if not gtrack_private.valid_document(kind_value,payload,is_deleted) or payload->>'id'<>target_id::text then raise exception 'Invalid training document';end if;
 fingerprint:=md5(p_document::text||':'||p_base_revision::text);perform pg_advisory_xact_lock(hashtextextended(owner_id::text,0));
 select * into receipt from public.training_receipts where operation_id=p_operation_id;
 if found then if receipt.user_id<>owner_id or receipt.document_id<>target_id or receipt.request_hash<>fingerprint then raise exception 'Operation ID cannot be reused' using errcode='42501';end if;return receipt.result;end if;
 select * into existing from public.training_documents where id=target_id for update;
 if found and (existing.user_id<>owner_id or existing.kind<>kind_value) then raise exception 'Document ID is unavailable' using errcode='42501';end if;
 if kind_value='profile' and target_id<>owner_id then raise exception 'Profile ownership mismatch' using errcode='42501';end if;
 if coalesce((existing.data->>'version')::integer,1)>coalesce((payload->>'version')::integer,1) then raise exception 'Update G-Track before saving this record' using errcode='22023';end if;
 if kind_value='profile' and exists(select 1 from jsonb_array_elements_text(payload->'routineOrder') ordered(id) join public.training_documents routine on routine.id=ordered.id::uuid where routine.user_id<>owner_id) then raise exception 'Routine ownership mismatch' using errcode='42501';end if;
 if payload->>'templateId' is not null and exists(select 1 from public.training_documents where id=(payload->>'templateId')::uuid and user_id<>owner_id) then raise exception 'Template ownership mismatch' using errcode='42501';end if;
 if payload?'finishedWorkoutId' and not exists(select 1 from public.workouts where id=(payload->>'finishedWorkoutId')::uuid and user_id=owner_id) then raise exception 'Finished workout ownership mismatch' using errcode='42501';end if;
 if existing.id is not null and existing.revision<>p_base_revision then return jsonb_build_object('status','conflict','document',to_jsonb(existing));end if;
 if existing.id is null and p_base_revision<>0 then return jsonb_build_object('status','conflict','document',null);end if;
 insert into public.training_documents(id,user_id,kind,data,deleted,revision,last_operation_id) values(target_id,owner_id,kind_value,payload,is_deleted,1,p_operation_id)
 on conflict(id) do update set data=excluded.data,deleted=excluded.deleted,revision=public.training_documents.revision+1,last_operation_id=p_operation_id,updated_at=clock_timestamp() returning * into existing;
 response:=jsonb_build_object('status','ok','document',to_jsonb(existing));
 insert into public.training_receipts(operation_id,user_id,document_id,request_hash,result) values(p_operation_id,owner_id,target_id,fingerprint,response);return response;
end $$;

create or replace function public.gtrack_api_version() returns integer language sql stable security invoker set search_path='' as $$select 3$$;
revoke all on all functions in schema gtrack_private from public,anon,authenticated;
grant execute on function gtrack_private.apply_workout(uuid,bigint,jsonb),gtrack_private.apply_training_document(uuid,bigint,jsonb) to authenticated;
commit;
