// Password hashing with Argon2id (@node-rs/argon2, docs/decisions.md D-04A-03).
import { hash, parseOptions, verify, type Options } from '@node-rs/argon2';
import type { AuthPolicy } from './auth.policy.js';

// The algorithm is left at the library's default, Argon2id: its `Algorithm` enum is an
// ambient const enum, which isolatedModules cannot use as a value. Every hash is checked to
// be Argon2id by its PHC prefix (here and by a CHECK constraint in the database).
const ARGON2ID_PREFIX = '$argon2id$';

/** NIST and OWASP: compare passwords after Unicode normalization; any character allowed. */
function normalize(password: string): string {
  return password.normalize('NFKC');
}

export class PasswordHasher {
  private readonly options: Options;
  /** A real hash to verify against when there is no account, so both paths cost the same. */
  private readonly dummyHash: Promise<string>;

  constructor(policy: AuthPolicy['argon2']) {
    this.options = { ...policy };
    this.dummyHash = hash('lead-fennec-ai: no such account', this.options);
  }

  hash(password: string): Promise<string> {
    return hash(normalize(password), this.options);
  }

  /**
   * Checks a password against a stored hash. With no hash (no account, or no password set)
   * it still runs a full verification against a dummy hash, then returns false.
   */
  async verify(storedHash: string | null, password: string): Promise<boolean> {
    const target = storedHash ?? (await this.dummyHash);
    let matches: boolean;
    try {
      matches = await verify(target, normalize(password));
    } catch {
      matches = false;
    }
    return storedHash !== null && matches;
  }

  /** True when the stored hash uses weaker settings than the current policy. */
  needsRehash(storedHash: string): boolean {
    try {
      const current = parseOptions(storedHash);
      return (
        !storedHash.startsWith(ARGON2ID_PREFIX) ||
        current.memoryCost < (this.options.memoryCost ?? 0) ||
        current.timeCost < (this.options.timeCost ?? 0) ||
        current.parallelism !== this.options.parallelism
      );
    } catch {
      return true;
    }
  }
}
