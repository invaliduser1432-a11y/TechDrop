import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve('work/runtime');
mkdirSync(root, { recursive: true });
const [command, ...args] = process.argv.slice(2);
const child = spawn(command, args, {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: {
    ...process.env,
    PATH: `${resolve('node_modules/.bin')}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH}`,
    NPM_CONFIG_CACHE: resolve('work/npm-cache'),
    XDG_CONFIG_HOME: root,
    XDG_CACHE_HOME: root,
    ASTRO_TELEMETRY_DISABLED: '1',
    CLOUDFLARE_SEND_METRICS: 'false',
  },
});
child.on('exit', (code) => process.exit(code ?? 1));
child.on('error', (error) => {
  console.error(error.message);
  process.exit(1);
});
