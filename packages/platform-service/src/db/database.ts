import * as fs from 'fs';
import * as path from 'path';
import { Organization, Repository, ScanRecord, ScanResult, PendingConnection, ScanJob } from '../types';

interface DatabaseData {
  organizations: Organization[];
  repositories: Repository[];
  scans: ScanRecord[];
  pendingConnections: PendingConnection[];
  scanJobs: ScanJob[];
  nextIds: {
    organization: number;
    repository: number;
    scan: number;
  };
}

export class DatabaseService {
  private dbPath: string;
  private data: DatabaseData;

  constructor(dbPath: string) {
    this.dbPath = dbPath;

    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.data = this.load();
  }

  private load(): DatabaseData {
    if (fs.existsSync(this.dbPath)) {
      const content = fs.readFileSync(this.dbPath, 'utf-8');
      const parsed = JSON.parse(content);
      return {
        ...parsed,
        organizations: (parsed.organizations || []).map(this.parseOrganization),
        repositories: (parsed.repositories || []).map(this.parseRepository),
        scans: (parsed.scans || []).map(this.parseScan),
        pendingConnections: (parsed.pendingConnections || []).map(this.parsePendingConnection),
        scanJobs: (parsed.scanJobs || []).map(this.parseScanJob),
      };
    }

    return {
      organizations: [],
      repositories: [],
      scans: [],
      pendingConnections: [],
      scanJobs: [],
      nextIds: { organization: 1, repository: 1, scan: 1 },
    };
  }

  private save(): void {
    fs.writeFileSync(this.dbPath, JSON.stringify(this.data, null, 2));
  }

  private parseOrganization(org: Record<string, unknown>): Organization {
    return {
      ...org,
      createdAt: new Date(org.createdAt as string),
      updatedAt: new Date(org.updatedAt as string),
      lastSyncAt: org.lastSyncAt ? new Date(org.lastSyncAt as string) : undefined,
      tokenExpiresAt: org.tokenExpiresAt ? new Date(org.tokenExpiresAt as string) : undefined,
    } as Organization;
  }

  private parseRepository(repo: Record<string, unknown>): Repository {
    return {
      ...repo,
      createdAt: new Date(repo.createdAt as string),
      updatedAt: new Date(repo.updatedAt as string),
      lastScanAt: repo.lastScanAt ? new Date(repo.lastScanAt as string) : undefined,
    } as Repository;
  }

  private parseScan(scan: Record<string, unknown>): ScanRecord {
    return {
      ...scan,
      createdAt: new Date(scan.createdAt as string),
      startedAt: scan.startedAt ? new Date(scan.startedAt as string) : undefined,
      completedAt: scan.completedAt ? new Date(scan.completedAt as string) : undefined,
    } as ScanRecord;
  }

  private parsePendingConnection(conn: Record<string, unknown>): PendingConnection {
    return {
      ...conn,
      tokenExpiresAt: new Date(conn.tokenExpiresAt as string),
      createdAt: new Date(conn.createdAt as string),
      expiresAt: new Date(conn.expiresAt as string),
    } as PendingConnection;
  }

  private parseScanJob(job: Record<string, unknown>): ScanJob {
    return {
      ...job,
      createdAt: new Date(job.createdAt as string),
      startedAt: job.startedAt ? new Date(job.startedAt as string) : undefined,
      completedAt: job.completedAt ? new Date(job.completedAt as string) : undefined,
    } as ScanJob;
  }

  createOrganization(org: Omit<Organization, 'id' | 'createdAt' | 'updatedAt'>): number {
    const id = this.data.nextIds.organization++;
    const now = new Date();

    this.data.organizations.push({
      ...org,
      id,
      createdAt: now,
      updatedAt: now,
    });

    this.save();
    return id;
  }

  getOrganization(id: number): Organization | null {
    return this.data.organizations.find((o) => o.id === id) || null;
  }

  getOrganizationByGroupId(gitlabGroupId: number): Organization | null {
    return this.data.organizations.find((o) => o.gitlabGroupId === gitlabGroupId) || null;
  }

  getAllOrganizations(): Organization[] {
    return this.data.organizations.filter((o) => o.status === 'active');
  }

  updateOrganizationToken(id: number, accessToken: string, refreshToken?: string, expiresAt?: Date): void {
    const org = this.data.organizations.find((o) => o.id === id);
    if (org) {
      org.accessToken = accessToken;
      org.refreshToken = refreshToken;
      org.tokenExpiresAt = expiresAt;
      org.updatedAt = new Date();
      this.save();
    }
  }

  updateOrganizationSyncTime(id: number): void {
    const org = this.data.organizations.find((o) => o.id === id);
    if (org) {
      org.lastSyncAt = new Date();
      org.updatedAt = new Date();
      this.save();
    }
  }

  deleteOrganization(id: number): void {
    const repoIds = this.data.repositories.filter((r) => r.organizationId === id).map((r) => r.id);
    this.data.scans = this.data.scans.filter((s) => !repoIds.includes(s.repositoryId));
    this.data.repositories = this.data.repositories.filter((r) => r.organizationId !== id);
    this.data.organizations = this.data.organizations.filter((o) => o.id !== id);
    this.save();
  }

  upsertRepository(repo: Omit<Repository, 'id' | 'createdAt' | 'updatedAt'>): number {
    const existing = this.data.repositories.find(
      (r) => r.organizationId === repo.organizationId && r.gitlabProjectId === repo.gitlabProjectId
    );

    if (existing) {
      existing.name = repo.name;
      existing.pathWithNamespace = repo.pathWithNamespace;
      existing.webUrl = repo.webUrl;
      existing.defaultBranch = repo.defaultBranch;
      existing.updatedAt = new Date();
      this.save();
      return existing.id;
    }

    const id = this.data.nextIds.repository++;
    const now = new Date();

    this.data.repositories.push({
      ...repo,
      id,
      createdAt: now,
      updatedAt: now,
    });

    this.save();
    return id;
  }

  getRepository(id: number): Repository | null {
    return this.data.repositories.find((r) => r.id === id) || null;
  }

  getRepositoryByProjectId(organizationId: number, gitlabProjectId: number): Repository | null {
    return (
      this.data.repositories.find(
        (r) => r.organizationId === organizationId && r.gitlabProjectId === gitlabProjectId
      ) || null
    );
  }

  findRepositoryByGitLabProjectId(gitlabProjectId: number): Repository | null {
    return this.data.repositories.find((r) => r.gitlabProjectId === gitlabProjectId) || null;
  }

  getRepositoriesByOrganization(organizationId: number): Repository[] {
    return this.data.repositories.filter((r) => r.organizationId === organizationId);
  }

  getRepositoriesPendingWebhook(organizationId: number): Repository[] {
    return this.data.repositories.filter(
      (r) => r.organizationId === organizationId && r.webhookStatus === 'pending' && r.scanEnabled
    );
  }

  updateRepositoryWebhook(id: number, webhookId: number, status: Repository['webhookStatus']): void {
    const repo = this.data.repositories.find((r) => r.id === id);
    if (repo) {
      repo.webhookId = webhookId;
      repo.webhookStatus = status;
      repo.updatedAt = new Date();
      this.save();
    }
  }

  updateRepositoryScanTime(id: number): void {
    const repo = this.data.repositories.find((r) => r.id === id);
    if (repo) {
      repo.lastScanAt = new Date();
      repo.updatedAt = new Date();
      this.save();
    }
  }

  createScan(scan: Omit<ScanRecord, 'id' | 'createdAt'>): number {
    const id = this.data.nextIds.scan++;
    const now = new Date();

    this.data.scans.push({
      ...scan,
      id,
      createdAt: now,
    });

    this.save();
    return id;
  }

  updateScanStatus(id: number, status: ScanRecord['status'], result?: ScanResult): void {
    const scan = this.data.scans.find((s) => s.id === id);
    if (scan) {
      scan.status = status;
      if (status === 'running') {
        scan.startedAt = new Date();
      } else if (status === 'completed' || status === 'failed') {
        scan.completedAt = new Date();
        scan.result = result;
      }
      this.save();
    }
  }

  getScan(id: number): ScanRecord | null {
    return this.data.scans.find((s) => s.id === id) || null;
  }

  getRecentScans(repositoryId: number, limit: number = 10): ScanRecord[] {
    return this.data.scans
      .filter((s) => s.repositoryId === repositoryId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  close(): void {
  }

  createPendingConnection(conn: Omit<PendingConnection, 'createdAt'>): void {
    this.cleanupExpiredConnections();

    this.data.pendingConnections.push({
      ...conn,
      createdAt: new Date(),
    });
    this.save();
  }

  getPendingConnection(id: string): PendingConnection | null {
    const conn = this.data.pendingConnections.find((c) => c.id === id);
    if (conn && conn.expiresAt > new Date()) {
      return conn;
    }
    return null;
  }

  deletePendingConnection(id: string): void {
    this.data.pendingConnections = this.data.pendingConnections.filter((c) => c.id !== id);
    this.save();
  }

  private cleanupExpiredConnections(): void {
    const now = new Date();
    this.data.pendingConnections = this.data.pendingConnections.filter((c) => c.expiresAt > now);
  }

  createScanJob(job: Omit<ScanJob, 'createdAt'>): void {
    this.data.scanJobs.push({
      ...job,
      createdAt: new Date(),
    });
    this.save();
  }

  getScanJob(id: string): ScanJob | null {
    return this.data.scanJobs.find((j) => j.id === id) || null;
  }

  getNextQueuedJob(): ScanJob | null {
    return this.data.scanJobs
      .filter((j) => j.status === 'queued')
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0] || null;
  }

  getQueuedJobCount(): number {
    return this.data.scanJobs.filter((j) => j.status === 'queued').length;
  }

  getProcessingJobs(): ScanJob[] {
    return this.data.scanJobs.filter((j) => j.status === 'processing');
  }

  updateScanJobStatus(
    id: string,
    status: ScanJob['status'],
    result?: ScanResult,
    error?: string
  ): void {
    const job = this.data.scanJobs.find((j) => j.id === id);
    if (job) {
      job.status = status;
      if (status === 'processing') {
        job.startedAt = new Date();
      } else if (status === 'completed' || status === 'failed') {
        job.completedAt = new Date();
        job.result = result;
        job.error = error;
      }
      this.save();
    }
  }

  cleanupOldJobs(maxAgeHours: number = 24): void {
    const cutoff = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000);
    this.data.scanJobs = this.data.scanJobs.filter(
      (j) => j.status === 'queued' || j.status === 'processing' || j.createdAt > cutoff
    );
    this.save();
  }
}
