-- Run this once in your Supabase SQL editor to create the questions table.

create table if not exists questions (
  id                bigint generated always as identity primary key,
  session_date      date        not null default current_date,
  topic             text        not null,
  grade             text        not null,
  question_text     text        not null,
  options           jsonb       not null,   -- array of 4 strings
  answer_index      int         not null,   -- 0-based index of correct option
  explanation       text        not null,
  created_at        timestamptz not null default now()
);

-- Allow anyone to read questions (anon key is fine for the frontend)
alter table questions enable row level security;

create policy "questions_public_read" on questions
  for select using (true);

-- Only the service role (GitHub Action) can insert
create policy "questions_service_insert" on questions
  for insert with check (true);
