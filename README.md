## Context

[Semantic Scholar](https://www.semanticscholar.org/) is an open-access academic search engine developed by the Allen Institute for AI. 
It helps researchers discover relevant papers and explore citations.

## Problem

Exploratory research (or constructing a RAG) often requires performing multiple searches for multiple phrases. Doing this can be time consuming and also results in overlapping results (duplicates).

## Solution

This tool automates the process by:
- UI to enter all queries at once
- Searching Semantic Scholar for each phrase
- Combining all results
- Removing duplicates
- Returning a single, clean list

![Explanatory diagram](docs/explanatory-diagram.jpg)

## Web

Web client is publicly available at [https://mikomanczak.github.io/Augmented-Search-for-Semantic-Scholar](https://mikomanczak.github.io/Augmented-Search-for-Semantic-Scholar) 

![Explanatory diagram](docs/web-screenshot.jpg)

Note that this hosted website uses Semantic Scholar without an API key. Semantic Scholar limits unauthenticated users to a shared rate limit of 1,000 requests per second, so searches performed through this website may occasionally fail.

A more reliable way to use the web client is to:

1. [Request an API key](https://www.semanticscholar.org/product/api#api-key)
2. Clone this repository
3. Save your API key in src/web/.env file
4. Run the web client locally

Semantic Scholar requests in the web client automatically retry HTTP 429
responses up to 60 times, waiting a fixed 1 second between retries by default. A valid
`Retry-After` header (seconds or HTTP date) sets the delay instead. If the server
requests a wait longer than 60 seconds, the rate-limit error is shown immediately.
The web client shows an animated retry counter and countdown.
The web client also retries network/CORS failures (shown as “Failed to fetch” by
the browser), since these can hide the HTTP status of a rate-limit response.

### Download open access PDFs

After searching, open **Download** and choose **Download open access PDFs (.zip)**.
The archive contains PDFs from the currently loaded results and a `download-report.json`
listing successes and failures. Duplicate paper IDs and PDF URLs are downloaded once.
Downloads run three at a time, with a 20 MB limit per PDF, a 100 MB transfer limit per
batch, and a 30-second timeout per file. Cancel stops the batch without saving an archive.
Publisher landing pages, blocked links and other unavailable files appear in the report.

The GitHub Pages version fetches PDFs directly in the browser. Publishers that do not
allow cross-origin requests cannot be downloaded this way. For better coverage, run
the PDF service locally (Node.js 22.18+):

```sh
cd src/web/backend
npm ci
npm start
```

In another terminal, start the frontend:

```sh
cd src/web/frontend
npm ci
npm run dev
```

For frontend development without Semantic Scholar requests, open the Vite URL with
`?mock_results` to search bundled example data.

Open the URL printed by Vite. The development server forwards PDF requests to
`http://127.0.0.1:3000`. The service follows up to five redirects, validates PDF bytes,
blocks private/reserved network destinations on every hop, pins DNS results to each
connection, and caps active publisher downloads at six. It cannot bypass publisher
authentication or anti-bot restrictions, or resolve arbitrary landing pages into PDFs.

To use a separately hosted PDF service, set `VITE_PDF_API_URL` to its full
`https://your-service.example/api/pdfs` endpoint before building the frontend, or set
the repository Actions variable `VITE_PDF_API_URL` for the GitHub Pages build. Set
`PDF_ALLOWED_ORIGINS` on the service to a comma-separated list of approved website
origins (for example `https://mikomanczak.github.io`). Localhost origins are allowed
for development. `HOST` defaults to `127.0.0.1`; use `HOST=0.0.0.0` when your hosting
platform requires it, and set `PORT` as needed. For public hosting, apply access and
request-rate limits at your gateway; CORS is not authentication. Keep the API URL
on HTTPS when serving the frontend over HTTPS.

Run `npm test` in each directory to check the archive flow and download protections;
run `npm run build` in each directory to check TypeScript and build the app.

## Command Line Interface (CLI)

This tool is also available as a CLI. It's presumably less convenient (and more error prone) for human users but it's easier to use for agentic systems such as Claude Code or OpenAI's Codex. To use with such a tool:

1. Clone this repository
2. (Optionally) request API key and save it in src/cli/.env file 
3. Ask your agent to perform search

![Explanatory diagram](docs/cli-screenshot.png)

## Publication

An early version of this tool was used in _"Methodology for AI-Based Search Strategy of Scientific Papers: Exemplary Search for Hybrid and Battery Electric Vehicles in the Semantic Scholar Database"_ 

[https://www.mdpi.com/2304-6775/12/4/49](https://www.mdpi.com/2304-6775/12/4/49)

## License

MIT-0: free to use, modify, and distribute. No attribution or acknowledgement required.
