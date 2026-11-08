const { authenticateRequest, getSupabaseConfig, supabaseRequest } = require('./_lib/supabase');

function validPushEndpoint(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const allowed = host === 'fcm.googleapis.com'
      || host.endsWith('.push.services.mozilla.com')
      || host === 'push.apple.com'
      || host.endsWith('.push.apple.com')
      || host.endsWith('.notify.windows.com');
    return url.protocol === 'https:' && !url.username && !url.password
      && (!url.port || url.port === '443') && allowed;
  } catch {
    return false;
  }
}

module.exports = async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', 'application/json');

  if (request.method !== 'POST' && request.method !== 'DELETE') {
    response.setHeader('Allow', 'POST, DELETE');
    response.statusCode = 405;
    response.end(JSON.stringify({ error: 'Method not allowed.' }));
    return;
  }

  try {
    const user = await authenticateRequest(request);
    if (!user?.id) {
      response.statusCode = 401;
      response.end(JSON.stringify({ error: 'Sign in to manage device notifications.' }));
      return;
    }

    const subscription = request.body?.subscription;
    if (!subscription || !validPushEndpoint(subscription.endpoint)) {
      response.statusCode = 400;
      response.end(JSON.stringify({ error: 'The browser provided an invalid push subscription.' }));
      return;
    }

    if (request.method === 'POST') {
      if (!subscription.keys?.p256dh || !subscription.keys?.auth) {
        response.statusCode = 400;
        response.end(JSON.stringify({ error: 'The push subscription is missing encryption keys.' }));
        return;
      }

      await supabaseRequest('/rest/v1/push_subscriptions?on_conflict=endpoint', {
        method: 'POST',
        prefer: 'resolution=merge-duplicates,return=minimal',
        body: {
          user_id: user.id,
          endpoint: subscription.endpoint,
          keys: subscription.keys
        }
      });
    } else {
      const { url, serviceKey } = getSupabaseConfig();
      const query = new URLSearchParams({
        user_id: `eq.${user.id}`,
        endpoint: `eq.${subscription.endpoint}`
      });
      const result = await fetch(`${url}/rest/v1/push_subscriptions?${query}`, {
        method: 'DELETE',
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          Prefer: 'return=minimal'
        }
      });
      if (!result.ok) throw new Error(`Supabase request failed (${result.status}).`);
    }

    response.statusCode = 200;
    response.end(JSON.stringify({ ok: true }));
  } catch (error) {
    console.error('Push subscription request failed:', error);
    response.statusCode = 500;
    response.end(JSON.stringify({ error: 'Could not save this device notification subscription.' }));
  }
};
