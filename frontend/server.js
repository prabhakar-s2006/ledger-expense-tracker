
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProxyMiddleware } from 'http-proxy-middleware';

const app = express();

const PORT = Number(process.env.PORT) || 4173;
const BACKEND_URL = process.env.BACKEND_URL || 'http://backend:3000';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const publicDir = path.join(__dirname, 'public');

// Forward API requests to the backend container
app.use(
  createProxyMiddleware({
    pathFilter: '/api',
    target: BACKEND_URL,
    changeOrigin: true
  })
);

// Serve frontend files
app.use(express.static(publicDir));

// Send index.html for the main frontend route
app.get('*', (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Frontend running on port ${PORT}`);
});
