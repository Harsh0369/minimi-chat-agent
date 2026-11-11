import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import express from 'express';
import type { ViteDevServer } from 'vite';
import type { Config } from './config.js';
import type { Logger } from './logger.js';
import { log } from './logger.js';
import { createApi, finishApp } from './app.js';
import { notFound } from './http/errors.js';

export async function startServer(config: Config, logger: Logger = log) {
  const app = createApi(config, logger);
  const server = createServer(app);
  server.requestTimeout = 75_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 100;
  let vite: ViteDevServer | undefined;
  let closePromise: Promise<void> | undefined;
  const close = () =>
    (closePromise ??= (async () => {
      // Close Vite's HMR sockets as well as HTTP sockets; don't hang on an open tab.
      await vite?.close();
      if (!server.listening) return;
      const force = setTimeout(() => server.closeAllConnections(), 5_000);
      force.unref();
      try {
        await new Promise<void>((done, reject) =>
          server.close((error) => (error ? reject(error) : done())),
        );
      } finally {
        clearTimeout(force);
      }
    })());
  try {
    app.use('/api', notFound);
    let template: string;
    if (config.mode === 'development') {
      const { createServer: createViteServer } = await import('vite');
      vite = await createViteServer({
        appType: 'custom',
        server: { middlewareMode: true, hmr: { server }, allowedHosts: ['localhost'] },
      });
      app.use(vite.middlewares);
      template = await readFile(resolve('src/client/index.html'), 'utf-8');
    } else {
      template = await readFile(resolve('dist/client/index.html'), 'utf-8');
      app.use(
        '/assets',
        express.static(resolve('dist/client/assets'), {
          index: false,
          dotfiles: 'deny',
          fallthrough: false,
        }),
      );
    }
    app.get('/', async (req, res) => {
      const html = vite ? await vite.transformIndexHtml(req.originalUrl, template) : template;
      res.type('html').send(html.replaceAll('__MINIMI_CSP_NONCE__', String(res.locals.cspNonce)));
    });
    finishApp(app, logger);
    await new Promise<void>((done, reject) => {
      server.once('error', reject);
      server.listen(config.port, config.host, () => {
        server.off('error', reject);
        done();
      });
    });
    return { server, close };
  } catch (error) {
    await close();
    throw error;
  }
}
