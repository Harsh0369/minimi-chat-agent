import { ConfigurationError, readConfig } from './config.js';
import { log } from './logger.js';
import { startServer } from './runtime.js';

async function main() {
  const config = readConfig({
    ...process.env,
    ...(process.argv.includes('--production') ? { NODE_ENV: 'production' } : {}),
  });
  const runtime = await startServer(config);
  const host = config.host === '::1' ? '[::1]' : config.host;
  log({ event: 'server_started', origin: `http://${host}:${config.port}`, mode: config.mode });
  const stop = () => {
    void runtime
      .close()
      .then(() => log({ event: 'server_stopped' }))
      .catch(() => {
        log({ event: 'startup_error', code: 'SHUTDOWN_FAILED' });
        process.exitCode = 1;
      });
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

main().catch((error: unknown) => {
  if (error instanceof ConfigurationError) process.stderr.write(`${error.message}\n`);
  else {
    const code =
      typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
    log({ event: 'startup_error', code: code === 'EADDRINUSE' ? 'PORT_IN_USE' : 'STARTUP_FAILED' });
    process.stderr.write(
      code === 'EADDRINUSE'
        ? 'The port is in use. Set another PORT in .env.\n'
        : 'Could not start the application. Check the build, Node version, and local file permissions.\n',
    );
  }
  process.exitCode = 1;
});
