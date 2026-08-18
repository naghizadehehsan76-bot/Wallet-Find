# Wallet-Find Local Demo

The frontend demo mode lets you preview the core 12Keys player experience without Neon/PostgreSQL or a backend server.

## What is included

- Home page
- Persian / English switching
- 3 × 4 grid with 12 keys
- inline word entry in the current key
- solved/current/locked states
- incorrect answer handling
- sequential progression
- completion after key 12
- demo data persisted in browser localStorage
- reset demo button

## Start the demo

From the repository root:

```bash
cd frontend
npm install
npm run dev -- --host 0.0.0.0
```

Open the forwarded Vite port, normally `5173`.

The demo is enabled by default in development. To explicitly configure it:

```bash
cp .env.example .env
```

and keep:

```text
VITE_DEMO_MODE=true
```

To return to the real backend API, set:

```text
VITE_DEMO_MODE=false
```

## Demo answers

The twelve demo words are:

1. apple
2. moon
3. river
4. forest
5. gold
6. bridge
7. window
8. light
9. mountain
10. shadow
11. garden
12. bitcoin

The answer check is intentionally local and is only for demonstrating the UI flow. Production answer validation remains server-side.

## Reset

Use `Reset Demo Contest` on the Competition page to clear the demo state and start again from key 1.
