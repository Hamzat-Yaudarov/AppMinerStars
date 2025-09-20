require('dotenv').config();
const { createServer } = require('./src/server');
const { startBot } = require('./src/bot');

const port = process.env.PORT || 3000;

(async () => {
  const app = await createServer();
  app.listen(port, () => {
    console.log(`HTTP server listening on ${port}`);
  });
  await startBot();
})();
