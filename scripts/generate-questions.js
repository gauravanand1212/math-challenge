// Generates 15 daily text-input quiz questions via Gemini and inserts them into Supabase.
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
    { topic: 'Inequalities',                    grade: '7th' },
    { topic: 'Angles & Triangles',              grade: '7th' },
    { topic: 'Linear Functions',                grade: '8th' },
    { topic: 'Systems of Equations',            grade: '8th' },
    { topic: 'Geometry',                        grade: '8th' },
    { topic: 'The Pythagorean Theorem',         grade: '8th' },
    { topic: 'Exponents & Scientific Notation', grade: '8th' },
    { topic: 'Surface Area & Volume',           grade: '8th' },
    { topic: 'Data & Scatter Plots',            grade: '8th' },
    { topic: 'Transformations',                 grade: '8th' },
  ],
  tara: [
    { topic: 'Multiplication & Division',       grade: '4th' },
    { topic: 'Fractions — Understanding',       grade: '4th' },
    { topic: 'Decimals — Understanding',        grade: '4th' },
    { topic: 'Place Value',                     grade: '4th' },
    { topic: 'Factors & Multiples',             grade: '4th' },
    { topic: 'Area & Perimeter',                grade: '4th' },
    { topic: 'Measurement & Conversion',        grade: '4th' },
    { topic: 'Angles & Geometry',               grade: '4th' },
    { topic: 'Fraction Operations',             grade: '5th' },
    { topic: 'Decimal Operations',              grade: '5th' },
    { topic: 'Volume',                          grade: '5th' },
    { topic: 'Coordinate Plane',                grade: '5th' },
    { topic: 'Mixed Numbers',                   grade: '5th' },
    { topic: 'Number Patterns',                 grade: '5th' },
    { topic: 'Data & Graphs',                   grade: '5th' },
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

  const result = await model.generateContent(`Create 15 short-answer math questions for a ${grades} grade student following Khan Academy curriculum. One question per topic in the exact order listed. Each topic has a difficulty tag and instruction that you MUST follow precisely.\n\nTopics (with difficulty instructions):\n${topicList}\n\nDifficulty guide:\n- [FOUNDATIONAL]: Basic single-step problems, simple numbers, rebuild confidence\n- [STANDARD]: Grade-appropriate, moderate complexity\n- [CHALLENGING]: Multi-step reasoning, harder numbers, less obvious approach\n- [ADVANCED]: Complex multi-step problems, pushes well beyond grade level\n\nFor each question return a JSON object with these fields:\n- "topic": exact topic string from the list\n- "grade": grade level string (e.g. "4th", "5th", "7th", "8th")\n- "question_text": the question (follow the difficulty instruction for that topic exactly)\n- "correct_answer": the single canonical answer a student should type (e.g. "30", "5/36", "15 ft"). Keep it as simple as possible — just the number or value, no working.\n- "answer_hint": short format guide shown under the input (e.g. "Enter just the number", "Simplified fraction", "Include units"). Omit if the format is obvious.\n- "explanation": 1–2 sentence step-by-step solution\n\nConstraints:\n- Questions must be solvable without a calculator\n- correct_answer must be a simple string a student can type exactly\n- Vary question types: equations, word problems, geometry, probability\n\nReturn a JSON object with a single key "questions" containing an array of 15 objects.`);

  const raw = result.response.text().trim();
  const parsed = JSON.parse(raw);
  const questions = parsed.questions || parsed;
  if (!Array.isArray(questions)) {
    console.error('Raw response:', raw);
    throw new Error('Gemini did not return a questions array.');
  }
  if (questions.length !== 15) {
    throw new Error(`Expected 15 questions, got ${questions.length}`);
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
