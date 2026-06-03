// Analyzes Gia's recent quiz performance and writes difficulty-config.json for question generation.
// Run before generate-questions.js: node scripts/adaptive-coach.js

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

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

// Difficulty levels and the Gemini prompt instruction for each
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

// Score thresholds for each difficulty level
// >= 85% → advanced, 70–84% → challenging, 50–69% → standard, < 50% → foundational
function levelFromScore(avg) {
  if (avg >= 85) return 4;
  if (avg >= 70) return 3;
  if (avg >= 50) return 2;
  return 1;
}

// Weighted average: most recent sessions count more
function weightedAverage(sessions) {
  const n = sessions.length;
  let weightedSum = 0;
  let totalWeight = 0;
  sessions.forEach((s, i) => {
    const weight = n - i; // index 0 (most recent) gets weight n
    weightedSum += s.percentage * weight;
    totalWeight += weight;
  });
  return weightedSum / totalWeight;
}

function buildDefaultConfig(reason) {
  return {
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
  const outPath = path.join(__dirname, '..', 'difficulty-config.json');
  fs.writeFileSync(outPath, JSON.stringify(config, null, 2));
  return outPath;
}

async function main() {
  console.log("=== Gia's Adaptive Math Coach ===\n");

  // Fetch quiz results from the last 30 days
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);

  const { data: results, error } = await supabase
    .from('quiz_results')
    .select('topic, percentage, created_at')
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

  // Group results by topic (up to 10 most recent per topic)
  const byTopic = {};
  for (const row of results) {
    if (!byTopic[row.topic]) byTopic[row.topic] = [];
    if (byTopic[row.topic].length < 10) {
      byTopic[row.topic].push({ percentage: row.percentage, date: row.created_at });
    }
  }

  // Calculate difficulty level for each topic
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

  // Build coach summary
  const summaryParts = [];
  if (excelling.length) summaryParts.push(`Excelling at: ${excelling.join(', ')}`);
  if (struggling.length) summaryParts.push(`Needs support with: ${struggling.join(', ')}`);
  const coachSummary = summaryParts.length
    ? summaryParts.join('. ') + '.'
    : 'Making steady progress across all topics.';

  const config = {
    generatedAt: new Date().toISOString().split('T')[0],
    coachSummary,
    topicDifficulties,
  };

  const outPath = writeConfig(config);

  // Print assessment report
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
  // Write default config so question generation can still proceed
  const config = buildDefaultConfig('Coach assessment failed — using standard difficulty as fallback.');
  writeConfig(config);
  console.log('Default difficulty config written as fallback.');
  // Exit 0 so the workflow continues to question generation
  process.exit(0);
});
