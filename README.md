# igbroken.github.io

This project now includes:

- A working frontend (`index.html` + `styles.css`)
- A Node.js backend (`server.js`) that serves static files and exposes APIs

## Run locally

```bash
npm start
```

The app runs on `http://localhost:3000` by default.

## Available API endpoints

- `GET /api/health` – backend health check
- `POST /api/contact` – accepts `{ name, email, message }`
- `POST /api/stats/pageview` – accepts pageview beacon payload
