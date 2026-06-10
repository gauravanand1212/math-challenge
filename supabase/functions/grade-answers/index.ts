import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  const geminiKey = Deno.env.get('GEMINI_API_KEY');
  if (!geminiKey) {
    return new Response(JSON.stringify({ error: 'GEMINI_API_KEY not set' }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const { questions } = await req.json();
  // questions: Array<{ question_text: string, correct_answer: string, student_answer: string }>

  const questionList = questions.map((q: { question_text: string; correct_answer: string; student_answer: string }, i: number) =>
    `${i + 1}. Question: ${q.question_text}\n   Correct answer: ${q.correct_answer}\n   Student's answer: ${q.student_answer}`
  ).join('\n\n');

  const prompt = `You are grading a math quiz. For each question, decide if the student's answer is mathematically correct.

Rules:
- Accept ANY mathematically equivalent form as correct. Examples:
  - Fractions/decimals/mixed numbers are interchangeable: "1 1/2" = "3/2" = "1.5"
  - Improper fractions and mixed numbers are equivalent: "7/4" = "1 3/4"
  - Unsimplified fractions are correct if equal in value: "2/4" = "1/2"
  - Scientific notation and standard form are interchangeable: "3000" = "3 × 10³" = "3e3"
  - Units in the student answer are fine even if not in the correct answer: "15 ft" = "15"
  - Ignore extra spaces, dollar signs, degree symbols, or capitalisation differences
- Only mark wrong if the numeric value is actually different from the correct answer.

${questionList}

Return ONLY a JSON array of ${questions.length} objects with a single boolean field "correct".
Example: [{"correct":true},{"correct":false}]`;

  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.0-flash:generateContent?key=${geminiKey}`;

  const geminiRes = await fetch(geminiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json' },
    }),
  });

  const geminiData = await geminiRes.json();
  const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text ?? '[]';
  const results = JSON.parse(text);

  return new Response(JSON.stringify(results), {
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
});
