const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT_DIR = __dirname;
const INDEX_PATH = path.join(ROOT_DIR, "index.html");
const STYLES_PATH = path.join(ROOT_DIR, "styles.css");
const CNAME_PATH = path.join(ROOT_DIR, "CNAME");
const INDEX_HTML = fs.readFileSync(INDEX_PATH, "utf8");
const STYLES_CSS = fs.readFileSync(STYLES_PATH, "utf8");
const CNAME_VALUE = fs.existsSync(CNAME_PATH)
  ? fs.readFileSync(CNAME_PATH, "utf8")
  : "";

function cleanText(value) {
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getToolCatalog() {
  const html = INDEX_HTML;
  const categories = [];
  const toolsByPath = new Map();

  const categoryRegex =
    /<h2 class="fiesta-tools-title">([\s\S]*?)<\/h2>[\s\S]*?<div class="fiesta-grid">([\s\S]*?)<\/div><\/div><\/div>/g;
  const cardRegex =
    /<a class="fiesta-card[^"]*" href="([^"]+)">[\s\S]*?<h3>([\s\S]*?)<\/h3>[\s\S]*?<p>([\s\S]*?)<\/p>/g;
  const reverseRegex = /<a class="fiesta-card-reverse" href="([^"]+)">([\s\S]*?)<\/a>/g;

  let categoryMatch;
  while ((categoryMatch = categoryRegex.exec(html)) !== null) {
    const category = cleanText(categoryMatch[1]);
    categories.push(category);
    const section = categoryMatch[2];

    let cardMatch;
    while ((cardMatch = cardRegex.exec(section)) !== null) {
      const tool = {
        path: cardMatch[1],
        slug: cardMatch[1].replace(/^\/|\/$/g, ""),
        name: cleanText(cardMatch[2]),
        description: cleanText(cardMatch[3]),
        category,
      };

      if (tool.path.startsWith("/") && tool.slug && !toolsByPath.has(tool.path)) {
        toolsByPath.set(tool.path, tool);
      }
    }

    let reverseMatch;
    while ((reverseMatch = reverseRegex.exec(section)) !== null) {
      const slug = reverseMatch[1].replace(/^\/|\/$/g, "");
      const reverseTool = {
        path: reverseMatch[1],
        slug,
        name: cleanText(reverseMatch[2]),
        description: "",
        category,
      };

      if (
        reverseTool.path.startsWith("/") &&
        reverseTool.slug &&
        !toolsByPath.has(reverseTool.path)
      ) {
        toolsByPath.set(reverseTool.path, reverseTool);
      }
    }
  }

  return {
    categories: [...new Set(categories)],
    tools: Array.from(toolsByPath.values()),
  };
}

const catalog = getToolCatalog();
const toolMapBySlug = new Map(catalog.tools.map((tool) => [tool.slug, tool]));

app.use(express.json());

app.get("/styles.css", (req, res) => {
  res.type("text/css").send(STYLES_CSS);
});

app.get("/CNAME", (req, res) => {
  if (!CNAME_VALUE) {
    return res.status(404).end();
  }
  return res.type("text/plain").send(CNAME_VALUE);
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", toolCount: catalog.tools.length });
});

app.get("/api/categories", (req, res) => {
  res.json({ categories: catalog.categories });
});

app.get("/api/tools", (req, res) => {
  const query = (req.query.q || "").toString().trim().toLowerCase();
  const category = (req.query.category || "").toString().trim().toLowerCase();

  const filtered = catalog.tools.filter((tool) => {
    const matchesQuery =
      !query ||
      tool.name.toLowerCase().includes(query) ||
      tool.description.toLowerCase().includes(query) ||
      tool.slug.includes(query);
    const matchesCategory = !category || tool.category.toLowerCase() === category;
    return matchesQuery && matchesCategory;
  });

  res.json({
    total: filtered.length,
    tools: filtered,
  });
});

app.get("/api/tools/:slug", (req, res) => {
  const slug = req.params.slug.toLowerCase();
  const tool = toolMapBySlug.get(slug);

  if (!tool) {
    return res.status(404).json({ error: "Tool not found" });
  }

  return res.json(tool);
});

for (const tool of catalog.tools) {
  app.get(tool.path, (req, res) => {
    res.type("html").send(INDEX_HTML);
  });
}

app.get("/", (req, res) => {
  res.type("html").send(INDEX_HTML);
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
