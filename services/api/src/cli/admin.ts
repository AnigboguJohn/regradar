/**
 * Command-line tool for platform admin accounts. There is deliberately no sign-up page for
 * admins: accounts are created here by someone with access to the server.
 *
 *   node dist/cli/admin.js create  --email you@company.com --name "Your Name" [--password "..."]
 *   node dist/cli/admin.js reset-password --email you@company.com      (prints a new password)
 *   node dist/cli/admin.js reset-2fa      --email you@company.com      (lost phone: set up again)
 *   node dist/cli/admin.js disable|enable --email you@company.com
 *   node dist/cli/admin.js list
 *
 * Locally:  docker compose exec api node dist/cli/admin.js create --email ... --name ...
 * On AWS:   scripts/admin-aws.sh create --email ... --name ...
 */
import crypto from "node:crypto";
import { hashPassword, passwordProblem } from "../auth.js";
import { migrate, one, pool, query } from "../db.js";

const [cmd, ...rest] = process.argv.slice(2);
const arg = (name: string) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
};

/** 20 characters from an alphabet without look-alikes, plus a digit and a symbol. */
function generatePassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const body = Array.from(crypto.randomBytes(18), (b) => chars[b % chars.length]).join("");
  return `${body.slice(0, 6)}-${body.slice(6, 12)}-${body.slice(12)}${crypto.randomInt(10)}`;
}

function checkPassword(pw: string) {
  const problem = passwordProblem(pw) ?? (pw.length < 14 ? "Admin passwords must be at least 14 characters" : null);
  if (problem) { console.error(`✗ ${problem}`); process.exit(1); }
}

async function main() {
  await migrate();
  const email = arg("email")?.trim().toLowerCase();
  if (cmd !== "list" && !email) throw new Error("--email is required");

  switch (cmd) {
    case "create": {
      const name = arg("name")?.trim();
      if (!name) throw new Error('--name is required, e.g. --name "Ada Obi"');
      if (await one("SELECT 1 FROM platform_admins WHERE email = $1", [email])) throw new Error(`An admin with ${email} already exists`);
      const password = arg("password") ?? generatePassword();
      checkPassword(password);
      await query("INSERT INTO platform_admins (email, name, password_hash) VALUES ($1, $2, $3)", [email, name, await hashPassword(password)]);
      console.log(`✓ Admin created: ${name} <${email}>`);
      if (!arg("password")) console.log(`  Password: ${password}\n  (shown once: store it in a password manager)`);
      console.log("  Sign in at /admin/login. The first sign-in asks you to scan a QR code with an authenticator app.");
      break;
    }
    case "reset-password": {
      const password = arg("password") ?? generatePassword();
      checkPassword(password);
      const r = await one("UPDATE platform_admins SET password_hash = $2, token_version = token_version + 1 WHERE email = $1 RETURNING name",
        [email, await hashPassword(password)]);
      if (!r) throw new Error(`No admin with ${email}`);
      console.log(`✓ Password reset for ${r.name}. Existing admin sessions were signed out.`);
      if (!arg("password")) console.log(`  New password: ${password}`);
      break;
    }
    case "reset-2fa": {
      const r = await one(`UPDATE platform_admins SET totp_secret = NULL, totp_enabled = false, token_version = token_version + 1
        WHERE email = $1 RETURNING name`, [email]);
      if (!r) throw new Error(`No admin with ${email}`);
      console.log(`✓ Authenticator removed for ${r.name}. The next sign-in shows a new QR code to scan.`);
      break;
    }
    case "disable":
    case "enable": {
      const r = await one(`UPDATE platform_admins SET disabled_at = ${cmd === "disable" ? "now()" : "NULL"},
        token_version = token_version + 1 WHERE email = $1 RETURNING name`, [email]);
      if (!r) throw new Error(`No admin with ${email}`);
      console.log(`✓ ${r.name} ${cmd === "disable" ? "can no longer sign in" : "can sign in again"}.`);
      break;
    }
    case "list": {
      const rows = await query("SELECT email, name, totp_enabled, last_login_at, disabled_at FROM platform_admins ORDER BY created_at");
      if (!rows.length) console.log("No admins yet. Create one with: create --email ... --name ...");
      for (const r of rows) {
        console.log(`${r.disabled_at ? "✗" : "✓"} ${r.name} <${r.email}>  2FA: ${r.totp_enabled ? "on" : "not set up"}  last sign-in: ${r.last_login_at?.toISOString() ?? "never"}`);
      }
      break;
    }
    default:
      console.log("Usage: admin.js create|reset-password|reset-2fa|disable|enable|list --email you@company.com [--name \"Your Name\"]");
      process.exitCode = 1;
  }
}

main().catch((e) => { console.error(`✗ ${(e as Error).message}`); process.exitCode = 1; }).finally(() => pool.end());
