## Run locally

```bash
npm install
npm start
```

The server exposes API endpoints based on the tools listed in `index.html`:

- `GET /api/health`
- `GET /api/categories`
- `GET /api/tools`
- `GET /api/tools/:slug`

It also serves all listed tool paths (for example `/pdf-to-word/`, `/merge-pdf/`) without changing the existing HTML or CSS files.
