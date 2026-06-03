// Generates 10 daily text-input quiz questions via Gemini and inserts them into Supabase.
// Reads <student>-difficulty-config.json (produced by adaptive-coach.js) to tailor per-topic difficulty.
// Run automatically by GitHub Actions at 3 AM UTC, or manually: STUDENT=gia node scripts/generate-questions.js

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const STUDENT = process.env.STUDENT || 'gia';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const TOPICS_BY_STUDENT = {
  gia: [
    { topic: 'Proportional Relationships',      grade: '7th' },
    { topic: 'Percentages & Rates',             grade: '7th' },
    { topic: 'Rational Numbers',                grade: '7th' },
    { topic: 'Expressions & Equations',         grade: '7th' },
    { topic: 'Statistics & Probability',        grade: '7th' },
    { topic: 'Linear Functions',                grade: '8th' },
    { topic: 'Systems of Equations',            grade: '8th' },
    { topic: 'Geometry',                        grade: '8th' },
    { topic: 'The Pythagorean Theorem',         grade: '8th' },
    { topic: 'Exponents & Scientific Notation', grade: '8th' },
  ],
  tara: [
    { topic: 'Multiplication & Division',       grade: '4th' },
    { topic: 'Fractions — Understanding',       grade: '4th' },
    { topic: 'Decimals — Understanding',        grade: '4th' },
    { topic: 'Place Value',                     grade: '4th' },
    { topic: 'Factors & Multiples',             grade: '4th' },
    { topic: 'Area & Perimeter',                grade: '4th' },
    { topic: 'Fraction Operations',             grade: '5th' },
    { topic: 'Decimal Operations',              grade: '5th' },
    { topic: 'Volume',                          grade: '5th' },
    { topic: 'Coordinate Plane',                grade: '5th' },
  ],
};

const TOPICS = TOPICS_BY_STUDENT[STUDENT] || TOPICS_BY_STUDENT.gia;

const STANDARD_INSTRUCTION = 'Generate a standard grade-appropriate problem with moderate complexity.';

function loadDifficultyConfig() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, '..', `${STUDENT}-difficulty-config.json`), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function main() {
  const today = new Date().toISOString().split('T')[0];

  const { data: existing } = await supabase
    .from('questions')
    .select('id')
    .eq('session_date', today)
    .eq('student', STUDENT)
    .limit(1);

  if (existing && existing.length > 0) {
    console.log(`Questions already exist for ${STUDENT} on ${today} — skipping.`);
    return;
  }

  const diffConfig = loadDifficultyConfig();
  if (diffConfig) {
    console.log(`Coach assessment (${diffConfig.generatedAt}): ${diffConfig.coachSummary}`);
  } else {
    console.log('No difficulty config found — using standard difficulty for all topics.');
  }

  console.log(`Generating questions for ${STUDENT} on ${today}...`);

  const topicList = TOPICS.map((t, i) => {
    const d = diffConfig?.topicDifficulties?.[t.topic];
    const tag = d ? `[${d.levelName.toUpperCase()}]` : '[STANDARD]';
    const instruction = d?.promptInstruction ?? STANDARD_INSTRUCTION;
    return `${i + 1}. ${t.topic} (${t.grade} grade) — ${tag}: ${instruction}`;
  }).join('\n');

  const grades = [...new Set(TOPICS.map(t => t.grade))].join(' and ');

  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: { responseMimeType: 'application/json' },
  });

  const result = await model.generateContent(`Create 10 short-answer math questions for a ${grades} grade student following Khan Academy curriculum. One question per topic in the exact order listed. Each topic has a difficulty tag and instruction that you MUST follow precisely.

Topics (with difficulty instructions):
${topicList}

Difficulty guide:
- [FOUNDATIONAL]: Basic single-step problems, simple numbers, rebuild confidence
- [STANDARD]: Grade-appropriate, moderate complexity
- [CHALLENGING]: Multi-step reasoning, harder numbers, less obvious approach
- [ADVANCED]: Complex multi-step problems, pushes well beyond grade level

For each question return a JSON object with these fields:
- "topic": exact topic string from the list
- "grade": grade level string (e.g. "4th", "5th", "7th", "8th")
- "question_text": the question (follow the difficulty instruction for that topic exactly)
- "correct_answer": the single canonical answer a student should type (e.g. "30", "5/36", "15 ft"). Keep it as simple as possible — just the number or value, no working.
- "answer_hint": short format guide shown under the input (e.g. "Enter just the number", "Simplified fraction", "Include units"). Omit if the format is obvious.
- "explanation": 1–2 sentence step-by-step solution

Constraints:
- Questions must be solvable without a calculator
- correct_answer must be a simple string a student can type exactly
- Vary question types: equations, word problems, geometry, probability

Return a JSON object with a single key "questions" containing an array of 10 objects.`);

  const raw = result.response.text().trim();
  const parsed = JSON.parse(raw);
  const questions = parsed.questions || parsed;
  if (!Array.isArray(questions)) {
    console.error('Raw response:', raw);
    throw new Error('Gemini did not return a questions array.');
  }
  if (questions.length !== 10) {
    throw new Error(`Expected 10 questions, got ${questions.length}`);
  }

  const rows = questions.map(q => ({ ...q, session_date: today, student: STUDENT }));

  const { error } = await supabase.from('questions').insert(rows);
  if (error) throw error;

  console.log(`✓ Saved ${rows.length} questions for ${STUDENT} on ${today}`);
  rows.forEach((q, i) =>
    console.log(`  ${i + 1}. [${q.grade}] ${q.topic} — answer: ${q.correct_answer}`)
  );
}

main().catch(err => {
  console.error('Failed:', err.message);
  process.exit(1);
});
