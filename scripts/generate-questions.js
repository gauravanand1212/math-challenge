// Generates 10 daily text-input quiz questions via Gemini and inserts them into Supabase.
// Run automatically by GitHub Actions at 3 AM UTC, or manually: node scripts/generate-questions.js

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { createClient } = require('@supabase/supabase-js');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const TOPICS = [
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
];

async function main() {
  const today = new Date().toISOString().split('T')[0];

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
    model: 'gemini-2.5-flash',
    generationConfig: { responseMimeType: 'application/json' },
  });

  const result = await model.generateContent(`Create 10 short-answer math questions for 7th and 8th grade students following Khan Academy curriculum. One question per topic in the exact order listed.

Topics:
${topicList}

For each question return a JSON object with these fields:
- "topic": exact topic string from the list
- "grade": "7th" or "8th"
- "question_text": the question (use concrete numbers, grade-appropriate difficulty)
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

  const rows = questions.map(q => ({ ...q, session_date: today }));

  const { error } = await supabase.from('questions').insert(rows);
  if (error) throw error;

  console.log(`✓ Saved ${rows.length} questions for ${today}`);
  rows.forEach((q, i) =>
    console.log(`  ${i + 1}. [${q.grade}] ${q.topic} — answer: ${q.correct_answer}`)
  );
}

main().catch(err => {
  console.error('Failed:', err.message);
  process.exit(1);
});
