-- Scopix V1.6: run this ONCE in Supabase SQL Editor.
-- Client accesses only the public anon/publishable key. Do not expose service_role keys.
create table if not exists public.scopix_study_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  vocabulary jsonb not null default '[]'::jsonb,
  annotations jsonb not null default '[]'::jsonb,
  revision bigint not null default 1 check (revision >= 1),
  updated_at timestamptz not null default now(),
  constraint scopix_vocab_array check (jsonb_typeof(vocabulary) = 'array'),
  constraint scopix_notes_array check (jsonb_typeof(annotations) = 'array'),
  constraint scopix_vocab_limit check (jsonb_array_length(vocabulary) <= 1500),
  constraint scopix_notes_limit check (jsonb_array_length(annotations) <= 500)
);
alter table public.scopix_study_state enable row level security;
revoke all on public.scopix_study_state from anon;
grant select, insert, update on public.scopix_study_state to authenticated;

drop policy if exists "Scopix read own study state" on public.scopix_study_state;
create policy "Scopix read own study state"
on public.scopix_study_state for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Scopix create own study state" on public.scopix_study_state;
create policy "Scopix create own study state"
on public.scopix_study_state for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Scopix update own study state" on public.scopix_study_state;
create policy "Scopix update own study state"
on public.scopix_study_state for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

-- Atomically compare revision and write. A second device will be told to resolve conflicts.
create or replace function public.scopix_save_study_state(
  p_expected_revision bigint,
  p_vocabulary jsonb,
  p_annotations jsonb
) returns bigint
language plpgsql security invoker set search_path = ''
as $$
declare v_user uuid := (select auth.uid());
declare v_revision bigint;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if jsonb_typeof(p_vocabulary) <> 'array'
      or jsonb_typeof(p_annotations) <> 'array'
      or jsonb_array_length(p_vocabulary) > 1500
      or jsonb_array_length(p_annotations) > 500 then
    raise exception 'Invalid study data';
  end if;
  if p_expected_revision = 0 then
    insert into public.scopix_study_state(user_id,vocabulary,annotations,revision,updated_at)
      values (v_user,p_vocabulary,p_annotations,1,now())
      on conflict(user_id) do nothing
      returning revision into v_revision;
  elsif p_expected_revision > 0 then
    update public.scopix_study_state
      set vocabulary=p_vocabulary, annotations=p_annotations,
          revision=revision+1, updated_at=now()
      where user_id=v_user and revision=p_expected_revision
      returning revision into v_revision;
  end if;
  return coalesce(v_revision,0);
end $$;
revoke all on function public.scopix_save_study_state(bigint,jsonb,jsonb) from public;
revoke all on function public.scopix_save_study_state(bigint,jsonb,jsonb) from anon;
grant execute on function public.scopix_save_study_state(bigint,jsonb,jsonb) to authenticated;
