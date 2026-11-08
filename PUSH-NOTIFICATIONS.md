# Device notifications

Today can show reminders while it is open and send Web Push reminders while it is closed. Closed-app delivery requires the deployed Vercel functions, Supabase tables, and browser notification permission below.

## 1. Configure Vercel

Add these environment variables for the deployment:

| Variable | Value |
| --- | --- |
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_ANON_KEY` or `SUPABASE_PUBLISHABLE_KEY` | The public Supabase key used by the app |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role key; keep private |
| `VAPID_PUBLIC_KEY` | Public VAPID key |
| `VAPID_PRIVATE_KEY` | Private VAPID key; keep private |
| `VAPID_SUBJECT` | A `mailto:` address or an HTTPS URL identifying the site owner |
| `CRON_SECRET` | A long random secret for authorizing the scheduled reminder function |

Generate a VAPID key pair with `npx web-push generate-vapid-keys`. Use the same key pair for all deployments; changing it invalidates existing browser subscriptions. Never expose the service-role or VAPID private key in frontend code or public configuration.

## 2. Create the Supabase tables

Run [`supabase/schema.sql`](./supabase/schema.sql) in the Supabase SQL Editor. It creates private subscription and delivery tables used only by the server functions. Do not expose these tables to client-side queries.

## 3. Deploy and enable notifications

Redeploy after adding the environment variables and schema. The Vercel Cron job invokes `/api/send-reminders` every minute and uses `CRON_SECRET` for authorization. Minute-level cron availability depends on the Vercel plan; if the plan disallows this schedule, scheduled closed-app reminders cannot run at this frequency.

On each device, open the deployed site over HTTPS, sign in, allow notifications, then enable **Browser notification** in Settings. Each device must be subscribed separately. The app can show open-app reminders locally; closed-app notifications depend on the browser/operating system allowing background push delivery and may be delayed or suppressed by device power and notification settings.
