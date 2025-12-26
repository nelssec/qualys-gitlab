export interface PlatformConfig {
  port: number;
  host: string;
  baseUrl: string;
  database: {
    path: string;
  };
  qualys: {
    accessToken: string;
    pod: string;
    skipTlsVerify?: boolean;
  };
  gitlab: {
    appId: string;
    appSecret: string;
    callbackUrl: string;
  };
  scan: {
    types: string[];
    timeout: number;
    failOnSeverity: number;
  };
  sync: {
    intervalMinutes: number;
  };
}

export interface Organization {
  id: number;
  gitlabGroupId: number;
  gitlabGroupPath: string;
  gitlabUrl: string;
  accessToken: string;
  refreshToken?: string;
  tokenExpiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  lastSyncAt?: Date;
  status: 'active' | 'inactive' | 'error';
}

export interface Repository {
  id: number;
  organizationId: number;
  gitlabProjectId: number;
  name: string;
  pathWithNamespace: string;
  webUrl: string;
  defaultBranch: string;
  webhookId?: number;
  webhookStatus: 'pending' | 'active' | 'failed';
  scanEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastScanAt?: Date;
}

export interface ScanRecord {
  id: number;
  repositoryId: number;
  mergeRequestIid: number;
  commitSha: string;
  sourceBranch: string;
  targetBranch: string;
  imageId?: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: ScanResult;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

export interface ScanResult {
  passed: boolean;
  summary: {
    total: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    informational: number;
  };
  policyResult: 'ALLOW' | 'DENY' | 'AUDIT' | 'NONE';
  failureReasons: string[];
}

export interface GitLabOAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  created_at: number;
  scope: string;
}

export interface GitLabGroup {
  id: number;
  name: string;
  path: string;
  full_name: string;
  full_path: string;
  web_url: string;
  parent_id?: number;
}

export interface GitLabProject {
  id: number;
  name: string;
  path: string;
  path_with_namespace: string;
  web_url: string;
  default_branch: string;
  namespace: {
    id: number;
    name: string;
    path: string;
    kind: string;
    full_path: string;
  };
}

export interface GitLabWebhook {
  id: number;
  url: string;
  project_id: number;
  push_events: boolean;
  merge_requests_events: boolean;
  created_at: string;
}

export interface WebhookEvent {
  object_kind: string;
  event_type?: string;
  project: {
    id: number;
    path_with_namespace: string;
  };
  object_attributes?: {
    iid: number;
    action: string;
    state: string;
    source_branch: string;
    target_branch: string;
    last_commit: {
      id: string;
    };
  };
}

export interface PendingConnection {
  id: string;
  gitlabUrl: string;
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: Date;
  groups: GitLabGroup[];
  createdAt: Date;
  expiresAt: Date;
}

export interface ScanJob {
  id: string;
  repositoryId: number;
  organizationId: number;
  mergeRequestIid: number;
  projectId: number;
  projectPath: string;
  sourceBranch: string;
  targetBranch: string;
  commitSha: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  result?: ScanResult;
  error?: string;
}
