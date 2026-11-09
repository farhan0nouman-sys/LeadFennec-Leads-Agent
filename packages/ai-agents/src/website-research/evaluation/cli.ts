// Writes the evaluation baseline (task 09C): `pnpm --filter @lead-fennec-ai/ai-agents run
// evaluate` after a build. Fake and scripted models only: it never calls a live model. The test
// (evaluation.test.ts) fails when the saved file and a fresh run differ.
import { writeFile } from 'node:fs/promises';
import { evaluationBaseline } from './evaluate.js';

const target = process.argv[2];
if (target === undefined) {
  console.error('Usage: evaluate <output.json>');
  process.exitCode = 1;
} else {
  const baseline = await evaluationBaseline();
  await writeFile(target, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${target}`);
}
