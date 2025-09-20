require('dotenv').config();
const { createServer } = require('./src/server');
const { startBot } = require('./src/bot');

const port = process.env.PORT || 3000;

(async () => {
  const app = await createServer();
  app.listen(port, () => {
    console.log(`HTTP server listening on ${port}`);
  });
  // Try to start bot in webhook mode using provided public URL
  const WEBHOOK_URL = process.env.WEBHOOK_URL || 'https://minesstarsbot-production.up.railway.app';
  await startBot(app, WEBHOOK_URL);
})();
