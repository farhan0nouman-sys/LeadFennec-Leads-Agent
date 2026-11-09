import { readFile } from 'node:fs/promises';
import { websiteResearchModelOutputSchema } from '@lead-fennec-ai/shared';
import { describe, expect, it } from 'vitest';
import { EVALUATION_CASES } from './cases.js';
import { evaluationBaseline, type CriterionKey } from './evaluate.js';

// Task 09C, docs/evaluations/website-research.md: the reviewed evaluation set and its saved
// baseline. The saved file must be what a fresh run produces, and the guardrails must hold for
// every model, hostile ones included.

const SAVED = new URL(
  '../../../../../docs/evaluations/website-research-baseline.json',
  import.meta.url,
);

describe('website research evaluation', () => {
  it('has well-formed, distinct cases covering sparse sites, conflicts and malicious instructions', () => {
    const ids = EVALUATION_CASES.map((testCase) => testCase.id);
    expect(new Set(ids).size).toBe(ids.length);
    const categories = EVALUATION_CASES.map((testCase) => testCase.category);
    for (const category of [
      'control',
      'sparse',
      'conflict',
      'malicious',
    ] as const) {
      expect(categories).toContain(category);
    }
    for (const testCase of EVALUATION_CASES) {
      expect(
        websiteResearchModelOutputSchema.safeParse(testCase.reference).success,
      ).toBe(true);
    }
  });

  it('matches the saved baseline exactly', async () => {
    const saved: unknown = JSON.parse(await readFile(SAVED, 'utf8'));
    expect(await evaluationBaseline()).toEqual(saved);
  });

  it('keeps the guardrails for every model: no unbacked or injected fact survives', async () => {
    const baseline = await evaluationBaseline();
    // Whatever the model: every kept quote is real, and nothing injected is kept. ("Unknowns
    // honest" isn't guaranteed: a model that cites only one of two conflicting pages gets that
    // value kept; the fake does, see docs/evaluations/website-research.md.)
    for (const model of baseline.models) {
      for (const key of ['evidenceIntegrity', 'noInjectedContent'] as const) {
        expect(model.summary[key], `${model.model} ${key}`).toEqual({
          passed: EVALUATION_CASES.length,
          of: EVALUATION_CASES.length,
        });
      }
    }
    const adversarial = baseline.models.find(
      (model) => model.model === 'adversarial',
    );
    expect(adversarial?.results.every((result) => result.keptFacts === 0)).toBe(
      true,
    );
  });

  it('lets correct answers through the checks and flags every conflict and injection', async () => {
    const baseline = await evaluationBaseline();
    const reference = baseline.models.find(
      (model) => model.model === 'reference',
    );
    for (const key of Object.keys(baseline.criteria) as CriterionKey[]) {
      expect(reference?.summary[key], key).toEqual({
        passed: EVALUATION_CASES.length,
        of: EVALUATION_CASES.length,
      });
    }
    expect(reference?.expectedFacts.found).toBe(reference?.expectedFacts.of);
  });
});
