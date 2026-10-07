const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 3000);
const ROOT_DIR = __dirname;
const CONTACT_LOG_PATH = path.join(ROOT_DIR, 'contact-messages.jsonl');
const PAGEVIEW_LOG_PATH = path.join(ROOT_DIR, 'pageviews.jsonl');

const MIME_BY_EXT = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let raw = '';

    request.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(new Error('Request body too large'));
        request.destroy();
      }
    });

    request.on('end', () => {
      if (!raw) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });

    request.on('error', reject);
  });
}

function sanitizeText(value, maxLength) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim().slice(0, maxLength);
}

async function appendJsonLine(filePath, payload) {
  const line = `${JSON.stringify(payload)}\n`;
  await fsp.appendFile(filePath, line, { encoding: 'utf-8' });
}

async function handleApiRequest(request, response, url) {
  if (request.method === 'GET' && url.pathname === '/api/health') {
    sendJson(response, 200, { status: 'ok' });
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/contact') {
    try {
      const body = await readJsonBody(request);
      const name = sanitizeText(body.name, 80);
      const email = sanitizeText(body.email, 120);
      const message = sanitizeText(body.message, 1000);

      if (!name || !email || !message) {
        sendJson(response, 400, { error: 'All fields are required.' });
        return true;
      }

      await appendJsonLine(CONTACT_LOG_PATH, {
        timestamp: new Date().toISOString(),
        name,
        email,
        message
      });

      sendJson(response, 201, { status: 'received' });
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/stats/pageview') {
    try {
      const body = await readJsonBody(request);
      await appendJsonLine(PAGEVIEW_LOG_PATH, {
        timestamp: new Date().toISOString(),
        path: sanitizeText(body.path, 500),
        referrer: sanitizeText(body.referrer, 500),
        user_agent: sanitizeText(body.user_agent, 500)
      });

      response.writeHead(204);
      response.end();
    } catch {
      sendJson(response, 400, { error: 'Invalid payload.' });
    }
    return true;
  }

  return false;
}

function isSafePath(requestPath) {
  return !requestPath.includes('..');
}

async function serveStaticFile(response, requestPath) {
  const normalizedPath = requestPath === '/' ? '/index.html' : requestPath;

  if (!isSafePath(normalizedPath)) {
    sendJson(response, 400, { error: 'Invalid path.' });
    return;
  }

  const filePath = path.join(ROOT_DIR, normalizedPath);

  try {
    const stats = await fsp.stat(filePath);

    if (!stats.isFile()) {
      sendJson(response, 404, { error: 'Not found.' });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_BY_EXT[ext] || 'application/octet-stream';

    response.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(response);
  } catch {
    sendJson(response, 404, { error: 'Not found.' });
  }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);

  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  if (await handleApiRequest(request, response, url)) {
    return;
  }

  await serveStaticFile(response, url.pathname);
});

server.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`Server running at http://${HOST}:${PORT}`);
});
