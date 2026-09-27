# OceanEmbed Frontend

React + TypeScript frontend for **OceanDepth AI** — subsurface ocean
temperature reconstruction over the North Indian Ocean. TanStack Start
(SSR) app deployed to Vercel with `frontend-oceanembed` as the root directory.

## Development

You need Node.js and npm.

```sh
cd frontend-oceanembed
npm i
cp .env.example .env   # fill in Supabase + Gemini keys
npm run dev            # http://localhost:8080
```

## Checks

```sh
npx tsc --noEmit
```

## Built with

- TanStack Start
- TypeScript
- React
- Tailwind CSS
