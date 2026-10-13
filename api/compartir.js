// Stub de prueba (Fase 1, paso 1): solo verifica que el rewrite por
// User-Agent de vercel.json llegue hasta acá y que el query string (?p=&u=)
// se conserve. Se reemplaza por la función real cuando se confirme.
module.exports = (req, res) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end('OK-BOT\nurl: ' + req.url + '\nua: ' + req.headers['user-agent'] + '\n');
};
