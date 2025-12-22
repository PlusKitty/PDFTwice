import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAFE_ROOT = path.resolve(__dirname, 'public/samples');

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'pdf-bridge',
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (req.url.startsWith('/api/pdf')) {
            try {
              const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
              const rawPath = url.searchParams.get('path');

              if (!rawPath) {
                res.statusCode = 400;
                res.end('Path parameter is required');
                return;
              }

              // Security & Sanitization
              // Remove null bytes
              const sanitizedInput = rawPath.replace(/\0/g, '');

              // Resolve absolute path
              let resolvedPath = path.isAbsolute(sanitizedInput)
                ? path.normalize(sanitizedInput)
                : path.normalize(path.join(SAFE_ROOT, sanitizedInput));

              // 1. Extension check
              if (!resolvedPath.toLowerCase().endsWith('.pdf')) {
                res.statusCode = 403;
                res.end('Forbidden: Only PDF files are allowed');
                return;
              }

              // 2. Safe Root enforcement (Traversal protection)
              if (!resolvedPath.startsWith(SAFE_ROOT)) {
                res.statusCode = 403;
                res.end('Forbidden: Access outside of safe root');
                return;
              }

              // 3. Existence check
              if (!fs.existsSync(resolvedPath)) {
                res.statusCode = 404;
                res.end('File not found: ' + resolvedPath);
                return;
              }

              // Stream file
              const fileBuffer = fs.readFileSync(resolvedPath);
              res.setHeader('Content-Type', 'application/pdf');
              res.setHeader('Content-Length', fileBuffer.length);
              res.setHeader('Access-Control-Allow-Origin', '*');
              res.end(fileBuffer);
            } catch (err) {
              res.statusCode = 500;
              res.end('Bridge Error: ' + err.message);
            }
            return;
          }
          next();
        });
      },
    }
  ],
})
