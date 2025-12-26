import { Organization, Repository, ScanResult } from '../types';
import { DatabaseService } from '../db/database';

const COMMENT_MARKER = '<!-- qualys-scan-result -->';

export class GitLabCommentService {
  private db: DatabaseService;

  constructor(db: DatabaseService) {
    this.db = db;
  }

  async postScanStarted(
    org: Organization,
    repo: Repository,
    mrIid: number,
    sourceBranch: string,
    targetBranch: string
  ): Promise<void> {
    const body = this.formatStartedComment(sourceBranch, targetBranch);
    await this.postOrUpdateComment(org, repo.gitlabProjectId, mrIid, body);
  }

  async postScanResult(
    org: Organization,
    repo: Repository,
    mrIid: number,
    sourceBranch: string,
    targetBranch: string,
    imageId: string,
    result: ScanResult
  ): Promise<void> {
    const body = this.formatResultComment(result, sourceBranch, targetBranch, imageId);
    await this.postOrUpdateComment(org, repo.gitlabProjectId, mrIid, body);
  }

  async postScanError(
    org: Organization,
    repo: Repository,
    mrIid: number,
    sourceBranch: string,
    targetBranch: string,
    error: string
  ): Promise<void> {
    const body = this.formatErrorComment(sourceBranch, targetBranch, error);
    await this.postOrUpdateComment(org, repo.gitlabProjectId, mrIid, body);
  }

  private async postOrUpdateComment(
    org: Organization,
    projectId: number,
    mrIid: number,
    body: string
  ): Promise<void> {
    const existingNoteId = await this.findExistingComment(org, projectId, mrIid);

    if (existingNoteId) {
      await this.updateComment(org, projectId, mrIid, existingNoteId, body);
    } else {
      await this.createComment(org, projectId, mrIid, body);
    }
  }

  private async findExistingComment(
    org: Organization,
    projectId: number,
    mrIid: number
  ): Promise<number | null> {
    const url = `${org.gitlabUrl}/api/v4/projects/${projectId}/merge_requests/${mrIid}/notes`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${org.accessToken}`,
      },
    });

    if (!response.ok) {
      return null;
    }

    const notes = (await response.json()) as Array<{ id: number; body: string }>;

    for (const note of notes) {
      if (note.body.includes(COMMENT_MARKER)) {
        return note.id;
      }
    }

    return null;
  }

  private async createComment(
    org: Organization,
    projectId: number,
    mrIid: number,
    body: string
  ): Promise<void> {
    const url = `${org.gitlabUrl}/api/v4/projects/${projectId}/merge_requests/${mrIid}/notes`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${org.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ body }),
    });

    if (!response.ok) {
      throw new Error(`Failed to create comment: ${response.status}`);
    }
  }

  private async updateComment(
    org: Organization,
    projectId: number,
    mrIid: number,
    noteId: number,
    body: string
  ): Promise<void> {
    const url = `${org.gitlabUrl}/api/v4/projects/${projectId}/merge_requests/${mrIid}/notes/${noteId}`;

    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${org.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ body }),
    });

    if (!response.ok) {
      throw new Error(`Failed to update comment: ${response.status}`);
    }
  }

  private formatStartedComment(sourceBranch: string, targetBranch: string): string {
    return `${COMMENT_MARKER}
## Qualys Security Scan

**Scan in progress...**

**Branch:** \`${sourceBranch}\` to \`${targetBranch}\`

---
*Powered by [Qualys Container Security](https://www.qualys.com/apps/container-security/)*
`;
  }

  private formatResultComment(
    result: ScanResult,
    sourceBranch: string,
    targetBranch: string,
    imageId: string
  ): string {
    const { summary, policyResult, passed, failureReasons } = result;
    const statusText = passed ? 'PASSED' : 'FAILED';

    let comment = `${COMMENT_MARKER}
## Qualys Security Scan Results

**Status:** ${statusText}

**Branch:** \`${sourceBranch}\` to \`${targetBranch}\`
**Image:** \`${imageId}\`

### Vulnerability Summary

| Severity | Count |
|----------|-------|
| Critical | ${summary.critical} |
| High | ${summary.high} |
| Medium | ${summary.medium} |
| Low | ${summary.low} |
| Informational | ${summary.informational} |
| **Total** | **${summary.total}** |
`;

    if (policyResult !== 'NONE') {
      comment += `
### Policy Evaluation

**Result:** ${policyResult}
`;
    }

    if (!passed && failureReasons.length > 0) {
      comment += `
### Failure Reasons

`;
      for (const reason of failureReasons) {
        comment += `- ${reason}\n`;
      }
    }

    comment += `
---
*Powered by [Qualys Container Security](https://www.qualys.com/apps/container-security/)*
`;

    return comment;
  }

  private formatErrorComment(sourceBranch: string, targetBranch: string, error: string): string {
    return `${COMMENT_MARKER}
## Qualys Security Scan

**Scan failed**

**Branch:** \`${sourceBranch}\` to \`${targetBranch}\`

**Error:** ${error}

---
*Powered by [Qualys Container Security](https://www.qualys.com/apps/container-security/)*
`;
  }

  async postScanningComment(
    gitlabUrl: string,
    accessToken: string,
    projectId: number,
    mrIid: number
  ): Promise<void> {
    const body = `${COMMENT_MARKER}
## Qualys Security Scan

**Scan queued...**

Your container image will be scanned shortly.

---
*Powered by [Qualys Container Security](https://www.qualys.com/apps/container-security/)*
`;
    await this.postOrUpdateCommentDirect(gitlabUrl, accessToken, projectId, mrIid, body);
  }

  async postResultComment(
    gitlabUrl: string,
    accessToken: string,
    projectId: number,
    mrIid: number,
    sourceBranch: string,
    targetBranch: string,
    imageId: string,
    result: ScanResult
  ): Promise<void> {
    const body = this.formatResultComment(result, sourceBranch, targetBranch, imageId);
    await this.postOrUpdateCommentDirect(gitlabUrl, accessToken, projectId, mrIid, body);
  }

  async postErrorComment(
    gitlabUrl: string,
    accessToken: string,
    projectId: number,
    mrIid: number,
    error: string
  ): Promise<void> {
    const body = `${COMMENT_MARKER}
## Qualys Security Scan

**Scan failed**

**Error:** ${error}

---
*Powered by [Qualys Container Security](https://www.qualys.com/apps/container-security/)*
`;
    await this.postOrUpdateCommentDirect(gitlabUrl, accessToken, projectId, mrIid, body);
  }

  private async postOrUpdateCommentDirect(
    gitlabUrl: string,
    accessToken: string,
    projectId: number,
    mrIid: number,
    body: string
  ): Promise<void> {
    const existingNoteId = await this.findExistingCommentDirect(gitlabUrl, accessToken, projectId, mrIid);

    if (existingNoteId) {
      await this.updateCommentDirect(gitlabUrl, accessToken, projectId, mrIid, existingNoteId, body);
    } else {
      await this.createCommentDirect(gitlabUrl, accessToken, projectId, mrIid, body);
    }
  }

  private async findExistingCommentDirect(
    gitlabUrl: string,
    accessToken: string,
    projectId: number,
    mrIid: number
  ): Promise<number | null> {
    const url = `${gitlabUrl}/api/v4/projects/${projectId}/merge_requests/${mrIid}/notes`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      return null;
    }

    const notes = (await response.json()) as Array<{ id: number; body: string }>;

    for (const note of notes) {
      if (note.body.includes(COMMENT_MARKER)) {
        return note.id;
      }
    }

    return null;
  }

  private async createCommentDirect(
    gitlabUrl: string,
    accessToken: string,
    projectId: number,
    mrIid: number,
    body: string
  ): Promise<void> {
    const url = `${gitlabUrl}/api/v4/projects/${projectId}/merge_requests/${mrIid}/notes`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ body }),
    });

    if (!response.ok) {
      throw new Error(`Failed to create comment: ${response.status}`);
    }
  }

  private async updateCommentDirect(
    gitlabUrl: string,
    accessToken: string,
    projectId: number,
    mrIid: number,
    noteId: number,
    body: string
  ): Promise<void> {
    const url = `${gitlabUrl}/api/v4/projects/${projectId}/merge_requests/${mrIid}/notes/${noteId}`;

    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ body }),
    });

    if (!response.ok) {
      throw new Error(`Failed to update comment: ${response.status}`);
    }
  }
}

export type CommentService = GitLabCommentService;
