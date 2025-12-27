import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import http from 'node:http'
import https from 'node:https'
import dns from 'node:dns'
import net from 'node:net'
import { Buffer } from 'node:buffer'

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAFE_ROOT = path.resolve(__dirname, 'public/samples');

/**
 * Robust SSRF Protection: 
 * Validates URLs, blocks private IPs, and prevents DNS rebinding via pinning.
 */
async function protectedFetch(urlStr, redirectCount = 0) {
  if (redirectCount > 5) throw new Error('Too many redirects');

  const url = new URL(urlStr);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Invalid protocol: ' + url.protocol);
  }

  // 1. DNS Lookup & IP Validation
  const ip = await new Promise((resolve, reject) => {
    dns.lookup(url.hostname, (err, address) => {
      if (err) reject(err);
      else resolve(address);
    });
  });

  // 2. Block Private/Internal IP ranges
  if (net.isIP(ip)) {
    const isPrivate =
      ip === '127.0.0.1' ||
      ip === '::1' ||
      ip.startsWith('10.') ||
      ip.startsWith('192.168.') ||
      ip.startsWith('169.254.') || // Cloud Metadata
      (ip.startsWith('172.') && parseInt(ip.split('.')[1]) >= 16 && parseInt(ip.split('.')[1]) <= 31);

    if (isPrivate) {
      throw new Error(`SSRF Blocked: Destination IP ${ip} is restricted.`);
    }
  }

  // 3. Request with DNS Pinning (Force connection to the validated IP)
  return new Promise((resolve, reject) => {
    const options = {
      hostname: ip, // Pin to IP
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: 'GET',
      headers: {
        'Host': url.hostname, // Crucial: Keep original hostname for SNI / VHosts
        'User-Agent': 'PDFTwice-Bridge/1.0'
      },
      // Ensure the agent doesn't bypass our IP pin
      agent: false
    };

    const lib = url.protocol === 'https:' ? https : http;

    // For HTTPS, we must pass the servername for SNI to work correctly when connecting via IP
    if (url.protocol === 'https:') {
      options.servername = url.hostname;
    }

    const req = lib.request(options, (res) => {
      // 4. Handle Redirects (Manual validation)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const nextUrl = new URL(res.headers.location, urlStr).href;
        console.log(`Following redirect to: ${nextUrl}`);
        protectedFetch(nextUrl, redirectCount + 1).then(resolve).catch(reject);
        return;
      }

      if (res.statusCode !== 200) {
        const err = new Error('Remote resource could not be fetched');
        err.status = res.statusCode;
        reject(err);
        return;
      }

      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          ok: true,
          buffer: Buffer.concat(chunks),
          contentType: res.headers['content-type']
        });
      });
    });

    req.on('error', reject);
    req.end();
  });
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const enableLocalBridge = env.VITE_ENABLE_LOCAL_BRIDGE !== 'false';

  return {
    base: '/PDFTwice/',
    define: {
      // Expose safe root for creating file:/// links in the frontend
      // This allows functional "Open outside" links for local files without compromising the bridge security
      __PDF_SAMPLES_ROOT__: JSON.stringify(SAFE_ROOT),
      __REVEAL_ABSOLUTE_PATH__: JSON.stringify(env.VITE_REVEAL_ABSOLUTE_PATH !== 'false'),
    },
    plugins: [
      react(),
      {
        name: 'pdf-bridge',
        configureServer(server) {
          // Security Warning: If the server is exposed to the network, the PDF bridge is also exposed.
          const host = server.config.server.host;
          if (host === true || (typeof host === 'string' && host !== 'localhost' && host !== '127.0.0.1')) {
            console.warn('\x1b[33m%s\x1b[0m', '⚠️  SECURITY WARNING: PDF Bridge is exposed to the local network.');
            console.warn('\x1b[33m%s\x1b[0m', '   Remote PDF proxying and local sample access are active.');
            console.warn('\x1b[33m%s\x1b[0m', '   Ensure you are on a trusted network.\n');
          }

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

                // 0. Handle Remote URLs (Protected Proxy)
                if (rawPath.startsWith('http://') || rawPath.startsWith('https://')) {
                  console.log('Proxying remote PDF (Protected):', rawPath);
                  try {
                    const remoteData = await protectedFetch(rawPath);

                    res.setHeader('Content-Type', remoteData.contentType || 'application/pdf');
                    res.setHeader('Content-Length', remoteData.buffer.length);
                    res.setHeader('Access-Control-Allow-Origin', '*');
                    res.end(remoteData.buffer);
                  } catch (fetchErr) {
                    res.statusCode = fetchErr.status || 500;
                    res.end(fetchErr.message); // Already contains the status
                  }
                  return;
                }

                // Security & Sanitization for Local Paths
                if (!enableLocalBridge) {
                  res.statusCode = 403;
                  res.end('Local bridge is disabled by configuration.');
                  return;
                }

                const sanitizedInput = rawPath.replace(/\0/g, '');

                if (path.isAbsolute(sanitizedInput)) {
                  res.statusCode = 403;
                  res.end('Absolute paths are not allowed.');
                  return;
                }

                let resolvedPath = path.normalize(path.join(SAFE_ROOT, sanitizedInput));

                if (!resolvedPath.toLowerCase().endsWith('.pdf')) {
                  res.statusCode = 403;
                  res.end('Only PDF files are allowed');
                  return;
                }

                if (!resolvedPath.startsWith(SAFE_ROOT)) {
                  res.statusCode = 403;
                  res.end('Access outside of safe root');
                  return;
                }

                if (!fs.existsSync(resolvedPath)) {
                  res.statusCode = 404;
                  res.end('File not found.');
                  return;
                }

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
  };
})
