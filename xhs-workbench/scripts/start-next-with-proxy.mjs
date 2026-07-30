import { spawn } from 'node:child_process';
import path from 'node:path';

const mode = process.argv[2] || 'dev';
const forwarded = process.argv.slice(3);
const proxy = process.env.LOCAL_HTTP_PROXY || 'http://127.0.0.1:7897';
const nextBin = path.resolve('node_modules/next/dist/bin/next');
const child = spawn(process.execPath, ['--use-env-proxy', nextBin, mode, ...forwarded], {
  stdio: 'inherit',
  env: {
    ...process.env,
    HTTP_PROXY: process.env.HTTP_PROXY || proxy,
    HTTPS_PROXY: process.env.HTTPS_PROXY || proxy,
    NODE_USE_ENV_PROXY: '1',
  },
});

child.on('exit', code => process.exit(code ?? 1));
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
