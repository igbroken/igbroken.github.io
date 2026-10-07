const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 3000);
const ROOT_DIR = __dirname;
const INDEX_PATH = path.join(ROOT_DIR, 'index.html');
const CONTACT_LOG_PATH = path.join(ROOT_DIR, 'contact-messages.jsonl');
const PAGEVIEW_LOG_PATH = path.join(ROOT_DIR, 'pageviews.jsonl');
const INDEX_HTML = fs.existsSync(INDEX_PATH) ? fs.readFileSync(INDEX_PATH, 'utf8') : '';

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

function sendHtml(response, html) {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end(html);
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

function cleanText(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.replace(/\s+/g, ' ').trim();
}

function getToolCatalog() {
  if (!INDEX_HTML) {
    return { categories: [], tools: [] };
  }

  const categories = [];
  const toolsByPath = new Map();

  const categoryRegex =
    /<h2 class="fiesta-tools-title">([\s\S]*?)<\/h2>[\s\S]*?<div class="fiesta-grid">([\s\S]*?)<\/div><\/div><\/div>/g;
  const cardRegex =
    /<a class="fiesta-card[^"]*" href="([^"]+)">[\s\S]*?<h3>([\s\S]*?)<\/h3>[\s\S]*?<p>([\s\S]*?)<\/p>/g;
  const reverseRegex =
    /<a class="fiesta-card-reverse" href="([^"]+)">(?:<svg[\s\S]*?<\/svg>)?([\s\S]*?)<\/a>/g;

  let categoryMatch;
  while ((categoryMatch = categoryRegex.exec(INDEX_HTML)) !== null) {
    const category = cleanText(categoryMatch[1]);
    categories.push(category);
    const section = categoryMatch[2];

    let cardMatch;
    while ((cardMatch = cardRegex.exec(section)) !== null) {
      const tool = {
        path: cardMatch[1],
        slug: cardMatch[1].replace(/^\/|\/$/g, ''),
        name: cleanText(cardMatch[2]),
        description: cleanText(cardMatch[3]),
        category
      };

      if (tool.path.startsWith('/') && tool.slug && !toolsByPath.has(tool.path)) {
        toolsByPath.set(tool.path, tool);
      }
    }

    let reverseMatch;
    while ((reverseMatch = reverseRegex.exec(section)) !== null) {
      const reverseTool = {
        path: reverseMatch[1],
        slug: reverseMatch[1].replace(/^\/|\/$/g, ''),
        name: cleanText(reverseMatch[2]),
        description: '',
        category
      };

      if (reverseTool.path.startsWith('/') && reverseTool.slug && !toolsByPath.has(reverseTool.path)) {
        toolsByPath.set(reverseTool.path, reverseTool);
      }
    }
  }

  return {
    categories: [...new Set(categories)],
    tools: Array.from(toolsByPath.values())
  };
}

const catalog = getToolCatalog();
const toolMapBySlug = new Map(catalog.tools.map((tool) => [tool.slug, tool]));
const toolPaths = new Set(catalog.tools.map((tool) => tool.path));

async function handleApiRequest(request, response, url) {
  if (request.method === 'GET' && url.pathname === '/api/health') {
    sendJson(response, 200, { status: 'ok', toolCount: catalog.tools.length });
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/categories') {
    sendJson(response, 200, { categories: catalog.categories });
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/tools') {
    const query = sanitizeText(url.searchParams.get('q') || '', 200).toLowerCase();
    const category = sanitizeText(url.searchParams.get('category') || '', 200).toLowerCase();

    const filtered = catalog.tools.filter((tool) => {
      const matchesQuery =
        !query ||
        tool.name.toLowerCase().includes(query) ||
        tool.description.toLowerCase().includes(query) ||
        tool.slug.includes(query);
      const matchesCategory = !category || tool.category.toLowerCase() === category;
      return matchesQuery && matchesCategory;
    });

    sendJson(response, 200, { total: filtered.length, tools: filtered });
    return true;
  }

  if (request.method === 'GET' && url.pathname.startsWith('/api/tools/')) {
    const slug = url.pathname.replace('/api/tools/', '').toLowerCase();
    const tool = toolMapBySlug.get(slug);

    if (!tool) {
      sendJson(response, 404, { error: 'Tool not found' });
      return true;
    }

    sendJson(response, 200, tool);
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
  if (requestPath.includes('\0')) {
    return false;
  }

  const resolvedPath = path.resolve(ROOT_DIR, `.${requestPath}`);
  return resolvedPath === ROOT_DIR || resolvedPath.startsWith(`${ROOT_DIR}${path.sep}`);
}

async function serveStaticFile(response, requestPath) {
  const routePath = requestPath === '/' ? '/index.html' : requestPath;
  const normalizedPath = path.posix.normalize(routePath).startsWith('/')
    ? path.posix.normalize(routePath)
    : `/${path.posix.normalize(routePath)}`;

  if (normalizedPath !== '/index.html' && toolPaths.has(normalizedPath)) {
    sendHtml(response, INDEX_HTML);
    return;
  }

  if (!isSafePath(normalizedPath)) {
    sendJson(response, 400, { error: 'Invalid path.' });
    return;
  }

  if (normalizedPath === '/index.html' && INDEX_HTML) {
    sendHtml(response, INDEX_HTML);
    return;
  }

  const filePath = path.resolve(ROOT_DIR, `.${normalizedPath}`);

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
