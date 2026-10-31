// `pnpm dev`: starts local PostgreSQL and Redis (compose.yaml), waits until they are
// healthy, then runs every app in watch mode with the variables from .env.
//
//   pnpm dev                    services + apps
//   pnpm dev --skip-services    apps only (use your own PostgreSQL/Redis from .env)
//
// Never deletes data: services are started with `up`, never reset. See
// docs/local-development.md.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const skipServices = process.argv.includes('--skip-services');

function fail(message) {
  console.error(`\n[dev] ${message}\n`);
  process.exit(1);
}

// 1. Node version (package.json engines: ^24.15.0)
const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
if (major !== 24 || minor < 15) {
  fail(`Node ${process.versions.node} found; this repo needs Node ^24.15.0.`);
}

// 2. Dependencies
const turboBin = join(root, 'node_modules', 'turbo', 'bin', 'turbo');
if (!existsSync(turboBin)) {
  fail('Dependencies are not installed. Run: pnpm install');
}

// 3. .env (shell variables win over the file, matching Next.js precedence)
const envFile = join(root, '.env');
if (!existsSync(envFile)) {
  fail(
    'Missing .env. Create it from the template and set local passwords:\n' +
      '  cp .env.example .env\n' +
      'See docs/local-development.md.',
  );
}
const env = { ...parseEnv(readFileSync(envFile, 'utf8')), ...process.env };

// 4. Services
if (skipServices) {
  console.log('[dev] --skip-services: not starting Docker services.');
} else {
  const docker = (args) =>
    spawnSync('docker', args, { cwd: root, env, encoding: 'utf8' });
  if (docker(['--version']).error) {
    fail(
      'Docker was not found on PATH. Install Docker Desktop: ' +
        'https://docs.docker.com/get-started/get-docker/\n' +
        'Or run your own PostgreSQL and Redis and use: pnpm dev --skip-services',
    );
  }
  if (docker(['info']).status !== 0) {
    fail(
      'Docker is installed but not running. Start Docker Desktop and retry.',
    );
  }
  if (docker(['compose', 'version']).status !== 0) {
    fail(
      'Docker Compose v2 is missing ("docker compose version" failed). Update Docker Desktop.',
    );
  }
  console.log(
    '[dev] Starting PostgreSQL and Redis; waiting for health checks...',
  );
  const up = spawnSync('docker', ['compose', 'up', '--detach', '--wait'], {
    cwd: root,
    env,
    stdio: 'inherit',
  });
  if (up.status !== 0) {
    fail(
      'PostgreSQL/Redis did not start or become healthy. Check:\n' +
        '  docker compose ps\n' +
        '  docker compose logs postgres redis\n' +
        'Common causes: a missing password in .env, or ports 5432/6379 already in use ' +
        '(change POSTGRES_PORT/REDIS_PORT and the matching URLs in .env).',
    );
  }
}

// 5. Apps (turbo run dev). Ctrl+C reaches turbo directly; wait for it to finish.
console.log('[dev] Starting web :3000, api :3001, worker health :3002 ...');
const apps = spawn(process.execPath, [turboBin, 'run', 'dev'], {
  cwd: root,
  env,
  stdio: 'inherit',
});
process.on('SIGINT', () => undefined);
process.on('SIGTERM', () => apps.kill('SIGTERM'));
apps.on('exit', (code) => {
  if (!skipServices) {
    console.log(
      '\n[dev] Apps stopped. PostgreSQL and Redis keep running: docker compose stop',
    );
  }
  process.exit(code ?? 1);
});
