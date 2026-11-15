-- G-Track 2.0, additive and backward compatible with existing v1 workout rows.
-- REVIEW ONLY: apply after taking a backup and before deploying the v2 application.
begin;
create schema if not exists gtrack_private;
revoke all on schema gtrack_private from public,anon;
grant usage on schema gtrack_private to authenticated;

create function gtrack_private.valid_uuid(v text) returns boolean language sql immutable set search_path='' as $$
 select coalesce(v ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',false)
$$;
create function gtrack_private.valid_number(v jsonb,lo numeric,hi numeric,step numeric default 1) returns boolean language plpgsql immutable set search_path='' as $$
begin
 if jsonb_typeof(v) is distinct from 'number' then return false;end if;
 return (v#>>'{}')::numeric between lo and hi and mod((v#>>'{}')::numeric,step)=0;
exception when others then return false;end $$;
create function gtrack_private.valid_text(v jsonb,max_len integer,min_len integer default 0) returns boolean language sql immutable set search_path='' as $$
 select coalesce(jsonb_typeof(v)='string' and length(v#>>'{}')<=max_len and length(trim(v#>>'{}'))>=min_len,false)
$$;
create function gtrack_private.valid_timestamp(v jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare stamp timestamptz;
begin
 if jsonb_typeof(v)='null' then return true;end if;
 if jsonb_typeof(v) is distinct from 'string' or length(v#>>'{}')>40 or (v#>>'{}') !~ '^\d{4}-\d\d-\d\dT' then return false;end if;
 stamp:=(v#>>'{}')::timestamptz;return isfinite(stamp);
exception when others then return false;end $$;
create function gtrack_private.valid_borg(v jsonb) returns boolean language sql immutable set search_path='' as $$
 select coalesce(jsonb_typeof(v)='null' or gtrack_private.valid_number(v,6,20),false)
$$;
create function gtrack_private.valid_acceptance(v jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare source jsonb;
begin
 if v is null or jsonb_typeof(v)='null' then return true;end if;
 if jsonb_typeof(v) is distinct from 'object' or not gtrack_private.valid_number(v->'fromWeight',0,300,.5) or not gtrack_private.valid_number(v->'toWeight',0,300,.5) or (v->>'toWeight')::numeric<=(v->>'fromWeight')::numeric then return false;end if;
 if jsonb_typeof(v->'sourceIds') is distinct from 'array' or jsonb_array_length(v->'sourceIds')>20 then return false;end if;
 for source in select value from jsonb_array_elements(v->'sourceIds') loop if not gtrack_private.valid_uuid(source#>>'{}') then return false;end if;end loop;
 return gtrack_private.valid_timestamp(v->'acceptedAt') and jsonb_typeof(v->'acceptedAt')='string';
exception when others then return false;end $$;
create function gtrack_private.valid_exercises(payload jsonb,planned boolean,active boolean default false) returns boolean language plpgsql immutable set search_path='' as $$
declare e jsonb;s jsonb;items jsonb;pos integer:=0;seen_entries text[]:='{}';seen_sets text[]:='{}';timer jsonb;
begin
 if jsonb_typeof(payload) is distinct from 'array' or jsonb_array_length(payload)<1 or jsonb_array_length(payload)>50 then return false;end if;
 for e in select value from jsonb_array_elements(payload) loop
  pos:=pos+1;
  if e->'version' is distinct from '2'::jsonb or not gtrack_private.valid_uuid(e->>'id') or e->>'id'=any(seen_entries) or not gtrack_private.valid_number(e->'position',pos,pos) then return false;end if;
  seen_entries:=array_append(seen_entries,e->>'id');
  if not gtrack_private.valid_text(e->'exerciseId',96,1) or (e->>'exerciseId')!~'^[a-z0-9][a-z0-9:.-]{0,95}$' or not gtrack_private.valid_text(e->'name',80,1) or not gtrack_private.valid_text(e->'variation',120) or not gtrack_private.valid_text(e->'notes',2000) then return false;end if;
  if coalesce(e->>'repMode','') not in ('total','per-leg') or not gtrack_private.valid_number(e->'restSeconds',0,3600) or not gtrack_private.valid_acceptance(e->'acceptedProgression') then return false;end if;
  items:=case when planned then e->'plan' else e->'sets' end;
  if jsonb_typeof(items) is distinct from 'array' or jsonb_array_length(items)<1 or jsonb_array_length(items)>30 then return false;end if;
  if not planned and jsonb_typeof(e->'skipped') is distinct from 'boolean' then return false;end if;
  for s in select value from jsonb_array_elements(items) loop
   if not gtrack_private.valid_uuid(s->>'id') or s->>'id'=any(seen_sets) then return false;end if;seen_sets:=array_append(seen_sets,s->>'id');
   if planned then
    if not gtrack_private.valid_number(s->'targetReps',1,100) or not gtrack_private.valid_number(s->'targetWeight',0,300,.5) then return false;end if;
   else
    if not gtrack_private.valid_number(s->'plannedReps',1,100) or not gtrack_private.valid_number(s->'plannedWeight',0,300,.5) or not gtrack_private.valid_number(s->'reps',1,100) or not gtrack_private.valid_number(s->'weight',0,300,.5) then return false;end if;
    if jsonb_typeof(s->'completed') is distinct from 'boolean' or jsonb_typeof(s->'skipped') is distinct from 'boolean' or ((s->>'completed')::boolean and (s->>'skipped')::boolean) or not gtrack_private.valid_borg(s->'borgRpe') then return false;end if;
    if not coalesce(jsonb_typeof(s->'durationSeconds')='null' or gtrack_private.valid_number(s->'durationSeconds',0,315360000),false) then return false;end if;
    if not gtrack_private.valid_timestamp(s->'startedAt') or not gtrack_private.valid_timestamp(s->'endedAt') or not gtrack_private.valid_timestamp(s->'completedAt') then return false;end if;
    if active then
     timer:=s->'timer';
     if jsonb_typeof(timer) is distinct from 'object' or not gtrack_private.valid_number(timer->'accumulatedMs',0,315360000000) or jsonb_typeof(timer->'touched') is distinct from 'boolean' then return false;end if;
     if not coalesce(jsonb_typeof(timer->'runningSince')='null' or gtrack_private.valid_number(timer->'runningSince',0,10000000000000),false) then return false;end if;
     if jsonb_typeof(timer->'runningSince')='number' and not (timer->>'touched')::boolean then return false;end if;
    end if;
   end if;
  end loop;
 end loop;
 return true;
exception when others then return false;end $$;
create function gtrack_private.has_completed(payload jsonb) returns boolean language sql immutable set search_path='' as $$
 select exists(select 1 from jsonb_array_elements(payload)e cross join lateral jsonb_array_elements(e->'sets')s where e->'skipped'='false'::jsonb and s->'completed'='true'::jsonb and s->'skipped'='false'::jsonb)
$$;
create function gtrack_private.valid_details(v jsonb) returns boolean language plpgsql immutable set search_path='' as $$
begin
 if jsonb_typeof(v) is distinct from 'object' or v->'version' is distinct from '2'::jsonb or not gtrack_private.valid_text(v->'name',80,1) then return false;end if;
 if not coalesce(jsonb_typeof(v->'templateId')='null' or gtrack_private.valid_uuid(v->>'templateId'),false) or coalesce(v->>'timingSource','') not in ('recorded','resumed','unknown') then return false;end if;
 if not coalesce(jsonb_typeof(v->'durationSeconds')='null' or gtrack_private.valid_number(v->'durationSeconds',0,315360000),false) or not gtrack_private.valid_timestamp(v->'startedAt') or not gtrack_private.valid_timestamp(v->'endedAt') then return false;end if;
 if jsonb_typeof(v->'startedAt')='string' and jsonb_typeof(v->'endedAt')='string' and (v->>'endedAt')::timestamptz<(v->>'startedAt')::timestamptz then return false;end if;
 return true;
exception when others then return false;end $$;
create function gtrack_private.valid_workout(payload jsonb,details jsonb,deleted boolean) returns boolean language plpgsql immutable set search_path='' as $$
begin
 if details='{}'::jsonb then return public.form_valid_exercises(payload);end if;
 return gtrack_private.valid_details(details) and gtrack_private.valid_exercises(payload,false,false) and (deleted or gtrack_private.has_completed(payload));
exception when others then return false;end $$;
alter table public.workouts add column details jsonb not null default '{}'::jsonb;
alter table public.workouts drop constraint workouts_exercises_check;
alter table public.workouts add constraint workouts_payload_check check(gtrack_private.valid_workout(exercises,details,deleted));

create function gtrack_private.valid_document(kind text,payload jsonb,deleted boolean) returns boolean language plpgsql immutable set search_path='' as $$
declare r jsonb;p jsonb;day date;
begin
 if kind not in ('template','session') or jsonb_typeof(payload) is distinct from 'object' or payload->'version' is distinct from '2'::jsonb or payload->>'entity' is distinct from kind or not gtrack_private.valid_uuid(payload->>'id') or payload->'deleted' is distinct from to_jsonb(deleted) or not gtrack_private.valid_text(payload->'name',80,1) or octet_length(payload::text)>512000 then return false;end if;
 if not gtrack_private.valid_exercises(payload->'exercises',kind='template',kind='session') then return false;end if;
 if kind='template' then return true;end if;
 if coalesce(payload->>'date','')!~'^\d{4}-\d{2}-\d{2}$' then return false;end if;day:=(payload->>'date')::date;
 if day<'1900-01-01'::date or day>'2200-12-31'::date or not gtrack_private.valid_number(payload->'current',0,jsonb_array_length(payload->'exercises')-1) or jsonb_typeof(payload->'editing') is distinct from 'boolean' then return false;end if;
 if not coalesce(jsonb_typeof(payload->'templateId')='null' or gtrack_private.valid_uuid(payload->>'templateId'),false) or not gtrack_private.valid_timestamp(payload->'startedAt') or not gtrack_private.valid_timestamp(payload->'endedAt') or coalesce(payload->>'timingSource','') not in ('recorded','resumed','unknown') then return false;end if;
 if not coalesce(jsonb_typeof(payload->'originalDurationSeconds')='null' or gtrack_private.valid_number(payload->'originalDurationSeconds',0,315360000),false) then return false;end if;
 if (payload->>'editing')::boolean and (not gtrack_private.valid_number(payload->'baseRevision',0,9007199254740990) or not coalesce(jsonb_typeof(payload->'baseLocalVersion')='null' or gtrack_private.valid_uuid(payload->>'baseLocalVersion'),false)) then return false;end if;
 p:=payload->'prompt';
 if jsonb_typeof(p) is distinct from 'null' then
  if jsonb_typeof(p) is distinct from 'object' or not gtrack_private.valid_uuid(p->>'token') or jsonb_typeof(p->'wasCompleted') is distinct from 'boolean' or not exists(select 1 from jsonb_array_elements(payload->'exercises')e cross join lateral jsonb_array_elements(e->'sets')s where e->>'id'=p->>'exerciseId' and s->>'id'=p->>'setId') then return false;end if;
 end if;
 r:=payload->'rest';
 if jsonb_typeof(r) is distinct from 'null' then
  if jsonb_typeof(r) is distinct from 'object' or coalesce(r->>'status','') not in ('running','paused','finished','skipped') or not gtrack_private.valid_number(r->'remainingMs',0,3630000) or jsonb_typeof(r->'notified') is distinct from 'boolean' then return false;end if;
  if r->>'status'='running' then if not gtrack_private.valid_number(r->'deadline',0,10000000000000) then return false;end if;
  elsif jsonb_typeof(r->'deadline') is distinct from 'null' then return false;end if;
  if not gtrack_private.valid_uuid(r->>'afterExerciseId') or not gtrack_private.valid_uuid(r->>'afterSetId') or not gtrack_private.valid_uuid(r->>'nextExerciseId') or not gtrack_private.valid_uuid(r->>'nextSetId') then return false;end if;
 end if;
 if payload?'finishedWorkoutId' and not gtrack_private.valid_uuid(payload->>'finishedWorkoutId') then return false;end if;
 return true;
exception when others then return false;end $$;
create table public.training_documents(
 id uuid primary key,user_id uuid not null references auth.users(id) on delete cascade,
 kind text not null check(kind in ('template','session')),data jsonb not null,
 deleted boolean not null default false,revision bigint not null default 1 check(revision>0 and revision<9007199254740991),
 last_operation_id uuid not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(id,user_id),check(gtrack_private.valid_document(kind,data,deleted)),check(data->>'id'=id::text)
);
create index training_documents_user_updated on public.training_documents(user_id,updated_at);
create unique index training_documents_one_active on public.training_documents(user_id) where kind='session' and not deleted;
create table public.training_receipts(
 operation_id uuid primary key,user_id uuid not null references auth.users(id) on delete cascade,
 document_id uuid not null,request_hash text not null,result jsonb not null,created_at timestamptz not null default now(),
 foreign key(document_id,user_id) references public.training_documents(id,user_id) on delete cascade
);
create index training_receipts_user on public.training_receipts(user_id);
alter table public.training_documents enable row level security;
alter table public.training_receipts enable row level security;
create policy training_documents_owner_read on public.training_documents for select to authenticated using(user_id=(select auth.uid()));
create policy training_receipts_owner_read on public.training_receipts for select to authenticated using(user_id=(select auth.uid()) and exists(select 1 from public.training_documents d where d.id=document_id and d.user_id=(select auth.uid())));
revoke all on public.training_documents,public.training_receipts from anon,authenticated;
grant select on public.training_documents,public.training_receipts to authenticated;

create function gtrack_private.apply_workout(p_operation_id uuid,p_base_revision bigint,p_workout jsonb)
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
 if existing.details->'version'='2'::jsonb and details->'version' is distinct from '2'::jsonb then raise exception 'This workout requires G-Track 2. Close and reopen the application to update.' using errcode='22023';end if;
 if details->>'templateId' is not null and exists(select 1 from public.training_documents where id=(details->>'templateId')::uuid and user_id<>owner_id) then raise exception 'Template ownership mismatch' using errcode='42501';end if;
 select * into collision from public.workouts where user_id=owner_id and workout_date=target_day and id<>target_id for update;
 if found then return jsonb_build_object('status','conflict','workout',to_jsonb(collision));end if;
 if existing.id is not null and existing.revision<>p_base_revision then return jsonb_build_object('status','conflict','workout',to_jsonb(existing));end if;
 if existing.id is null and p_base_revision<>0 then return jsonb_build_object('status','conflict','workout',null);end if;
 insert into public.workouts(id,user_id,workout_date,exercises,deleted,revision,last_operation_id,details)
 values(target_id,owner_id,target_day,p_workout->'exercises',(p_workout->>'deleted')::boolean,1,p_operation_id,details)
 on conflict(id) do update set workout_date=excluded.workout_date,exercises=excluded.exercises,deleted=excluded.deleted,revision=public.workouts.revision+1,last_operation_id=p_operation_id,updated_at=clock_timestamp(),details=excluded.details returning * into existing;
 response:=jsonb_build_object('status','ok','workout',to_jsonb(existing));
 insert into public.sync_receipts(operation_id,user_id,workout_id,request_hash,result) values(p_operation_id,owner_id,target_id,fingerprint,response);return response;
end $$;
create or replace function public.apply_workout(p_operation_id uuid,p_base_revision bigint,p_workout jsonb) returns jsonb language sql security invoker set search_path='' as $$
 select gtrack_private.apply_workout(p_operation_id,p_base_revision,p_workout)
$$;

create function gtrack_private.apply_training_document(p_operation_id uuid,p_base_revision bigint,p_document jsonb)
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
 if kind_value='session' and not is_deleted then
  select * into collision from public.training_documents where user_id=owner_id and kind='session' and not deleted and id<>target_id for update;
  if found then return jsonb_build_object('status','conflict','document',to_jsonb(collision));end if;
 end if;
 if payload->>'templateId' is not null and exists(select 1 from public.training_documents where id=(payload->>'templateId')::uuid and user_id<>owner_id) then raise exception 'Template ownership mismatch' using errcode='42501';end if;
 if payload?'finishedWorkoutId' and not exists(select 1 from public.workouts where id=(payload->>'finishedWorkoutId')::uuid and user_id=owner_id) then raise exception 'Finished workout ownership mismatch' using errcode='42501';end if;
 if existing.id is not null and existing.revision<>p_base_revision then return jsonb_build_object('status','conflict','document',to_jsonb(existing));end if;
 if existing.id is null and p_base_revision<>0 then return jsonb_build_object('status','conflict','document',null);end if;
 insert into public.training_documents(id,user_id,kind,data,deleted,revision,last_operation_id) values(target_id,owner_id,kind_value,payload,is_deleted,1,p_operation_id)
 on conflict(id) do update set data=excluded.data,deleted=excluded.deleted,revision=public.training_documents.revision+1,last_operation_id=p_operation_id,updated_at=clock_timestamp() returning * into existing;
 response:=jsonb_build_object('status','ok','document',to_jsonb(existing));
 insert into public.training_receipts(operation_id,user_id,document_id,request_hash,result) values(p_operation_id,owner_id,target_id,fingerprint,response);return response;
end $$;
create function public.apply_training_document(p_operation_id uuid,p_base_revision bigint,p_document jsonb) returns jsonb language sql security invoker set search_path='' as $$
 select gtrack_private.apply_training_document(p_operation_id,p_base_revision,p_document)
$$;
create function public.gtrack_api_version() returns integer language sql stable security invoker set search_path='' as $$select 2$$;
revoke all on all functions in schema gtrack_private from public,anon,authenticated;
grant execute on function gtrack_private.apply_workout(uuid,bigint,jsonb),gtrack_private.apply_training_document(uuid,bigint,jsonb) to authenticated;
revoke all on function public.apply_workout(uuid,bigint,jsonb),public.apply_training_document(uuid,bigint,jsonb),public.gtrack_api_version() from public,anon;
grant execute on function public.apply_workout(uuid,bigint,jsonb),public.apply_training_document(uuid,bigint,jsonb),public.gtrack_api_version() to authenticated;
comment on table public.training_documents is 'Owner-scoped template and active-session snapshots. Retain deletion tombstones.';
comment on column public.workouts.details is 'Versioned v2 metadata; {} keeps legacy workouts unchanged.';
commit;
