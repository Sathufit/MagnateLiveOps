// Local server: `npm run dev` (with Vite) or `npm start` (serving the built front end).
// On Vercel this file is not used; api/index.js serves the same app.
import express from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { app, passcodeIsDefault, usingPostgres } from './app.ts';

const prod = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT ?? 4100);

if (prod && passcodeIsDefault()) {
  console.error('ADMIN_PASSCODE must be set when running in production.');
  process.exit(1);
}

if (prod) {
  const dist = resolve('dist');
  if (!existsSync(dist)) {
    console.error('No build found. Run "npm run build" first.');
    process.exit(1);
  }
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.use((_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(resolve(dist, 'index.html'));
  });
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}

app.listen(PORT, () => {
  console.log(`Magnate LiveOps running at http://localhost:${PORT}`);
  console.log(`Storage: ${usingPostgres() ? 'Postgres (DATABASE_URL)' : 'local SQLite file'}`);
  if (!prod && passcodeIsDefault()) console.log('Console passcode (development default): magnate');
});
