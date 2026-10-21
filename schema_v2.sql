-- Perfiles personalizables (ejecuta una sola vez en Supabase → SQL Editor)
alter table profiles
  add column if not exists avatar_img text,
  add column if not exists avatar_emoji text,
  add column if not exists avatar_color text,
  add column if not exists bio text,
  add column if not exists vehicle text;
alter table profiles add constraint avatar_size check (avatar_img is null or length(avatar_img) < 60000);
-- Tiempo real de solicitudes de amistad (si te da error de "already member", ya estaba activado)
alter publication supabase_realtime add table friendships;
