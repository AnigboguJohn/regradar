/**
 * Before the browser tests: wait until the test stack answers, then create the platform admin
 * the admin-console tests sign in with (admins can only be created with the command-line tool).
 */
import { execSync } from "node:child_process";
import { ADMIN } from "./helpers";

const COMPOSE = process.env.COMPOSE ?? "docker compose -p regradar-test -f docker-compose.test.yml";
const ROOT = new URL("../..", import.meta.url);

export default async function globalSetup() {
  const base = process.env.BASE_URL ?? "http://localhost:8090";
  const deadline = Date.now() + 180_000;
  for (;;) {
    const ok = await fetch(`${base}/api/health/ready`).then((r) => r.ok).catch(() => false);
    if (ok) break;
    if (Date.now() > deadline) throw new Error(`The test stack at ${base} did not become ready. Start it with ./scripts/e2e.sh`);
    await new Promise((r) => setTimeout(r, 2000));
  }
  const cwd = decodeURIComponent(ROOT.pathname).replace(/^\/([A-Za-z]:)/, "$1");
  const out = execSync(`${COMPOSE} exec -T api node dist/cli/admin.js list`, { cwd }).toString();
  if (!out.includes(ADMIN.email)) {
    execSync(`${COMPOSE} exec -T api node dist/cli/admin.js create --email ${ADMIN.email} --name "E2E Admin" --password ${ADMIN.password}`, { cwd, stdio: "inherit" });
  }
}
