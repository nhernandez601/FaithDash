-- ============================================================================================================
-- Faith Dash online leaderboard (Supabase, free plan).
-- Run this whole file ONCE in: Supabase dashboard -> SQL Editor -> New query -> paste -> Run.
-- Running it again is safe (it only adds what is missing and replaces the functions).
--
-- Safety: the tables are locked (row level security on, no policies), so a browser cannot read or change them
-- directly. Browsers can only call the 4 functions at the bottom, and those check every name and score:
--   * names: 3-16 letters/numbers/space _ . -, no bad words, one name per player, not already taken (any case)
--   * a score is only accepted for a run the server saw start, once, by the same player, and only if it is
--     possible in the time that has passed since that run started.
-- To hide a bad score:  update fd_scores set hidden = true where id = ...;
-- To ban a player:      update fd_players set banned = true where name = '...';
-- ============================================================================================================

create extension if not exists pgcrypto;

create table if not exists public.fd_players (
  player_id  uuid primary key,
  name       text not null,
  banned     boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists fd_players_name_key on public.fd_players (lower(name));

create table if not exists public.fd_runs (
  token      uuid primary key default gen_random_uuid(),
  player_id  uuid not null references public.fd_players(player_id) on delete cascade,
  song       text not null check (song in ('drop', 'boss', 'intense')),
  started_at timestamptz not null default now(),
  used       boolean not null default false
);
create index if not exists fd_runs_player_idx on public.fd_runs (player_id, started_at desc);

create table if not exists public.fd_scores (
  id         bigint generated always as identity primary key,
  player_id  uuid not null references public.fd_players(player_id) on delete cascade,
  song       text not null check (song in ('drop', 'boss', 'intense')),
  score      integer not null check (score between 0 and 50000000),
  stage      integer not null check (stage between 0 and 1000),
  seconds    integer not null check (seconds between 0 and 86400),
  hidden     boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists fd_scores_board_idx on public.fd_scores (song, score desc) where not hidden;

alter table public.fd_players enable row level security;
alter table public.fd_runs    enable row level security;
alter table public.fd_scores  enable row level security;
revoke all on public.fd_players, public.fd_runs, public.fd_scores from anon, authenticated;

-- difficulty name for a stage number (0 = Easy, 1 = Medium, 2 = Hard, 3+ = Hard +n)
create or replace function public.fd_reached(p_stage int) returns text language sql immutable as $$
  select case when p_stage <= 0 then 'EASY' when p_stage = 1 then 'MEDIUM' when p_stage = 2 then 'HARD' else 'HARD +' || (p_stage - 2) end
$$;

-- ---------- set / change my gamer name ----------
create or replace function public.fd_set_name(p_player uuid, p_name text) returns text
language plpgsql security definer set search_path = public as $$
declare n text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
        flat text;
begin
  if n !~ '^[A-Za-z0-9 _.\-]{3,16}$' then raise exception 'bad_name'; end if;
  flat := replace(regexp_replace(lower(n), '[^a-z0]', '', 'g'), '0', 'o');
  if flat ~ '(fuck|shit|bitch|cunt|nigg|fag|slut|whore|dick|pussy|rape|nazi|hitler)' then raise exception 'bad_name'; end if;
  if exists (select 1 from fd_players where lower(name) = lower(n) and player_id <> p_player) then raise exception 'name_taken'; end if;
  insert into fd_players (player_id, name) values (p_player, n)
    on conflict (player_id) do update set name = excluded.name, updated_at = now();
  return n;
end $$;

-- ---------- a run starts (returns a one-time token) ----------
create or replace function public.fd_start_run(p_player uuid, p_song text) returns uuid
language plpgsql security definer set search_path = public as $$
declare t uuid;
begin
  if not exists (select 1 from fd_players where player_id = p_player and not banned) then raise exception 'bad_run'; end if;
  if (select count(*) from fd_runs where player_id = p_player and started_at > now() - interval '10 minutes') >= 40 then raise exception 'too_many'; end if;
  insert into fd_runs (player_id, song) values (p_player, p_song) returning token into t;
  return t;
end $$;

-- ---------- a run ends: record the score, return my rank for that song ----------
create or replace function public.fd_submit(p_token uuid, p_player uuid, p_score int, p_stage int, p_seconds int) returns json
language plpgsql security definer set search_path = public as $$
declare r fd_runs; elapsed numeric; best int; my_rank int; total int;
begin
  select * into r from fd_runs where token = p_token for update;
  if not found or r.used or r.player_id <> p_player then raise exception 'bad_run'; end if;
  update fd_runs set used = true where token = p_token;
  elapsed := extract(epoch from now() - r.started_at);
  -- possible in the time that passed? (generous: about 3x the best real rate, plus room for bonuses)
  if p_seconds < 3 or p_seconds > elapsed + 15
     or p_score < 0 or p_score > 2500 * elapsed + 20000
     or p_stage < 0 or p_stage * 150 > elapsed + 30 then raise exception 'implausible'; end if;
  insert into fd_scores (player_id, song, score, stage, seconds) values (p_player, r.song, p_score, p_stage, p_seconds);
  select max(score) into best from fd_scores where player_id = p_player and song = r.song and not hidden;
  with bests as (
    select s.player_id, max(s.score) as score from fd_scores s join fd_players p using (player_id)
    where s.song = r.song and not s.hidden and not p.banned group by s.player_id)
  select count(*) filter (where score > best) + 1, count(*) into my_rank, total from bests;
  return json_build_object('rank', my_rank, 'total', total, 'best', best);
end $$;

-- ---------- the board: each player's best score for a song ----------
create or replace function public.fd_board(p_song text, p_limit int default 50, p_player uuid default null)
returns table (rank bigint, name text, score int, reached text, me boolean)
language sql security definer set search_path = public stable as $$
  with best as (
    select distinct on (s.player_id) s.player_id, p.name, s.score, s.stage, s.created_at
    from fd_scores s join fd_players p using (player_id)
    where s.song = p_song and not s.hidden and not p.banned
    order by s.player_id, s.score desc, s.created_at asc
  ), ranked as (
    select rank() over (order by score desc) as rank, name, score, fd_reached(stage) as reached, player_id = p_player as me, created_at
    from best
  )
  select rank, name, score, reached, me from ranked
  where rank <= least(greatest(p_limit, 1), 100) or me
  order by rank, created_at
$$;

grant execute on function public.fd_set_name(uuid, text), public.fd_start_run(uuid, text),
  public.fd_submit(uuid, uuid, int, int, int), public.fd_board(text, int, uuid) to anon;
