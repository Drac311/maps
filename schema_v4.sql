-- FunRide · Grupos y Jam. Se puede ejecutar varias veces. Ejecútalo DESPUÉS de schema_all.sql

create table if not exists groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text unique not null default upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6)),
  owner uuid not null default auth.uid() references auth.users on delete cascade,
  created_at timestamptz default now()
);
create table if not exists group_members (
  group_id uuid not null references groups(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  joined_at timestamptz default now(),
  primary key (group_id, user_id)
);
create table if not exists jams (
  group_id uuid primary key references groups(id) on delete cascade,
  queue jsonb not null default '[]',
  current jsonb,
  playing boolean not null default false,
  started_at timestamptz,
  paused_pos int not null default 0,
  version int not null default 0,
  updated_at timestamptz default now()
);

-- Funciones auxiliares (security definer evita recursión en las reglas de seguridad)
create or replace function my_groups() returns setof uuid language sql security definer stable set search_path = public as $$
  select group_id from group_members where user_id = auth.uid()
$$;
create or replace function is_group_mate(uid uuid) returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from group_members a join group_members b on a.group_id = b.group_id where a.user_id = auth.uid() and b.user_id = uid)
$$;
create or replace function server_now() returns timestamptz language sql stable as $$ select now() $$;

alter table groups enable row level security;
alter table group_members enable row level security;
alter table jams enable row level security;

drop policy if exists "ver mis grupos" on groups;
create policy "ver mis grupos" on groups for select to authenticated using (id in (select my_groups()));
drop policy if exists "ver miembros de mis grupos" on group_members;
create policy "ver miembros de mis grupos" on group_members for select to authenticated using (group_id in (select my_groups()));
drop policy if exists "salir de un grupo" on group_members;
create policy "salir de un grupo" on group_members for delete to authenticated using (user_id = auth.uid());
drop policy if exists "ver jam de mis grupos" on jams;
create policy "ver jam de mis grupos" on jams for select to authenticated using (group_id in (select my_groups()));

-- Ver la posición de amigos aceptados y de compañeros de grupo
drop policy if exists "ver mi posición y la de amigos" on live_locations;
drop policy if exists "ver mi posición, amigos y grupo" on live_locations;
create policy "ver mi posición, amigos y grupo" on live_locations for select to authenticated using (
  user_id = auth.uid() or is_group_mate(user_id) or exists (select 1 from friendships f where f.status = 'accepted'
    and ((f.requester = auth.uid() and f.addressee = user_id) or (f.addressee = auth.uid() and f.requester = user_id))));

-- Crear y unirse a grupos
create or replace function create_group(p_name text) returns groups language plpgsql security definer set search_path = public as $$
declare g groups;
begin
  if auth.uid() is null then raise exception 'Inicia sesión'; end if;
  insert into groups(name, owner) values (left(trim(p_name), 40), auth.uid()) returning * into g;
  insert into group_members(group_id, user_id) values (g.id, auth.uid());
  insert into jams(group_id) values (g.id);
  return g;
end $$;
create or replace function join_group(p_code text) returns groups language plpgsql security definer set search_path = public as $$
declare g groups;
begin
  if auth.uid() is null then raise exception 'Inicia sesión'; end if;
  select * into g from groups where code = upper(trim(p_code));
  if g.id is null then raise exception 'Código de grupo no válido'; end if;
  insert into group_members(group_id, user_id) values (g.id, auth.uid()) on conflict do nothing;
  insert into jams(group_id) values (g.id) on conflict do nothing;
  return g;
end $$;

-- Jam: todas las operaciones pasan por aquí para usar el reloj del servidor y evitar carreras
create or replace function jam_add(p_group uuid, p_track jsonb) returns jams language plpgsql security definer set search_path = public as $$
declare j jams;
begin
  if not exists (select 1 from group_members where group_id = p_group and user_id = auth.uid()) then raise exception 'No perteneces a este grupo'; end if;
  insert into jams(group_id) values (p_group) on conflict do nothing;
  select * into j from jams where group_id = p_group for update;
  if j.current is null then
    update jams set current = p_track, playing = true, started_at = now(), paused_pos = 0, version = version + 1, updated_at = now() where group_id = p_group returning * into j;
  else
    update jams set queue = queue || jsonb_build_array(p_track), version = version + 1, updated_at = now() where group_id = p_group returning * into j;
  end if;
  return j;
end $$;
create or replace function jam_next(p_group uuid, p_expect text) returns jams language plpgsql security definer set search_path = public as $$
declare j jams;
begin
  if not exists (select 1 from group_members where group_id = p_group and user_id = auth.uid()) then raise exception 'No perteneces a este grupo'; end if;
  select * into j from jams where group_id = p_group for update;
  if (j.current->>'uri') is distinct from p_expect then return j; end if;   -- otro miembro ya avanzó
  if jsonb_array_length(j.queue) > 0 then
    update jams set current = queue->0, queue = queue - 0, playing = true, started_at = now(), paused_pos = 0, version = version + 1, updated_at = now() where group_id = p_group returning * into j;
  else
    update jams set current = null, playing = false, started_at = null, paused_pos = 0, version = version + 1, updated_at = now() where group_id = p_group returning * into j;
  end if;
  return j;
end $$;
create or replace function jam_toggle(p_group uuid, p_play boolean) returns jams language plpgsql security definer set search_path = public as $$
declare j jams;
begin
  if not exists (select 1 from group_members where group_id = p_group and user_id = auth.uid()) then raise exception 'No perteneces a este grupo'; end if;
  select * into j from jams where group_id = p_group for update;
  if j.current is null then return j; end if;
  if p_play and not j.playing then
    update jams set playing = true, started_at = now() - (paused_pos || ' milliseconds')::interval, version = version + 1, updated_at = now() where group_id = p_group returning * into j;
  elsif not p_play and j.playing then
    update jams set playing = false, paused_pos = (extract(epoch from (now() - started_at)) * 1000)::int, version = version + 1, updated_at = now() where group_id = p_group returning * into j;
  end if;
  return j;
end $$;

grant select on groups, group_members, jams to authenticated;
grant delete on group_members to authenticated;
grant execute on function my_groups(), is_group_mate(uuid), server_now(), create_group(text), join_group(text), jam_add(uuid, jsonb), jam_next(uuid, text), jam_toggle(uuid, boolean) to authenticated;

do $$ begin alter publication supabase_realtime add table jams; exception when duplicate_object then null; end $$;
notify pgrst, 'reload schema';
