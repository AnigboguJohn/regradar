# Admin console

The admin console at **`/admin`** is for the people who run RegRadar, not for customers. It shows every
company and user, lets you fix regulator downloads, checks that each part of the system is working, and
keeps an audit trail. Company admins (Settings → Team) can't see it.

## Signing in

1. Open `/admin/login` (locally: http://localhost:8080/admin/login).
2. Enter your admin email and password, and tick "I'm not a robot".
3. **First time only:** scan the QR code with an authenticator app (Google Authenticator, Microsoft
   Authenticator or 1Password), then enter the 6-digit code it shows. If you can't scan, type the key
   shown under "Can't scan?".
4. **Every time after that:** enter the current 6-digit code from the app.

Admin sessions last 8 hours, end when the browser closes, and end immediately when you click **Sign out**.

## Managing admin accounts

There is no sign-up page for admins. Accounts are created with a command-line tool by someone who can run
commands on the server:

| Task | Locally (docker compose) | On AWS |
|---|---|---|
| Create an admin | `docker compose exec api node dist/cli/admin.js create --email you@co.com --name "Your Name"` | `./scripts/admin-aws.sh create --email you@co.com --name "Your Name"` |
| Forgot password | `… admin.js reset-password --email you@co.com` | `./scripts/admin-aws.sh reset-password --email you@co.com` |
| Lost phone (authenticator) | `… admin.js reset-2fa --email you@co.com` | `./scripts/admin-aws.sh reset-2fa --email you@co.com` |
| Remove access | `… admin.js disable --email them@co.com` | `./scripts/admin-aws.sh disable --email them@co.com` |
| See all admins | `… admin.js list` | `./scripts/admin-aws.sh list` |

`create` and `reset-password` print a strong generated password **once**: put it straight into a password
manager. Add `--password "..."` to choose your own (at least 14 characters, letters and numbers).
After `reset-2fa`, the next sign-in shows a new QR code.

## What each section does

| Section | Use it to |
|---|---|
| **Overview** | See companies, users, questions and regulations at a glance, with 30-day sign-up and question charts. A banner appears when regulator downloads have failed. |
| **Companies** | Search companies, open one to see its users and recent activity, and **suspend** or **unsuspend** it. Suspending signs out and blocks all its users at once; nothing is deleted. |
| **Users** | Search everyone. The ⋯ menu lets you make someone admin or member, **send a password reset code**, **sign them out everywhere** (lost or shared device), or **suspend** them. A company's only admin can't be demoted or suspended. |
| **Regulations & sync** | See every regulation and why downloads failed. **Attach PDF** fixes a failed regulator circular: download it in your browser from its "original" link and attach it, and it becomes searchable for every company. **Publish a circular** shares any circular with all companies. **Check regulators now** runs the automatic check immediately. |
| **System health** | Check the API, database, AI service, AI answers, email login, reCAPTCHA and the last regulator check, each with what to do if it's not working. |
| **Activity & audit** | Every company's audit log in one place, filtered by company, action, person or dates, with **Export CSV**. The **Admin actions** tab records every admin sign-in (including failed attempts) and change. |
| **My admin account** | Change your password (signs out your other admin sessions). |

## How it's kept secure

- **Separate accounts:** admin accounts are stored apart from customer accounts, and admin and customer
  sign-in tokens can't be used for each other.
- **Two-step sign-in:** every admin sign-in needs the password **and** a code from the admin's phone. The
  authenticator secret is stored encrypted.
- **Sign-in protection:** reCAPTCHA, a limit of 10 attempts per 15 minutes, and the same "Incorrect email
  or password" message whether or not the email belongs to an admin.
- **Audit trail:** every admin action is written to the admin audit log, with its IP address.
