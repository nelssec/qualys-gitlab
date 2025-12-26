import { FastifyRequest, FastifyReply } from 'fastify';
import * as crypto from 'crypto';
import { WebhookEvent, PlatformConfig } from '../types';
import { DatabaseService } from '../db/database';

export class WebhookHandler {
  private config: PlatformConfig;
  private db: DatabaseService;

  constructor(config: PlatformConfig, db: DatabaseService) {
    this.config = config;
    this.db = db;
  }

  async handleWebhook(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const eventType = request.headers['x-gitlab-event'] as string;

    if (!eventType) {
      reply.status(400).send({ error: 'Missing X-Gitlab-Event header' });
      return;
    }

    const event = request.body as WebhookEvent;

    console.log(`Received ${eventType} for project ${event.project?.id}`);

    try {
      if (eventType === 'Merge Request Hook' && event.object_attributes) {
        await this.handleMergeRequest(event);
      }

      reply.status(200).send({ status: 'ok' });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`Webhook error: ${errorMessage}`);
      reply.status(500).send({ error: errorMessage });
    }
  }

  private async handleMergeRequest(event: WebhookEvent): Promise<void> {
    const { object_attributes: mr, project } = event;
    if (!mr || !project) return;

    if (!['open', 'reopen', 'update'].includes(mr.action)) {
      return;
    }

    if (mr.state !== 'opened') {
      return;
    }

    const repo = this.db.findRepositoryByGitLabProjectId(project.id);
    if (!repo) {
      console.log(`Repository not found for project ${project.id}`);
      return;
    }

    if (!repo.scanEnabled) {
      console.log(`Scanning disabled for ${repo.pathWithNamespace}`);
      return;
    }

    const org = this.db.getOrganization(repo.organizationId);
    if (!org) {
      console.log(`Organization not found for repo ${repo.id}`);
      return;
    }

    console.log(`Queueing scan for MR !${mr.iid} in ${repo.pathWithNamespace}`);

    const jobId = crypto.randomUUID();

    this.db.createScanJob({
      id: jobId,
      repositoryId: repo.id,
      organizationId: org.id,
      mergeRequestIid: mr.iid,
      projectId: project.id,
      projectPath: repo.pathWithNamespace,
      sourceBranch: mr.source_branch,
      targetBranch: mr.target_branch,
      commitSha: mr.last_commit.id,
      status: 'queued',
    });

    console.log(`Job ${jobId} queued for MR !${mr.iid}`);
  }
}
