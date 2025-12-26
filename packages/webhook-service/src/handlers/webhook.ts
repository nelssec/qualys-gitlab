import * as crypto from 'crypto';
import { FastifyRequest, FastifyReply } from 'fastify';
import { GitLabMergeRequestEvent, WebhookConfig } from '../types';
import { GitLabClient } from '../gitlab/client';
import { ScannerService } from '../scanner/service';
import {
  formatScanComment,
  formatScanStartedComment,
  formatScanErrorComment,
  isQualysScanComment,
} from '../gitlab/comment';

export class WebhookHandler {
  private config: WebhookConfig;
  private gitlabClient: GitLabClient;
  private scannerService: ScannerService;

  constructor(config: WebhookConfig) {
    this.config = config;
    this.gitlabClient = new GitLabClient({
      baseUrl: config.gitlab.baseUrl,
      token: config.gitlab.token,
    });
    this.scannerService = new ScannerService(config);
  }

  async handleWebhook(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const eventType = request.headers['x-gitlab-event'] as string;

    if (!eventType) {
      reply.status(400).send({ error: 'Missing X-Gitlab-Event header' });
      return;
    }

    if (this.config.webhookSecret) {
      const signature = request.headers['x-gitlab-token'] as string;
      if (signature !== this.config.webhookSecret) {
        reply.status(401).send({ error: 'Invalid webhook token' });
        return;
      }
    }

    console.log(`Received webhook event: ${eventType}`);

    try {
      switch (eventType) {
        case 'Merge Request Hook':
          await this.handleMergeRequestEvent(request.body as GitLabMergeRequestEvent);
          break;
        default:
      }

      reply.status(200).send({ status: 'ok' });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`Webhook error: ${errorMessage}`);
      reply.status(500).send({ error: errorMessage });
    }
  }

  private async handleMergeRequestEvent(event: GitLabMergeRequestEvent): Promise<void> {
    const { object_attributes: mr, project } = event;

    if (!['open', 'reopen', 'update'].includes(mr.action)) {
      return;
    }

    if (mr.state !== 'opened') {
      return;
    }

    console.log(`Processing MR !${mr.iid} in ${project.path_with_namespace}`);
    console.log(`  Branch: ${mr.source_branch} -> ${mr.target_branch}`);
    console.log(`  Commit: ${mr.last_commit.id}`);

    const existingNoteId = await this.findExistingComment(project.id, mr.iid);

    const imageId = await this.discoverImage(project, mr.source_branch, mr.last_commit.id);

    if (!imageId) {
      console.log('No container image found for this project, skipping scan');
      return;
    }

    const startedComment = formatScanStartedComment(mr.source_branch, mr.target_branch, imageId);

    if (existingNoteId) {
      await this.gitlabClient.updateMRNote(project.id, mr.iid, existingNoteId, startedComment);
    } else {
      await this.gitlabClient.createMRNote({
        projectId: project.id,
        mergeRequestIid: mr.iid,
        body: startedComment,
      });
    }

    try {
      const result = await this.scannerService.scanImage(imageId);

      const resultComment = formatScanComment(result, mr.source_branch, mr.target_branch, imageId);

      const noteId = existingNoteId || (await this.findExistingComment(project.id, mr.iid));
      if (noteId) {
        await this.gitlabClient.updateMRNote(project.id, mr.iid, noteId, resultComment);
      } else {
        await this.gitlabClient.createMRNote({
          projectId: project.id,
          mergeRequestIid: mr.iid,
          body: resultComment,
        });
      }

      console.log(`Scan completed for MR !${mr.iid}: ${result.passed ? 'PASSED' : 'FAILED'}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorComment = formatScanErrorComment(mr.source_branch, mr.target_branch, errorMessage);

      const noteId = existingNoteId || (await this.findExistingComment(project.id, mr.iid));
      if (noteId) {
        await this.gitlabClient.updateMRNote(project.id, mr.iid, noteId, errorComment);
      } else {
        await this.gitlabClient.createMRNote({
          projectId: project.id,
          mergeRequestIid: mr.iid,
          body: errorComment,
        });
      }

      console.error(`Scan failed for MR !${mr.iid}: ${errorMessage}`);
    }
  }

  private async findExistingComment(projectId: number, mergeRequestIid: number): Promise<number | null> {
    try {
      const notes = await this.gitlabClient.getMRNotes(projectId, mergeRequestIid);
      for (const note of notes) {
        if (isQualysScanComment(note.body)) {
          return note.id;
        }
      }
    } catch (error) {
      console.error('Failed to fetch MR notes:', error);
    }
    return null;
  }

  private async discoverImage(
    project: { id: number; path_with_namespace: string },
    branch: string,
    commitSha: string
  ): Promise<string | null> {
    try {
      const repos = await this.gitlabClient.getContainerRepositories(project.id);
      if (repos.length > 0) {
        const repo = repos[0];
        return `${repo.location}:${commitSha.substring(0, 8)}`;
      }
    } catch (error) {
    }

    const registryUrl = new URL(this.config.gitlab.baseUrl).hostname.replace('gitlab', 'registry');
    const imageName = `${registryUrl}/${project.path_with_namespace}:${commitSha.substring(0, 8)}`;

    return imageName;
  }
}
