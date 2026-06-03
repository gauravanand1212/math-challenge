// Analyzes a student's recent quiz performance and writes a difficulty config for question generation.
// Run before generate-questions.js: STUDENT=gia node scripts/adaptive-coach.js

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const STUDENT = process.env.STUDENT || 'gia';

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

const DIFFICULTY = {
  1: {
    name: 'foundational',
    prompt: 'Generate a basic single-step problem using simple whole numbers. The student is struggling and needs to rebuild confidence with this topic.',
  },
  2: {
    name: 'standard',
    prompt: 'Generate a standard grade-appropriate problem with moderate complexity.',
  },
  3: {
    name: 'challenging',
    prompt: 'Generate a multi-step problem that requires deeper reasoning. The student is doing well and is ready for more challenge.',
  },
  4: {
    name: 'advanced',
    prompt: 'Generate an advanced problem pushing well beyond grade-level expectations. The student has mastered the basics and needs a real challenge.',
  },
};

function levelFromScore(avg) {
  if (avg >= 85) return 4;
  if (avg >= 70) return 3;
  if (avg >= 50) return 2;
  return 1;
}

function weightedAverage(sessions) {
  const n = sessions.length;
  let weightedSum = 0;
  let totalWeight = 0;
  sessions.forEach((s, i) => {
    const weight = n - i;
    weightedSum += s.percentage * weight;
    totalWeight += weight;
  });
  return weightedSum / totalWeight;
}

function configPath() {
  return path.join(__dirname, '..', `${STUDENT}-difficulty-config.json`);
}

function buildDefaultConfig(reason) {
  return {
    student: STUDENT,
    generatedAt: new Date().toISOString().split('T')[0],
    coachSummary: reason,
    topicDifficulties: Object.fromEntries(
      TOPICS.map(({ topic, grade }) => [
        topic,
        {
          grade,
          level: 2,
          levelName: DIFFICULTY[2].name,
          promptInstruction: DIFFICULTY[2].prompt,
          averageScore: null,
          sessionsAnalyzed: 0,
        },
      ])
    ),
  };
}

function writeConfig(config) {
  const p = configPath();
  fs.writeFileSync(p, JSON.stringify(config, null, 2));
  return p;
}

async function main() {
  console.log(`=== Adaptive Math Coach — ${STUDENT.toUpperCase()} ===\n`);

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);

  const { data: results, error } = await supabase
    .from('quiz_results')
    .select('topic, percentage, created_at')
    .eq('student', STUDENT)
    .gte('created_at', cutoff.toISOString())
    .order('created_at', { ascending: false });

  if (error) {
    console.warn('Could not fetch quiz results:', error.message);
    const config = buildDefaultConfig('Could not fetch performance data — using standard difficulty.');
    writeConfig(config);
    console.log('Default difficulty config written.\n');
    return;
  }

  if (!results || results.length === 0) {
    console.log('No quiz results found in the last 30 days.');
    const config = buildDefaultConfig('No performance data yet — starting with standard difficulty across all topics.');
    writeConfig(config);
    console.log('Default difficulty config written.\n');
    return;
  }

  console.log(`Analyzing ${results.length} quiz result(s) from the last 30 days.\n`);

  const byTopic = {};
  for (const row of results) {
    if (!byTopic[row.topic]) byTopic[row.topic] = [];
    if (byTopic[row.topic].length < 10) {
      byTopic[row.topic].push({ percentage: row.percentage, date: row.created_at });
    }
  }

  const topicDifficulties = {};
  const excelling = [];
  const struggling = [];

  for (const { topic, grade } of TOPICS) {
    const sessions = byTopic[topic] || [];
    let level = 2;
    let averageScore = null;

    if (sessions.length > 0) {
      averageScore = Math.round(weightedAverage(sessions));
      level = levelFromScore(averageScore);
    }

    topicDifficulties[topic] = {
      grade,
      level,
      levelName: DIFFICULTY[level].name,
      promptInstruction: DIFFICULTY[level].prompt,
      averageScore,
      sessionsAnalyzed: sessions.length,
    };

    if (level === 4) excelling.push(topic);
    if (level === 1) struggling.push(topic);
  }

  const summaryParts = [];
  if (excelling.length) summaryParts.push(`Excelling at: ${excelling.join(', ')}`);
  if (struggling.length) summaryParts.push(`Needs support with: ${struggling.join(', ')}`);
  const coachSummary = summaryParts.length
    ? summaryParts.join('. ') + '.'
    : 'Making steady progress across all topics.';

  const config = {
    student: STUDENT,
    generatedAt: new Date().toISOString().split('T')[0],
    coachSummary,
    topicDifficulties,
  };

  const outPath = writeConfig(config);

  console.log('COACH ASSESSMENT REPORT');
  console.log('─'.repeat(72));
  console.log(`Summary: ${coachSummary}\n`);
  console.log('Topic Breakdown:');
  for (const [topic, d] of Object.entries(topicDifficulties)) {
    const score = d.averageScore !== null
      ? `${d.averageScore}% avg (${d.sessionsAnalyzed} session${d.sessionsAnalyzed === 1 ? '' : 's'})`
      : 'no data yet';
    console.log(`  ${d.grade} | ${topic.padEnd(38)} | Level ${d.level}: ${d.levelName.padEnd(12)} | ${score}`);
  }
  console.log(`\nDifficulty config written to: ${outPath}`);
  console.log('Ready for question generation.\n');
}

main().catch(err => {
  console.error('Coach error:', err.message);
  const config = buildDefaultConfig('Coach assessment failed — using standard difficulty as fallback.');
  writeConfig(config);
  console.log('Default difficulty config written as fallback.');
  process.exit(0);
});
