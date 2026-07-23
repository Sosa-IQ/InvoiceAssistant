-- Minimal stand-ins for the Supabase-managed objects that
-- setup_invoice_assistant_core.sql depends on.
--
-- Supabase provisions the auth/storage schemas and the anon/authenticated/
-- service_role roles for every project. A plain PostgreSQL instance does not,
-- so CI and local tenant-isolation tests create just enough of them to apply
-- the real schema file verbatim. This file is for test databases only and is
-- never applied to a Supabase project.

create schema if not exists extensions;
create schema if not exists auth;
create schema if not exists storage;

-- Supabase ships `extensions` on the database search_path, which is what lets
-- the core schema reference unqualified operator classes such as
-- `vector_cosine_ops`. Reproduce that here or the hnsw index fails to build.
do $$
begin
  execute format(
    'alter database %I set search_path to "$user", public, extensions',
    current_database()
  );
end $$;
set search_path to "$user", public, extensions;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

grant usage on schema public, extensions, auth, storage to anon, authenticated, service_role;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique
);

-- Supabase derives auth.uid() from the verified JWT that PostgREST puts into
-- the `request.jwt.claims` GUC. The stub reads the same GUC so tests can
-- impersonate a user with `set local request.jwt.claims = '{"sub": "..."}'`.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ),
    ''
  )::uuid
$$;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id) on delete cascade,
  name text not null,
  owner uuid,
  created_at timestamptz not null default now()
);

alter table storage.objects enable row level security;

grant select, insert, update, delete on storage.objects to authenticated;
grant select on storage.buckets to authenticated;

-- Splits an object key into path segments, matching Supabase's helper.
create or replace function storage.foldername(name text)
returns text[]
language sql
immutable
as $$
  select string_to_array(name, '/')
$$;
