import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import express from 'express';
import type { ViteDevServer } from 'vite';
import type { Config } from './config.js';
import type { Logger } from './logger.js';
import { log } from './logger.js';
import { createApi, finishApp } from './app.js';
import { notFound } from './http/errors.js';
import { openDatabase } from './storage/client.js';

export async function startServer(config: Config, logger: Logger = log) {
  let ready = false;
  const store = await openDatabase(config.databasePath);
  const app = createApi(config, logger, () => ready, store);
  let server: ReturnType<typeof app.listen> | undefined;
  let vite: ViteDevServer | undefined;
  let closePromise: Promise<void> | undefined;
  const close = () =>
    (closePromise ??= (async () => {
      try {
        try {
          await vite?.close();
        } finally {
          if (server?.listening) {
            const listeningServer = server;
            const force = setTimeout(() => listeningServer.closeAllConnections(), 5_000);
            force.unref();
            try {
              await new Promise<void>((done, reject) =>
                listeningServer.close((error) => (error ? reject(error) : done())),
              );
            } finally {
              clearTimeout(force);
            }
          }
        }
      } finally {
        await store.close();
      }
    })());
  try {
    app.use('/api', notFound);
    let template: string;
    if (config.mode === 'development') {
      // Vite needs Express's listening server for development WebSockets.
      // The readiness gate rejects requests until its middleware is attached.
      server = await listen();
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
    server ??= await listen();
    ready = true;
    return { server, close };
  } catch (error) {
    await close();
    throw error;
  }

  async function listen() {
    const listeningServer = await new Promise<ReturnType<typeof app.listen>>((done, reject) => {
      const candidate = app.listen(config.port, config.host);
      candidate.once('error', reject);
      candidate.once('listening', () => {
        candidate.off('error', reject);
        done(candidate);
      });
    });
    listeningServer.requestTimeout = 75_000;
    listeningServer.headersTimeout = 10_000;
    listeningServer.keepAliveTimeout = 5_000;
    listeningServer.maxHeadersCount = 100;
    return listeningServer;
  }
}
