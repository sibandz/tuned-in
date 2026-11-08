module.exports = (_request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', 'application/json');

  const publicKey = process.env.VAPID_PUBLIC_KEY;
  if (!publicKey) {
    response.statusCode = 503;
    response.end(JSON.stringify({ error: 'Device notifications are not configured on the server yet.' }));
    return;
  }

  response.statusCode = 200;
  response.end(JSON.stringify({ publicKey }));
};
