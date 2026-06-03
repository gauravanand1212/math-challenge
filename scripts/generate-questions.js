// Generates 10 daily quiz questions via Gemini and inserts them into Supabase.
// Run automatically by GitHub Actions at 3 AM UTC, or manually: node scripts/generate-questions.js

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { createClient } = require('@supabase/supabase-js');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// One question per topic, 5 from each grade — aligned to Khan Academy units
const TOPICS = [
  { topic: 'Proportional Relationships',     grade: '7th' },
  { topic: 'Percentages & Rates',            grade: '7th' },
  { topic: 'Rational Numbers',               grade: '7th' },
  { topic: 'Expressions & Equations',        grade: '7th' },
  { topic: 'Statistics & Probability',       grade: '7th' },
  { topic: 'Linear Functions',               grade: '8th' },
  { topic: 'Systems of Equations',           grade: '8th' },
  { topic: 'Geometry',                       grade: '8th' },
  { topic: 'The Pythagorean Theorem',        grade: '8th' },
  { topic: 'Exponents & Scientific Notation',grade: '8th' },
];

async function main() {
  const today = new Date().toISOString().split('T')[0];

  // Idempotent: skip if questions already exist for today
  const { data: existing } = await supabase
    .from('questions')
    .select('id')
    .eq('session_date', today)
    .limit(1);

  if (existing && existing.length > 0) {
    console.log(`Questions already exist for ${today} — skipping.`);
    return;
  }

  console.log(`Generating questions for ${today}...`);

  const topicList = TOPICS.map((t, i) =>
    `${i + 1}. ${t.topic} (${t.grade} grade)`
  ).join('\n');

  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    generationConfig: { responseMimeType: 'application/json' },
  });

  const result = await model.generateContent(`Create 10 multiple-choice math questions for 7th and 8th grade students following Khan Academy curriculum. One question per topic, in the exact order listed.

Topics:
${topicList}

For each question return a JSON object with exactly these fields:
- "topic": the exact topic string from the list above
- "grade": "7th" or "8th"
- "question_text": the question (concrete numbers, grade-appropriate difficulty)
- "options": array of exactly 4 answer strings
- "answer_index": 0-based integer (0–3) of the correct answer
- "explanation": 1–2 sentence step-by-step solution

Constraints:
- Wrong choices must represent realistic student mistakes (not obviously absurd)
- Questions must be solvable without a calculator
- Vary question formats (word problems, equations, diagrams described in text)

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

  const rows = questions.map(q => ({ ...q, session_date: today }));

  const { error } = await supabase.from('questions').insert(rows);
  if (error) throw error;

  console.log(`✓ Saved ${rows.length} questions for ${today}`);
  rows.forEach((q, i) => console.log(`  ${i + 1}. [${q.grade}] ${q.topic} — ${q.question_text.slice(0, 60)}...`));
}

main().catch(err => {
  console.error('Failed:', err.message);
  process.exit(1);
});
