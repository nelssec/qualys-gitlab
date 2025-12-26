import cron from 'node-cron';
import { PlatformConfig } from '../types';
import { DatabaseService } from '../db/database';
import { DiscoveryService } from '../discovery/service';
import { WebhookManager } from '../webhooks/manager';
import { OAuthHandler } from '../oauth/handler';

export class SyncScheduler {
  private config: PlatformConfig;
  private db: DatabaseService;
  private discovery: DiscoveryService;
  private webhookManager: WebhookManager;
  private oauthHandler: OAuthHandler;
  private task: cron.ScheduledTask | null = null;

  constructor(
    config: PlatformConfig,
    db: DatabaseService,
    discovery: DiscoveryService,
    webhookManager: WebhookManager,
    oauthHandler: OAuthHandler
  ) {
    this.config = config;
    this.db = db;
    this.discovery = discovery;
    this.webhookManager = webhookManager;
    this.oauthHandler = oauthHandler;
  }

  start(): void {
    const intervalMinutes = this.config.sync.intervalMinutes;
    const cronExpression = `*/${intervalMinutes} * * * *`;

    console.log(`Starting sync scheduler (every ${intervalMinutes} minutes)`);

    this.task = cron.schedule(cronExpression, async () => {
      await this.runSync();
    });

    setTimeout(() => this.runSync(), 5000);
  }

  stop(): void {
    if (this.task) {
      this.task.stop();
      this.task = null;
    }
  }

  async runSync(): Promise<void> {
    console.log('Starting sync cycle...');

    const organizations = this.db.getAllOrganizations();
    console.log(`Syncing ${organizations.length} organizations`);

    for (const org of organizations) {
      try {
        await this.syncOrganization(org.id);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`Sync failed for org ${org.gitlabGroupPath}: ${errorMessage}`);
      }
    }

    console.log('Sync cycle completed');
  }

  async syncOrganization(organizationId: number): Promise<{
    repositories: number;
    webhooks: { success: number; failed: number; skipped: number };
  }> {
    const org = this.db.getOrganization(organizationId);
    if (!org) {
      throw new Error(`Organization ${organizationId} not found`);
    }

    console.log(`Syncing organization: ${org.gitlabGroupPath}`);

    if (org.tokenExpiresAt && org.refreshToken) {
      const expiresIn = org.tokenExpiresAt.getTime() - Date.now();
      if (expiresIn < 5 * 60 * 1000) {
        console.log('Refreshing access token...');
        try {
          await this.oauthHandler.refreshToken({
            id: org.id,
            gitlabUrl: org.gitlabUrl,
            refreshToken: org.refreshToken,
          });
          const refreshedOrg = this.db.getOrganization(organizationId);
          if (refreshedOrg) {
            Object.assign(org, refreshedOrg);
          }
        } catch (error) {
          console.error('Token refresh failed:', error);
          throw error;
        }
      }
    }

    const repos = await this.discovery.discoverRepositories(org);

    const webhookResult = await this.webhookManager.registerWebhooksForOrganization(org);

    return {
      repositories: repos.length,
      webhooks: webhookResult,
    };
  }
}
