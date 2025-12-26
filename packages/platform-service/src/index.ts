import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import * as crypto from 'crypto';
import { PlatformConfig } from './types';
import { DatabaseService } from './db/database';
import { OAuthHandler } from './oauth/handler';
import { DiscoveryService } from './discovery/service';
import { WebhookManager } from './webhooks/manager';
import { SyncScheduler } from './sync/scheduler';
import { WebhookHandler } from './handlers/webhook';
import { ScannerService } from './handlers/scanner';
import { GitLabCommentService } from './handlers/comments';
import { ScanWorker } from './queue/worker';

function loadConfig(): PlatformConfig {
  const requiredEnvVars = [
    'QUALYS_ACCESS_TOKEN',
    'QUALYS_POD',
    'GITLAB_APP_ID',
    'GITLAB_APP_SECRET',
    'BASE_URL',
  ];

  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      throw new Error(`Missing required environment variable: ${envVar}`);
    }
  }

  const baseUrl = process.env.BASE_URL!;

  return {
    port: parseInt(process.env.PORT || '3000', 10),
    host: process.env.HOST || '0.0.0.0',
    baseUrl,
    database: {
      path: process.env.DATABASE_PATH || './data/qualys-gitlab.db',
    },
    qualys: {
      accessToken: process.env.QUALYS_ACCESS_TOKEN!,
      pod: process.env.QUALYS_POD!,
      skipTlsVerify: process.env.QUALYS_SKIP_TLS_VERIFY === 'true',
    },
    gitlab: {
      appId: process.env.GITLAB_APP_ID!,
      appSecret: process.env.GITLAB_APP_SECRET!,
      callbackUrl: `${baseUrl}/oauth/callback`,
    },
    scan: {
      types: (process.env.SCAN_TYPES || 'pkg').split(','),
      timeout: parseInt(process.env.SCAN_TIMEOUT || '300', 10),
      failOnSeverity: parseInt(process.env.FAIL_ON_SEVERITY || '4', 10),
    },
    sync: {
      intervalMinutes: parseInt(process.env.SYNC_INTERVAL_MINUTES || '60', 10),
    },
  };
}

async function main(): Promise<void> {
  const config = loadConfig();

  const db = new DatabaseService(config.database.path);

  const oauthHandler = new OAuthHandler(config, db);
  const discovery = new DiscoveryService(db);
  const webhookManager = new WebhookManager(config, db);
  const syncScheduler = new SyncScheduler(config, db, discovery, webhookManager, oauthHandler);
  const webhookHandler = new WebhookHandler(config, db);

  const scanner = new ScannerService(config);
  const comments = new GitLabCommentService(db);
  const scanWorker = new ScanWorker(config, db, scanner, comments, 2);

  syncScheduler.start();
  scanWorker.start();

  const fastify = Fastify({ logger: true });

  await fastify.register(cors, { origin: true });
  await fastify.register(cookie);
  await fastify.register(formbody);

  fastify.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  fastify.get('/', async () => {
    return {
      service: 'Qualys GitLab Platform Service',
      version: '1.0.0',
      endpoints: {
        health: '/health',
        oauth: '/oauth/connect',
        callback: '/oauth/callback',
        webhook: '/webhook',
        organizations: '/api/organizations',
      },
    };
  });

  fastify.get<{ Querystring: { gitlab_url?: string } }>('/oauth/connect', async (request, reply) => {
    const gitlabUrl = request.query.gitlab_url || 'https://gitlab.com';
    const state = Buffer.from(JSON.stringify({ gitlabUrl, nonce: crypto.randomUUID() })).toString('base64');

    const authUrl = oauthHandler.getAuthorizationUrl(gitlabUrl, state);
    reply.redirect(authUrl);
  });

  fastify.get<{ Querystring: { code: string; state: string } }>('/oauth/callback', async (request, reply) => {
    await oauthHandler.handleCallback(request, reply);
  });

  fastify.get<{ Querystring: { pending: string } }>('/oauth/select-group', async (request, reply) => {
    await oauthHandler.handleGroupSelection(request, reply);
  });

  fastify.post<{ Body: { pending: string; groupId: string } }>('/oauth/select-group', async (request, reply) => {
    await oauthHandler.handleGroupSelectionSubmit(request, reply);
  });

  fastify.post('/webhook', async (request, reply) => {
    await webhookHandler.handleWebhook(request, reply);
  });

  fastify.get('/api/organizations', async () => {
    const orgs = db.getAllOrganizations();
    return orgs.map((org) => ({
      id: org.id,
      groupPath: org.gitlabGroupPath,
      gitlabUrl: org.gitlabUrl,
      status: org.status,
      lastSyncAt: org.lastSyncAt,
      createdAt: org.createdAt,
    }));
  });

  fastify.get<{ Params: { id: string } }>('/api/organizations/:id', async (request, reply) => {
    const org = db.getOrganization(parseInt(request.params.id, 10));
    if (!org) {
      reply.status(404).send({ error: 'Organization not found' });
      return;
    }

    const stats = await discovery.getDiscoveryStats(org.id);

    return {
      id: org.id,
      groupPath: org.gitlabGroupPath,
      gitlabUrl: org.gitlabUrl,
      status: org.status,
      lastSyncAt: org.lastSyncAt,
      createdAt: org.createdAt,
      repositories: stats,
    };
  });

  fastify.get<{ Params: { id: string } }>('/api/organizations/:id/repositories', async (request, reply) => {
    const orgId = parseInt(request.params.id, 10);
    const org = db.getOrganization(orgId);
    if (!org) {
      reply.status(404).send({ error: 'Organization not found' });
      return;
    }

    const repos = db.getRepositoriesByOrganization(orgId);
    return repos.map((repo) => ({
      id: repo.id,
      name: repo.name,
      pathWithNamespace: repo.pathWithNamespace,
      webUrl: repo.webUrl,
      webhookStatus: repo.webhookStatus,
      scanEnabled: repo.scanEnabled,
      lastScanAt: repo.lastScanAt,
    }));
  });

  fastify.post<{ Params: { id: string } }>('/api/organizations/:id/sync', async (request, reply) => {
    const orgId = parseInt(request.params.id, 10);

    try {
      const result = await syncScheduler.syncOrganization(orgId);
      return { status: 'ok', ...result };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return reply.status(500).send({ error: errorMessage });
    }
  });

  fastify.delete<{ Params: { id: string } }>('/api/organizations/:id', async (request, reply) => {
    const orgId = parseInt(request.params.id, 10);
    const org = db.getOrganization(orgId);
    if (!org) {
      reply.status(404).send({ error: 'Organization not found' });
      return;
    }

    const repos = db.getRepositoriesByOrganization(orgId);
    for (const repo of repos) {
      try {
        await webhookManager.deleteWebhook(org, repo);
      } catch (error) {
        console.error(`Failed to delete webhook for ${repo.pathWithNamespace}`);
      }
    }

    db.deleteOrganization(orgId);
    return { status: 'deleted' };
  });

  fastify.get('/api/queue/status', async () => {
    return scanWorker.getStatus();
  });

  try {
    await fastify.listen({ port: config.port, host: config.host });
    console.log(`Qualys GitLab Platform Service listening on ${config.host}:${config.port}`);
    console.log(`OAuth callback URL: ${config.gitlab.callbackUrl}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }

  const shutdown = async () => {
    console.log('Shutting down...');
    syncScheduler.stop();
    scanWorker.stop();
    db.close();
    await fastify.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
