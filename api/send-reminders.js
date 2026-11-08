const crypto = require('node:crypto');
const webpush = require('web-push');
const { getSupabaseConfig, supabaseRequest } = require('./_lib/supabase');

const pad = value => String(value).padStart(2, '0');

function zonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}`
  };
}

function reminderTime(date, time, minutesBefore) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  if (hour > 23 || minute > 59) return null;
  const result = new Date(Date.UTC(year, month - 1, day, hour, minute - minutesBefore));
  return {
    date: `${result.getUTCFullYear()}-${pad(result.getUTCMonth() + 1)}-${pad(result.getUTCDate())}`,
    time: `${pad(result.getUTCHours())}:${pad(result.getUTCMinutes())}`
  };
}

function notificationJobs(row, now) {
  const settings = row.settings || {};
  if (settings.browser !== true) return [];

  const timeZone = settings.timeZone || 'UTC';
  const current = zonedParts(now, timeZone);
  const tasks = Array.isArray(row.tasks) ? row.tasks : [];
  const open = tasks.filter(task => task && typeof task === 'object' && !task.done && task.date === current.date);
  const jobs = [];

  if (settings.remind !== false) {
    const lead = Math.max(0, Math.min(60, Number(settings.lead) || 0));
    for (const task of open) {
      if (!task.time) continue;
      const fireAt = reminderTime(task.date, task.time, lead);
      if (!fireAt || fireAt.date !== current.date || fireAt.time !== current.time) continue;
      jobs.push({
        eventKey: `task|${task.id}|${task.date}|${task.time}|${lead}`,
        title: task.title || 'Task reminder',
        body: lead ? `In ${lead} min (${task.time})` : 'Due now'
      });
    }
  }

  if (settings.morning === true && settings.morningT === current.time) {
    const first = open.slice().sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'))[0];
    jobs.push({
      eventKey: `morning|${current.date}`,
      title: 'Good morning',
      body: first ? `${open.length} on today’s list. Start with “${first.title}”.` : 'Nothing planned yet. Add the first thing.'
    });
  }

  if (settings.evening === true && settings.eveningT === current.time && open.length) {
    jobs.push({
      eventKey: `evening|${current.date}`,
      title: 'Evening check-in',
      body: `${open.length} still open. Tick them off or move them to tomorrow.`
    });
  }

  return jobs;
}

async function reserveDelivery(userId, eventKey, endpoint) {
  const query = new URLSearchParams({ on_conflict: 'user_id,event_key,endpoint' });
  const inserted = await supabaseRequest(`/rest/v1/planner_push_deliveries?${query}`, {
    method: 'POST',
    prefer: 'resolution=ignore-duplicates,return=representation',
    body: { user_id: userId, event_key: eventKey, endpoint }
  });
  return Array.isArray(inserted) && inserted.length > 0;
}

async function removeDelivery(userId, eventKey, endpoint) {
  const { url, serviceKey } = getSupabaseConfig();
  const query = new URLSearchParams({
    user_id: `eq.${userId}`,
    event_key: `eq.${eventKey}`,
    endpoint: `eq.${endpoint}`
  });
  await fetch(`${url}/rest/v1/planner_push_deliveries?${query}`, {
    method: 'DELETE',
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
  });
}

async function removeSubscription(endpoint) {
  const { url, serviceKey } = getSupabaseConfig();
  const query = new URLSearchParams({ endpoint: `eq.${endpoint}` });
  await fetch(`${url}/rest/v1/push_subscriptions?${query}`, {
    method: 'DELETE',
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
  });
}

module.exports = async (request, response) => {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.authorization || '';
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1] || '';
  const tokenBytes = Buffer.from(token);
  const secretBytes = Buffer.from(secret || '');
  if (!secret || tokenBytes.length !== secretBytes.length
    || !crypto.timingSafeEqual(tokenBytes, secretBytes)) {
    response.statusCode = 401;
    response.end('Unauthorized');
    return;
  }

  try {
    const { url } = getSupabaseConfig();
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    const subject = process.env.VAPID_SUBJECT;
    if (!publicKey || !privateKey || !subject) throw new Error('VAPID configuration is incomplete.');
    webpush.setVapidDetails(subject, publicKey, privateKey);

    const [planners, subscriptions] = await Promise.all([
      supabaseRequest('/rest/v1/planner_data?select=user_id,tasks,settings'),
      supabaseRequest('/rest/v1/push_subscriptions?select=user_id,endpoint,keys')
    ]);
    const subscriptionsByUser = new Map();
    for (const subscription of subscriptions) {
      const list = subscriptionsByUser.get(subscription.user_id) || [];
      list.push(subscription);
      subscriptionsByUser.set(subscription.user_id, list);
    }

    let sent = 0, failed = 0;
    const now = new Date();
    for (const planner of planners) {
      const devices = subscriptionsByUser.get(planner.user_id) || [];
      if (!devices.length) continue;
      let jobs;
      try {
        jobs = notificationJobs(planner, now);
      } catch (error) {
        console.error(`Ignoring invalid reminder settings for user ${planner.user_id}:`, error);
        continue;
      }
      for (const job of jobs) {
        for (const device of devices) {
          const reserved = await reserveDelivery(planner.user_id, job.eventKey, device.endpoint);
          if (!reserved) continue;
          try {
            await webpush.sendNotification(device, JSON.stringify({
              title: job.title,
              body: job.body,
              url: '/Today.html',
              tag: `tuned-in-${job.eventKey}`
            }), { TTL: 3600 });
            sent++;
          } catch (error) {
            failed++;
            if (error.statusCode === 404 || error.statusCode === 410) {
              await removeSubscription(device.endpoint);
            } else {
              await removeDelivery(planner.user_id, job.eventKey, device.endpoint);
              console.error('Push delivery failed:', error.statusCode || error.message);
            }
          }
        }
      }
    }

    response.statusCode = 200;
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ sent, failed }));
  } catch (error) {
    console.error('Reminder job failed:', error);
    response.statusCode = 500;
    response.end('Reminder job failed');
  }
};
