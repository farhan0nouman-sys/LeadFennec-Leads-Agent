// Fixture demonstrations (task 05B, docs/decisions.md D-05B-05) exist only where data is fake
// anyway: development and test. Elsewhere their pages answer 404.
import type { AppEnv } from '@lead-fennec-ai/shared';

export const DEMO_ENVIRONMENTS: readonly AppEnv[] = ['development', 'test'];

export function demosAllowed(appEnv: AppEnv): boolean {
  return DEMO_ENVIRONMENTS.includes(appEnv);
}
