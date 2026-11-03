import { defineConfig } from '@playwright/test';

// Configuration utilisée par `npm run test` depuis le J2 : mêmes réglages que playwright.config.ts (J1), mais
// serveur d'aperçu sur le port 4211 (consigne du J2 : port libre ≥ 4200 ; 4180 et 4190 servent ailleurs).
// Edge installé (aucun téléchargement de navigateur). Serveur arrêté en fin de run.
// Audit J6 point 2 : la suite s'exécute sur la construction DE TEST (`npm run build:test`, mode `test`, crochets actifs, sortie
// `node_modules/.jardin-test`), jamais sur `dist/` qui est la production sans crochets.
// Audit J6 point 4 : une relance (`retries: 1`) est réglée seulement pour les tests de TEMPS, par `test.describe.configure` dans
// j3.spec.ts (F-5 vent) et j5.spec.ts (endurance) ; ici `retries` reste 0 : le reste de la suite n'est jamais relancé.
// `JARDIN_E2E_PORT` : autre port libre si 4211 sert ailleurs (par défaut 4211).
const PORT = Number(process.env.JARDIN_E2E_PORT ?? 4211);

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: 'msedge',
    headless: true,
    viewport: { width: 1920, height: 1080 },
  },
  webServer: {
    command: `npm run build:test && npx vite preview --mode test --port ${PORT} --strictPort`,
    cwd: '..',
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
