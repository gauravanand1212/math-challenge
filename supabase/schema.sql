-- Drop and recreate the questions table for text-input quiz format.
-- Run this in your Supabase SQL editor.

drop table if exists questions;

create table questions (
  id               bigint generated always as identity primary key,
  session_date     date        not null default current_date,
  topic            text        not null,
  grade            text        not null,
  question_text    text        not null,
  correct_answer   text        not null,   -- canonical answer string to match
  answer_hint      text,                   -- optional format hint shown to student
  explanation      text        not null,
  created_at       timestamptz not null default now()
);

alter table questions enable row level security;

create policy "questions_public_read" on questions
  for select using (true);

create policy "questions_service_insert" on questions
  for insert with check (true);
