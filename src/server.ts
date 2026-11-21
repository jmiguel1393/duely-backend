import app from './app.js';
import { env } from './config/env.js';
import { checkDatabaseConnection, pool } from './infrastructure/database/connection.js';

async function bootstrap() {
  try {
    await checkDatabaseConnection();

    app.listen(env.PORT, () => {
      console.log(`Duely API running on port ${env.PORT}`);
    });
  } catch (error) {
    console.error('Error starting Duely API:', error);

    await pool.end();
    process.exit(1);
  }
}

bootstrap();