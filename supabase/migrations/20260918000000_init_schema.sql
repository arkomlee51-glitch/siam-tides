-- เฟส 4: บัญชีผู้ใช้ (Supabase Auth) + ข้อมูลถาวร (games, game_players, game_snapshots, game_actions)
-- ดู docs/ARCHITECTURE.md#data-model และ docs/adr/0004-supabase-jwt-auth-and-event-sourcing.md
--
-- หลักการเขียน: ทุกตารางเปิด RLS ผู้เล่นอ่านได้เฉพาะแถวของเกมที่ตัวเองอยู่
-- ไม่มี policy สำหรับ insert/update/delete เลย เพราะฝั่งเขียนทั้งหมดผ่าน service role
-- (Supabase service_role bypass RLS โดยธรรมชาติ) — client ฝั่ง anon/authenticated เขียนไม่ได้เด็ดขาด

-- ---------- profiles ----------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

comment on table public.profiles is 'ข้อมูลเสริมต่อผู้ใช้ 1 แถวต่อ 1 auth.users — สร้างอัตโนมัติด้วย trigger ด้านล่าง';

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, nullif(trim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- games ----------

create table public.games (
  id uuid primary key,
  status text not null default 'active' check (status in ('lobby', 'active', 'finished')),
  seed bigint,
  engine_version text not null,
  max_turn int,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

comment on table public.games is 'เมตาดาต้าเกม 1 แถวต่อ 1 เกม — state จริงอยู่ใน game_snapshots + game_actions';

create index games_created_by_idx on public.games (created_by);

-- ---------- game_players ----------

create table public.game_players (
  game_id uuid not null references public.games (id) on delete cascade,
  -- null = ที่นั่ง AI
  user_id uuid references auth.users (id),
  faction_id text not null,
  seat text not null,
  name text not null,
  ending text,
  joined_at timestamptz not null default now(),
  primary key (game_id, faction_id)
);

comment on table public.game_players is 'ที่นั่งของแต่ละเกม ผูก faction_id (p1..p4) กับ user_id (null = AI)';

create index game_players_game_idx on public.game_players (game_id);
-- ผู้ใช้คนหนึ่งนั่งได้ที่เดียวต่อเกม (ไม่บังคับกับที่นั่ง AI ที่ user_id เป็น null)
create unique index game_players_user_unique on public.game_players (game_id, user_id) where user_id is not null;

-- ---------- game_snapshots ----------

create table public.game_snapshots (
  game_id uuid not null references public.games (id) on delete cascade,
  turn int not null,
  version int not null,
  state jsonb not null,
  created_at timestamptz not null default now(),
  primary key (game_id, turn)
);

comment on table public.game_snapshots is 'snapshot ของ GameState ต้นฤดู — โหลดเกม = snapshot ล่าสุด + replay game_actions ที่ seq สูงกว่า version ของ snapshot นั้น';

-- ---------- game_actions ----------

create table public.game_actions (
  id bigint generated always as identity primary key,
  game_id uuid not null references public.games (id) on delete cascade,
  seq int not null,
  user_id uuid references auth.users (id),
  faction_id text not null,
  turn int not null,
  action jsonb not null,
  created_at timestamptz not null default now(),
  unique (game_id, seq)
);

comment on table public.game_actions is 'event log แบบ append-only — ทุกคำสั่งที่ applyAction ยอมรับแล้วจริง ๆ เรียงด้วย seq ต่อเกม';

create index game_actions_game_idx on public.game_actions (game_id, seq);

-- ---------- RLS ----------

alter table public.profiles enable row level security;
alter table public.games enable row level security;
alter table public.game_players enable row level security;
alter table public.game_snapshots enable row level security;
alter table public.game_actions enable row level security;

create policy profiles_select_own on public.profiles
  for select using (auth.uid() = id);

create policy profiles_update_own on public.profiles
  for update using (auth.uid() = id);

-- security definer เพื่อไม่ให้ policy ของ game_players เรียกตัวเองซ้ำ (infinite recursion)
create function public.is_game_participant(target_game_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.game_players gp
    where gp.game_id = target_game_id
      and gp.user_id = auth.uid()
  );
$$;

create policy games_select_participant on public.games
  for select using (created_by = auth.uid() or public.is_game_participant(id));

create policy game_players_select_participant on public.game_players
  for select using (user_id = auth.uid() or public.is_game_participant(game_id));

create policy game_snapshots_select_participant on public.game_snapshots
  for select using (public.is_game_participant(game_id));

create policy game_actions_select_participant on public.game_actions
  for select using (public.is_game_participant(game_id));
