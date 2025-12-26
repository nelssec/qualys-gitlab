import { Organization, Repository, GitLabWebhook } from '../types';
import { DatabaseService } from '../db/database';
import { PlatformConfig } from '../types';

export class WebhookManager {
  private config: PlatformConfig;
  private db: DatabaseService;

  constructor(config: PlatformConfig, db: DatabaseService) {
    this.config = config;
    this.db = db;
  }

  async registerWebhooksForOrganization(organization: Organization): Promise<{
    success: number;
    failed: number;
    skipped: number;
  }> {
    const pendingRepos = this.db.getRepositoriesPendingWebhook(organization.id);
    console.log(`Registering webhooks for ${pendingRepos.length} repositories...`);

    let success = 0;
    let failed = 0;
    let skipped = 0;

    for (const repo of pendingRepos) {
      try {
        const existing = await this.findExistingWebhook(organization, repo);
        if (existing) {
          this.db.updateRepositoryWebhook(repo.id, existing.id, 'active');
          skipped++;
          continue;
        }

        const webhookId = await this.createWebhook(organization, repo);
        this.db.updateRepositoryWebhook(repo.id, webhookId, 'active');
        success++;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`Failed to register webhook for ${repo.pathWithNamespace}: ${errorMessage}`);
        this.db.updateRepositoryWebhook(repo.id, 0, 'failed');
        failed++;
      }
    }

    return { success, failed, skipped };
  }

  private async findExistingWebhook(organization: Organization, repo: Repository): Promise<GitLabWebhook | null> {
    const url = `${organization.gitlabUrl}/api/v4/projects/${repo.gitlabProjectId}/hooks`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${organization.accessToken}`,
      },
    });

    if (!response.ok) {
      return null;
    }

    const webhooks = (await response.json()) as GitLabWebhook[];
    const webhookUrl = `${this.config.baseUrl}/webhook`;

    return webhooks.find((w) => w.url === webhookUrl) || null;
  }

  private async createWebhook(organization: Organization, repo: Repository): Promise<number> {
    const url = `${organization.gitlabUrl}/api/v4/projects/${repo.gitlabProjectId}/hooks`;
    const webhookUrl = `${this.config.baseUrl}/webhook`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${organization.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: webhookUrl,
        merge_requests_events: true,
        push_events: false,
        issues_events: false,
        confidential_issues_events: false,
        tag_push_events: false,
        note_events: false,
        confidential_note_events: false,
        job_events: false,
        pipeline_events: false,
        wiki_page_events: false,
        deployment_events: false,
        releases_events: false,
        enable_ssl_verification: true,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Webhook creation failed: ${text}`);
    }

    const webhook = (await response.json()) as GitLabWebhook;
    console.log(`Created webhook for ${repo.pathWithNamespace} (ID: ${webhook.id})`);

    return webhook.id;
  }

  async deleteWebhook(organization: Organization, repo: Repository): Promise<void> {
    if (!repo.webhookId) {
      return;
    }

    const url = `${organization.gitlabUrl}/api/v4/projects/${repo.gitlabProjectId}/hooks/${repo.webhookId}`;

    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${organization.accessToken}`,
      },
    });

    if (!response.ok && response.status !== 404) {
      throw new Error(`Failed to delete webhook: ${response.status}`);
    }

    this.db.updateRepositoryWebhook(repo.id, 0, 'pending');
  }
}
