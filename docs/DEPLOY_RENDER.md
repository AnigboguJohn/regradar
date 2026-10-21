# Free hosting on Render (live link for every device)

RegRadar runs on Render's free plan as **one service** with one address, like
`https://regradar.onrender.com`. Every push to `main` (Sync in VS Code) redeploys it.

| Piece | Free service | What it's for |
|---|---|---|
| Website + API + Remi | **Render** (free web service) | Runs `Dockerfile.render` |
| Database | **Neon** (free Postgres, includes pgvector) | Render's own free database is deleted after 30 days; Neon's isn't |
| Email | **Brevo** (free, 300 emails/day) | Render's free plan blocks Gmail's SMTP ports, so email goes over Brevo's HTTPS API |

**What "free" means here:** the service sleeps after 15 minutes with no visitors, and the first
visit after that takes about a minute to wake up. Machines are small (0.1 CPU), so Remi is slower
than on your PC. Your local data does not move across: the hosted copy starts empty.

---

## 1. Neon: the database (5 minutes)

1. Go to **neon.com** → **Sign up** → continue with GitHub.
2. Create a project: name `regradar`, Postgres **16**, region **AWS Europe Central (Frankfurt)**.
3. On the project dashboard click **Connect**. Turn **Connection pooling OFF**, then copy the
   connection string. It looks like
   `postgresql://neondb_owner:xxxx@ep-xxxx.eu-central-1.aws.neon.tech/neondb?sslmode=require`
   Keep it private: it contains the database password.

## 2. Brevo: email (5 minutes)

1. Go to **brevo.com** → **Sign up free**.
2. **Senders, domains & dedicated IPs → Senders → Add a sender**: your Gmail address. Brevo emails
   you a confirmation link; click it.
3. **SMTP & API → API keys → Generate a new API key**, name it `regradar`, and copy it.

## 3. reCAPTCHA: allow the new address (1 minute, after step 4)

At **google.com/recaptcha/admin** → your RegRadar site → ⚙ Settings → **Domains**, add your Render
address without `https://`, e.g. `regradar.onrender.com`, and **Save**.

## 4. Render: go live (10 minutes, mostly waiting)

1. Go to **render.com** → **Get started** → sign up with GitHub (AnigboguJohn). When asked, allow
   access to the **regradar** repository.
2. **New + → Blueprint** → choose **AnigboguJohn/regradar** → it finds `render.yaml`.
3. Fill in the values it asks for:

   | Setting | Value |
   |---|---|
   | `DATABASE_URL` | the Neon connection string from step 1 |
   | `BREVO_API_KEY` | the Brevo key from step 2 |
   | `MAIL_FROM` | `RegRadar <your-verified-gmail@gmail.com>` |
   | `RECAPTCHA_SITE_KEY` / `RECAPTCHA_SECRET_KEY` | your keys (same as in your local `.env`) |
   | `LLM_PROVIDER` / `LLM_API_KEY` | optional: `gemini` + a free key from aistudio.google.com, or leave empty |

4. Click **Apply**. The first build takes about 5–10 minutes. When it says **Live**, your address
   is at the top of the page.
5. Do step 3 (reCAPTCHA domain) now that you know the address.

Check it: open `https://<your-address>/api/health/ready`. It should say `"status":"ok"`.

## 5. Create your admin account on the live site

Admin accounts are created from your PC with the admin tool, pointed at the Neon database
(Docker must be running; paste your Neon string):

```
docker compose run --rm -e DATABASE_URL="<your Neon connection string>" -e DB_SSL=true api node dist/cli/admin.js create --email nonsoanigbogu49@gmail.com --name "Nonso Anigbogu"
```

It prints a new password once: save it. Sign in at `https://<your-address>/admin/login` and scan
the QR code with your authenticator app (a new entry, separate from your local one).

## 6. Share and test on every device

Send `https://<your-address>` to anyone. It works in any browser: Android, iPhone/iPad (Safari),
Windows, Mac. Remember the ~1 minute wake-up after 15 idle minutes.

**Optional: keep it awake.** In GitHub → your repo → Settings → Secrets and variables → Actions →
**Variables**, add `APP_URL` = `https://<your-address>`. The uptime check then visits every
10 minutes, which also stops the service sleeping (Render's free 750 hours/month cover one service
all month). It keeps the Neon database busier too, so watch Neon's usage page in the first week.

## Updating the live site

Make changes, then **Sync** in VS Code. Render rebuilds and switches over automatically
(3–8 minutes). Database changes (`db/migrations`) are applied on start-up.

## If something goes wrong

| Symptom | Fix |
|---|---|
| Build fails | Render → your service → **Events / Logs** shows the error; send it to me |
| `/api/health/ready` says database not ok | Check `DATABASE_URL` (pooling off, `sslmode=require` at the end) |
| "ERROR for site owner: Invalid domain" on the robot box | Add the Render address to the reCAPTCHA domains (step 3) |
| Reset codes / invites don't arrive | Admin console → System health → Email shows Brevo's message; usually the sender isn't verified yet |
| Page takes a minute to load | It was asleep; normal on the free plan (see "keep it awake") |
