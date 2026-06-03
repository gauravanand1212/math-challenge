-- Full schema for a fresh setup.
-- Run this in your Supabase SQL editor for a new project.
-- For an existing database, see the MIGRATION section at the bottom.

drop table if exists quiz_results;
drop table if exists questions;

create table questions (
  id               bigint generated always as identity primary key,
  session_date     date        not null default current_date,
  student          text        not null default 'gia',
  topic            text        not null,
  grade            text        not null,
  question_text    text        not null,
  correct_answer   text        not null,
  answer_hint      text,
  explanation      text        not null,
  created_at       timestamptz not null default now()
);

alter table questions enable row level security;

create policy "questions_public_read" on questions
  for select using (true);

create policy "questions_service_insert" on questions
  for insert with check (true);

create table quiz_results (
  id                  bigint generated always as identity primary key,
  session_id          text        not null,
  student             text        not null default 'gia',
  topic               text        not null,
  correct_answers     int         not null,
  total_questions     int         not null,
  percentage          int         not null,
  total_score         int         not null,
  total_quiz_questions int        not null,
  created_at          timestamptz not null default now()
);

alter table quiz_results enable row level security;

create policy "quiz_results_public_read" on quiz_results
  for select using (true);

create policy "quiz_results_public_insert" on quiz_results
  for insert with check (true);

-- ─────────────────────────────────────────────────────────────────
-- MIGRATION — run these if you already have an existing database
-- (existing rows will default to student = 'gia')
-- ─────────────────────────────────────────────────────────────────
-- alter table questions   add column if not exists student text not null default 'gia';
-- alter table quiz_results add column if not exists student text not null default 'gia';
