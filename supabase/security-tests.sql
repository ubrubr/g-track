-- Run after the migration. Uses disposable test users; everything rolls back.
-- Exercises RPC atomicity, idempotency, revisions, deletion and two-user isolation.
begin;
insert into auth.users(id,email) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','form-test-a@example.invalid'),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','form-test-b@example.invalid');
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',true);
do $$
declare payload jsonb := '{"id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1","date":"2026-01-01","deleted":false,"exercises":[{"position":1,"exerciseId":"squats","name":"Squats","variation":"Barbell","notes":"","repMode":"per-leg","sets":[{"reps":10,"weight":60}]}]}'; first_result jsonb; repeated jsonb; result jsonb;
begin
  first_result := public.apply_workout('cccccccc-cccc-4ccc-8ccc-ccccccccccc1',0,payload);
  repeated := public.apply_workout('cccccccc-cccc-4ccc-8ccc-ccccccccccc1',0,payload);
  if first_result <> repeated or first_result->'workout'->>'revision' <> '1' then raise exception 'Idempotency failed'; end if;
  result := public.apply_workout('cccccccc-cccc-4ccc-8ccc-ccccccccccc2',0,payload);
  if result->>'status' <> 'conflict' then raise exception 'Revision conflict not detected'; end if;
  result := public.apply_workout('cccccccc-cccc-4ccc-8ccc-ccccccccccc3',1,payload || '{"deleted":true}');
  if result->'workout'->>'deleted' <> 'true' then raise exception 'Deletion not retained'; end if;
  result := public.apply_workout('cccccccc-cccc-4ccc-8ccc-ccccccccccc4',1,payload);
  if result->>'status' <> 'conflict' or result->'workout'->>'deleted' <> 'true' then raise exception 'Stale edit resurrected deletion'; end if;
end $$;
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',true);
do $$
begin
  if exists(select 1 from public.workouts where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1') then raise exception 'Cross-user read allowed'; end if;
  if exists(select 1 from public.sync_receipts where operation_id = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1') then raise exception 'Cross-user receipt read allowed'; end if;
  begin
    perform public.apply_workout('dddddddd-dddd-4ddd-8ddd-ddddddddddd1',2,'{"id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1","date":"2026-01-01","deleted":true,"exercises":[]}');
    raise exception 'Cross-user write allowed';
  exception when insufficient_privilege then null;
  end;
  if has_table_privilege('authenticated','public.workouts','UPDATE') then raise exception 'Direct write bypass allowed'; end if;
  if has_function_privilege('anon','public.apply_workout(uuid,bigint,jsonb)','EXECUTE') then raise exception 'Anonymous RPC allowed'; end if;
end $$;
rollback;
