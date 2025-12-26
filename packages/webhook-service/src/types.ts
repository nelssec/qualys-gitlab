export interface WebhookConfig {
  port: number;
  host: string;
  webhookSecret?: string;
  qualys: {
    accessToken: string;
    pod: string;
    skipTlsVerify?: boolean;
    proxy?: string;
  };
  gitlab: {
    baseUrl: string;
    token: string;
  };
  scan: {
    types: string[];
    timeout: number;
    failOnSeverity: number;
  };
}

export interface GitLabMergeRequestEvent {
  object_kind: 'merge_request';
  event_type: string;
  user: GitLabUser;
  project: GitLabProject;
  object_attributes: GitLabMergeRequestAttributes;
  labels: GitLabLabel[];
  changes: Record<string, unknown>;
  repository: GitLabRepository;
}

export interface GitLabPushEvent {
  object_kind: 'push';
  event_name: string;
  before: string;
  after: string;
  ref: string;
  checkout_sha: string;
  user_id: number;
  user_name: string;
  user_email: string;
  project: GitLabProject;
  repository: GitLabRepository;
  commits: GitLabCommit[];
}

export interface GitLabUser {
  id: number;
  name: string;
  username: string;
  email?: string;
  avatar_url?: string;
}

export interface GitLabProject {
  id: number;
  name: string;
  description: string;
  web_url: string;
  git_ssh_url: string;
  git_http_url: string;
  namespace: string;
  visibility_level: number;
  path_with_namespace: string;
  default_branch: string;
  homepage: string;
  url: string;
  ssh_url: string;
  http_url: string;
}

export interface GitLabRepository {
  name: string;
  url: string;
  description: string;
  homepage: string;
}

export interface GitLabMergeRequestAttributes {
  id: number;
  iid: number;
  title: string;
  description: string;
  state: 'opened' | 'closed' | 'merged';
  action: 'open' | 'close' | 'reopen' | 'update' | 'merge' | 'approved' | 'unapproved';
  source_branch: string;
  target_branch: string;
  source_project_id: number;
  target_project_id: number;
  author_id: number;
  assignee_id?: number;
  created_at: string;
  updated_at: string;
  last_commit: GitLabCommit;
  url: string;
  source: GitLabProject;
  target: GitLabProject;
}

export interface GitLabCommit {
  id: string;
  message: string;
  title: string;
  timestamp: string;
  url: string;
  author: {
    name: string;
    email: string;
  };
}

export interface GitLabLabel {
  id: number;
  title: string;
  color: string;
  description: string;
}

export interface ScanJob {
  id: string;
  projectId: number;
  mergeRequestIid: number;
  sourceRef: string;
  commitSha: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  result?: ScanJobResult;
}

export interface ScanJobResult {
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
  reportPath?: string;
  failureReasons: string[];
}

export interface MRCommentPayload {
  projectId: number;
  mergeRequestIid: number;
  body: string;
}
