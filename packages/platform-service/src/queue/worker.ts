import { PlatformConfig, ScanJob, ScanResult } from '../types';
import { DatabaseService } from '../db/database';
import { ScannerService } from '../handlers/scanner';
import { CommentService } from '../handlers/comments';

export class ScanWorker {
  private config: PlatformConfig;
  private db: DatabaseService;
  private scanner: ScannerService;
  private comments: CommentService;
  private running: boolean = false;
  private pollInterval: NodeJS.Timeout | null = null;
  private maxConcurrent: number;
  private processingCount: number = 0;

  constructor(
    config: PlatformConfig,
    db: DatabaseService,
    scanner: ScannerService,
    comments: CommentService,
    maxConcurrent: number = 2
  ) {
    this.config = config;
    this.db = db;
    this.scanner = scanner;
    this.comments = comments;
    this.maxConcurrent = maxConcurrent;
  }

  start(): void {
    if (this.running) return;

    this.running = true;
    console.log(`[ScanWorker] Started with max ${this.maxConcurrent} concurrent jobs`);

    this.pollInterval = setInterval(() => this.poll(), 5000);

    this.poll();

    setInterval(() => this.db.cleanupOldJobs(24), 60 * 60 * 1000);
  }

  stop(): void {
    this.running = false;
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    console.log('[ScanWorker] Stopped');
  }

  private async poll(): Promise<void> {
    if (!this.running) return;

    while (this.processingCount < this.maxConcurrent) {
      const job = this.db.getNextQueuedJob();
      if (!job) break;

      this.db.updateScanJobStatus(job.id, 'processing');
      this.processingCount++;

      this.processJob(job).finally(() => {
        this.processingCount--;
      });
    }
  }

  private async processJob(job: ScanJob): Promise<void> {
    console.log(`[ScanWorker] Processing job ${job.id} for ${job.projectPath} MR !${job.mergeRequestIid}`);

    const org = this.db.getOrganization(job.organizationId);
    if (!org) {
      this.db.updateScanJobStatus(job.id, 'failed', undefined, 'Organization not found');
      return;
    }

    const repo = this.db.getRepository(job.repositoryId);
    if (!repo) {
      this.db.updateScanJobStatus(job.id, 'failed', undefined, 'Repository not found');
      return;
    }

    try {
      await this.comments.postScanningComment(
        org.gitlabUrl,
        org.accessToken,
        job.projectId,
        job.mergeRequestIid
      );

      const registryUrl = org.gitlabUrl.replace('https://', 'registry.');
      const imageName = `${registryUrl}/${job.projectPath}:${job.commitSha}`;

      const result = await this.scanner.scanImage(imageName);

      this.db.updateScanJobStatus(job.id, 'completed', result);

      this.db.updateRepositoryScanTime(job.repositoryId);

      await this.comments.postResultComment(
        org.gitlabUrl,
        org.accessToken,
        job.projectId,
        job.mergeRequestIid,
        job.sourceBranch,
        job.targetBranch,
        imageName,
        result
      );

      console.log(`[ScanWorker] Job ${job.id} completed: ${result.passed ? 'PASSED' : 'FAILED'}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[ScanWorker] Job ${job.id} failed:`, errorMessage);

      this.db.updateScanJobStatus(job.id, 'failed', undefined, errorMessage);

      try {
        await this.comments.postErrorComment(
          org.gitlabUrl,
          org.accessToken,
          job.projectId,
          job.mergeRequestIid,
          errorMessage
        );
      } catch (commentError) {
        console.error('[ScanWorker] Failed to post error comment:', commentError);
      }
    }
  }

  getStatus(): { running: boolean; processing: number; queued: number } {
    return {
      running: this.running,
      processing: this.processingCount,
      queued: this.db.getQueuedJobCount(),
    };
  }
}
