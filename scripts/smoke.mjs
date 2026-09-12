/**
 * `npm run smoke`: build the host and prove it boots, the way CI's smoke job does.
 *
 *   node scripts/smoke.mjs [seconds]
 *
 * Runs `aura-shell --smoke N` against a throwaway data directory, so it never touches the real
 * library or settings, and passes only if the process prints AURA_SMOKE_OK and exits 0. `--smoke`
 * forces a windowed, never-topmost window whatever the stored fullscreen preference says.
 *
 * The debug build loads its UI from the Vite dev server, so run `npm run dev` alongside if you
 * want the page to render; the marker is printed on a timer either way.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const secs = process.argv[2] ?? '8';

const build = spawnSync('cargo', ['build', '-p', 'aura-shell'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if (build.status !== 0) {
  console.error('smoke: cargo build failed');
  process.exit(1);
}

const exe = join('target', 'debug', process.platform === 'win32' ? 'aura-shell.exe' : 'aura-shell');
if (!existsSync(exe)) {
  console.error(`smoke: ${exe} was not built`);
  process.exit(1);
}

const dataDir = mkdtempSync(join(tmpdir(), 'aura-smoke-'));
let output = '';
const child = spawn(exe, ['--smoke', secs, '--data-dir', dataDir]);
child.stdout.on('data', (chunk) => {
  output += chunk;
  process.stdout.write(chunk);
});
child.stderr.on('data', (chunk) => process.stderr.write(chunk));

const limit = setTimeout(() => {
  console.error('smoke: the shell did not exit in time');
  child.kill();
}, (Number(secs) + 60) * 1000);

child.on('exit', (code) => {
  clearTimeout(limit);
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // SQLite can hold the files for a moment after exit; a stray temp folder is harmless.
  }
  if (code === 0 && output.includes('AURA_SMOKE_OK')) {
    console.log('smoke: OK');
    process.exit(0);
  }
  console.error(
    `smoke: failed (exit ${code}${output.includes('AURA_SMOKE_OK') ? '' : ', no AURA_SMOKE_OK'}). ` +
      'A running Aura Shell takes over a second launch - it is single-instance - so close it first.',
  );
  process.exit(1);
});
