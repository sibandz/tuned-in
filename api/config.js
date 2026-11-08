module.exports = (_request, response) => {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY
    || process.env.SUPABASE_ANON_KEY
    || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    || process.env.VITE_SUPABASE_ANON_KEY;

  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', 'application/json');

  if (!url || !anonKey) {
    response.statusCode = 503;
    response.end(JSON.stringify({
      error: 'Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY (or SUPABASE_ANON_KEY) in Vercel.'
    }));
    return;
  }

  response.statusCode = 200;
  response.end(JSON.stringify({ url, anonKey }));
};
