import Fastify from 'fastify';
import cors from '@fastify/cors';
import { WebhookHandler } from './handlers/webhook';
import { WebhookConfig } from './types';

function loadConfig(): WebhookConfig {
  const requiredEnvVars = ['QUALYS_ACCESS_TOKEN', 'QUALYS_POD', 'GITLAB_URL', 'GITLAB_TOKEN'];

  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      throw new Error(`Missing required environment variable: ${envVar}`);
    }
  }

  return {
    port: parseInt(process.env.PORT || '3000', 10),
    host: process.env.HOST || '0.0.0.0',
    webhookSecret: process.env.WEBHOOK_SECRET,
    qualys: {
      accessToken: process.env.QUALYS_ACCESS_TOKEN!,
      pod: process.env.QUALYS_POD!,
      skipTlsVerify: process.env.QUALYS_SKIP_TLS_VERIFY === 'true',
      proxy: process.env.QUALYS_PROXY,
    },
    gitlab: {
      baseUrl: process.env.GITLAB_URL!,
      token: process.env.GITLAB_TOKEN!,
    },
    scan: {
      types: (process.env.SCAN_TYPES || 'pkg').split(','),
      timeout: parseInt(process.env.SCAN_TIMEOUT || '300', 10),
      failOnSeverity: parseInt(process.env.FAIL_ON_SEVERITY || '4', 10),
    },
  };
}

async function main(): Promise<void> {
  const config = loadConfig();

  const fastify = Fastify({
    logger: true,
  });

  await fastify.register(cors, {
    origin: true,
  });

  const webhookHandler = new WebhookHandler(config);

  fastify.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  fastify.post('/webhook', async (request, reply) => {
    await webhookHandler.handleWebhook(request, reply);
  });

  fastify.get('/', async () => {
    return {
      service: 'Qualys GitLab Webhook Service',
      version: '1.0.0',
      endpoints: {
        health: '/health',
        webhook: '/webhook',
      },
    };
  });

  try {
    await fastify.listen({ port: config.port, host: config.host });
    console.log(`Qualys GitLab Webhook Service listening on ${config.host}:${config.port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

main();
