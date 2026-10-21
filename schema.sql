-- Ejecuta todo esto en Supabase → SQL Editor
create table profiles (
  id uuid primary key references auth.users on delete cascade,
  username text not null,
  friend_code text unique not null default substr(md5(random()::text || clock_timestamp()::text), 1, 6),
  created_at timestamptz default now()
);
create function handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles(id, username)
  values (new.id, coalesce(nullif(new.raw_user_meta_data->>'username',''), split_part(new.email,'@',1)));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();

create table saved_places (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null, addr text, lat double precision not null, lon double precision not null,
  created_at timestamptz default now()
);
create table saved_routes (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null, author text, dest_name text, dest_lat double precision, dest_lon double precision,
  mode text, coords jsonb not null, distance real, duration real, turns int,
  is_public boolean not null default false, created_at timestamptz default now()
);
create table friendships (
  id bigint generated always as identity primary key,
  requester uuid not null default auth.uid() references auth.users on delete cascade,
  addressee uuid not null references auth.users on delete cascade,
  status text not null default 'pending',
  unique (requester, addressee), check (requester <> addressee)
);
create table live_locations (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  lat double precision not null, lon double precision not null, updated_at timestamptz default now()
);

alter table profiles enable row level security;
alter table saved_places enable row level security;
alter table saved_routes enable row level security;
alter table friendships enable row level security;
alter table live_locations enable row level security;

create policy "perfiles visibles para usuarios" on profiles for select to authenticated using (true);
create policy "editar mi perfil" on profiles for update to authenticated using (id = auth.uid());
create policy "mis lugares" on saved_places for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "ver rutas propias o públicas" on saved_routes for select to authenticated using (user_id = auth.uid() or is_public);
create policy "crear mis rutas" on saved_routes for insert to authenticated with check (user_id = auth.uid());
create policy "editar mis rutas" on saved_routes for update to authenticated using (user_id = auth.uid());
create policy "borrar mis rutas" on saved_routes for delete to authenticated using (user_id = auth.uid());
create policy "ver mis amistades" on friendships for select to authenticated using (auth.uid() in (requester, addressee));
create policy "pedir amistad" on friendships for insert to authenticated with check (requester = auth.uid());
create policy "aceptar amistad" on friendships for update to authenticated using (addressee = auth.uid());
create policy "borrar amistad" on friendships for delete to authenticated using (auth.uid() in (requester, addressee));
create policy "ver mi posición y la de amigos" on live_locations for select to authenticated using (
  user_id = auth.uid() or exists (select 1 from friendships f where f.status = 'accepted'
    and ((f.requester = auth.uid() and f.addressee = user_id) or (f.addressee = auth.uid() and f.requester = user_id))));
create policy "publicar mi posición" on live_locations for insert to authenticated with check (user_id = auth.uid());
create policy "actualizar mi posición" on live_locations for update to authenticated using (user_id = auth.uid());
create policy "borrar mi posición" on live_locations for delete to authenticated using (user_id = auth.uid());

alter publication supabase_realtime add table live_locations;
