# Repository Guidelines

## Project Structure & Module Organization

This repository is a machining quotation application with separate Node.js packages. `frontend/` is a Create React App client: page-level UI lives in `src/pages/`, reusable UI in `src/components/`, and HTTP calls in `src/api/quotes.js`. `backend/src/` contains the Express app, API routes (`routes/`), domain model (`models/`), and calculation, AI, PDF, and CAD services (`services/`). Database setup and seed utilities are also under `backend/src/`. Put design notes and diagrams in `docs/`; use `计算公式总结.md` as the source of truth for pricing formulas.

## Build, Test, and Development Commands

Run commands from the relevant package directory:

- `npm run dev` in `backend/` starts the API with reload on port 3001.
- `npm start` in `frontend/` starts the React development server on port 3000; it proxies API calls to the backend.
- `npm run build` in `frontend/` creates the production bundle in `frontend/build/`.
- `npm test` in `frontend/` runs the Create React App test runner interactively.
- `npm run init-db` and `npm run seed` in `backend/` initialize and populate MySQL. Do not run `npm run rebuild-db` unless data loss is intentional.

## Coding Style & Naming Conventions

Follow the existing JavaScript style: two-space indentation, semicolons, single quotes, and concise arrow functions where they improve clarity. Name React components and service classes in PascalCase (for example, `QuoteDetail.jsx` and `QuoteCalculator.js`); use camelCase for variables and functions. Keep API access centralized in `frontend/src/api/quotes.js`. New front-end pages should use `.jsx`; retain explicit import extensions where the current code does.

## Testing Guidelines

There are currently no committed test files or coverage threshold. Add focused `*.test.js`/`*.test.jsx` tests beside the component or module they exercise, and run `npm test` before submitting UI changes. For backend changes, manually verify affected API flows, including database initialization and the `/health` endpoint. Always run a frontend production build after changes that affect imports, routing, or JSX.

## Commit & Pull Request Guidelines

Recent history uses short, scoped messages such as `fix(ui): ...`, `feat: ...`, `checkpoint: ...`, and `revert: ...`; follow that pattern with an imperative summary. Keep commits narrowly focused. Pull requests should explain the user-visible or API impact, list verification performed, link the relevant issue when applicable, and include screenshots for UI changes. Never commit `.env`, uploaded drawings, generated builds, or credentials.
