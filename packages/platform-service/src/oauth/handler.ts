import { FastifyRequest, FastifyReply } from 'fastify';
import * as crypto from 'crypto';
import { PlatformConfig, GitLabOAuthTokenResponse, GitLabGroup } from '../types';
import { DatabaseService } from '../db/database';

export class OAuthHandler {
  private config: PlatformConfig;
  private db: DatabaseService;

  constructor(config: PlatformConfig, db: DatabaseService) {
    this.config = config;
    this.db = db;
  }

  getAuthorizationUrl(gitlabUrl: string, state: string): string {
    const params = new URLSearchParams({
      client_id: this.config.gitlab.appId,
      redirect_uri: this.config.gitlab.callbackUrl,
      response_type: 'code',
      scope: 'api read_user read_repository',
      state,
    });

    return `${gitlabUrl}/oauth/authorize?${params.toString()}`;
  }

  async handleCallback(
    request: FastifyRequest<{
      Querystring: { code: string; state: string };
    }>,
    reply: FastifyReply
  ): Promise<void> {
    const { code, state } = request.query;

    if (!code || !state) {
      reply.status(400).send({ error: 'Missing code or state parameter' });
      return;
    }

    try {
      const stateData = JSON.parse(Buffer.from(state, 'base64').toString());
      const gitlabUrl = stateData.gitlabUrl || 'https://gitlab.com';

      const tokenResponse = await this.exchangeCodeForToken(gitlabUrl, code);

      const groups = await this.fetchUserGroups(gitlabUrl, tokenResponse.access_token);

      if (groups.length === 0) {
        reply.type('text/html').send(this.renderErrorPage('No groups found',
          'Your GitLab account does not have maintainer access to any groups. Please ensure you have at least Maintainer role in a group.'));
        return;
      }

      if (groups.length === 1) {
        const result = await this.connectGroup(
          gitlabUrl,
          groups[0],
          tokenResponse.access_token,
          tokenResponse.refresh_token,
          tokenResponse.created_at,
          tokenResponse.expires_in
        );
        reply.type('text/html').send(this.renderSuccessPage(result));
        return;
      }

      const pendingId = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

      this.db.createPendingConnection({
        id: pendingId,
        gitlabUrl,
        accessToken: tokenResponse.access_token,
        refreshToken: tokenResponse.refresh_token,
        tokenExpiresAt: new Date((tokenResponse.created_at + tokenResponse.expires_in) * 1000),
        groups,
        expiresAt,
      });

      reply.redirect(`${this.config.baseUrl}/oauth/select-group?pending=${pendingId}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('OAuth callback error:', errorMessage);
      reply.type('text/html').send(this.renderErrorPage('Connection Failed', errorMessage));
    }
  }

  async handleGroupSelection(
    request: FastifyRequest<{
      Querystring: { pending: string };
    }>,
    reply: FastifyReply
  ): Promise<void> {
    const { pending } = request.query;

    if (!pending) {
      reply.status(400).send({ error: 'Missing pending parameter' });
      return;
    }

    const connection = this.db.getPendingConnection(pending);
    if (!connection) {
      reply.type('text/html').send(this.renderErrorPage('Session Expired',
        'Your session has expired. Please start the connection process again.'));
      return;
    }

    reply.type('text/html').send(this.renderGroupSelectionPage(pending, connection.groups));
  }

  async handleGroupSelectionSubmit(
    request: FastifyRequest<{
      Body: { pending: string; groupId: string };
    }>,
    reply: FastifyReply
  ): Promise<void> {
    const { pending, groupId } = request.body;

    if (!pending || !groupId) {
      reply.status(400).send({ error: 'Missing required parameters' });
      return;
    }

    const connection = this.db.getPendingConnection(pending);
    if (!connection) {
      reply.type('text/html').send(this.renderErrorPage('Session Expired',
        'Your session has expired. Please start the connection process again.'));
      return;
    }

    const selectedGroup = connection.groups.find((g) => g.id === parseInt(groupId, 10));
    if (!selectedGroup) {
      reply.status(400).send({ error: 'Invalid group selection' });
      return;
    }

    try {
      const result = await this.connectGroup(
        connection.gitlabUrl,
        selectedGroup,
        connection.accessToken,
        connection.refreshToken,
        Math.floor(Date.now() / 1000),
        Math.floor((connection.tokenExpiresAt.getTime() - Date.now()) / 1000)
      );

      this.db.deletePendingConnection(pending);

      reply.type('text/html').send(this.renderSuccessPage(result));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      reply.type('text/html').send(this.renderErrorPage('Connection Failed', errorMessage));
    }
  }

  private async connectGroup(
    gitlabUrl: string,
    group: GitLabGroup,
    accessToken: string,
    refreshToken: string,
    createdAt: number,
    expiresIn: number
  ): Promise<{ status: 'created' | 'updated'; groupPath: string; id: number }> {
    const existing = this.db.getOrganizationByGroupId(group.id);
    if (existing) {
      this.db.updateOrganizationToken(
        existing.id,
        accessToken,
        refreshToken,
        new Date((createdAt + expiresIn) * 1000)
      );
      return { status: 'updated', groupPath: group.full_path, id: existing.id };
    }

    const orgId = this.db.createOrganization({
      gitlabGroupId: group.id,
      gitlabGroupPath: group.full_path,
      gitlabUrl,
      accessToken,
      refreshToken,
      tokenExpiresAt: new Date((createdAt + expiresIn) * 1000),
      status: 'active',
    });

    return { status: 'created', groupPath: group.full_path, id: orgId };
  }

  private async exchangeCodeForToken(gitlabUrl: string, code: string): Promise<GitLabOAuthTokenResponse> {
    const response = await fetch(`${gitlabUrl}/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: this.config.gitlab.appId,
        client_secret: this.config.gitlab.appSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: this.config.gitlab.callbackUrl,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Token exchange failed: ${text}`);
    }

    return response.json() as Promise<GitLabOAuthTokenResponse>;
  }

  async refreshToken(organization: { id: number; gitlabUrl: string; refreshToken: string }): Promise<string> {
    const response = await fetch(`${organization.gitlabUrl}/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: this.config.gitlab.appId,
        client_secret: this.config.gitlab.appSecret,
        refresh_token: organization.refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    if (!response.ok) {
      throw new Error('Token refresh failed');
    }

    const tokenResponse = (await response.json()) as GitLabOAuthTokenResponse;

    this.db.updateOrganizationToken(
      organization.id,
      tokenResponse.access_token,
      tokenResponse.refresh_token,
      new Date((tokenResponse.created_at + tokenResponse.expires_in) * 1000)
    );

    return tokenResponse.access_token;
  }

  private async fetchUserGroups(gitlabUrl: string, accessToken: string): Promise<GitLabGroup[]> {
    const response = await fetch(`${gitlabUrl}/api/v4/groups?min_access_level=40&top_level_only=true`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch groups');
    }

    return response.json() as Promise<GitLabGroup[]>;
  }

  private renderGroupSelectionPage(pendingId: string, groups: GitLabGroup[]): string {
    const groupOptions = groups
      .map(
        (g) => `
        <label class="group-option">
          <input type="radio" name="groupId" value="${g.id}" required>
          <div class="group-info">
            <span class="group-name">${this.escapeHtml(g.full_name)}</span>
            <span class="group-path">${this.escapeHtml(g.full_path)}</span>
          </div>
        </label>
      `
      )
      .join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Select GitLab Group - Qualys</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      background: white;
      border-radius: 12px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      padding: 40px;
      max-width: 500px;
      width: 100%;
    }
    .logo {
      text-align: center;
      margin-bottom: 24px;
    }
    .logo svg {
      width: 48px;
      height: 48px;
      fill: #667eea;
    }
    h1 {
      font-size: 24px;
      color: #1a1a2e;
      text-align: center;
      margin-bottom: 8px;
    }
    .subtitle {
      color: #666;
      text-align: center;
      margin-bottom: 32px;
    }
    .group-option {
      display: flex;
      align-items: center;
      padding: 16px;
      border: 2px solid #e0e0e0;
      border-radius: 8px;
      margin-bottom: 12px;
      cursor: pointer;
      transition: all 0.2s;
    }
    .group-option:hover {
      border-color: #667eea;
      background: #f8f9ff;
    }
    .group-option input[type="radio"] {
      width: 20px;
      height: 20px;
      margin-right: 16px;
      accent-color: #667eea;
    }
    .group-option input[type="radio"]:checked + .group-info {
      color: #667eea;
    }
    .group-info {
      display: flex;
      flex-direction: column;
    }
    .group-name {
      font-weight: 600;
      color: #1a1a2e;
    }
    .group-path {
      font-size: 14px;
      color: #888;
    }
    button {
      width: 100%;
      padding: 16px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      margin-top: 24px;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    button:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
    }
    button:disabled {
      opacity: 0.6;
      cursor: not-allowed;
      transform: none;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
      </svg>
    </div>
    <h1>Select a GitLab Group</h1>
    <p class="subtitle">Choose which group to connect for container scanning</p>

    <form method="POST" action="/oauth/select-group">
      <input type="hidden" name="pending" value="${pendingId}">
      ${groupOptions}
      <button type="submit">Connect Selected Group</button>
    </form>
  </div>
</body>
</html>`;
  }

  private renderSuccessPage(result: { status: string; groupPath: string; id: number }): string {
    const message = result.status === 'created'
      ? 'Your GitLab group has been connected successfully.'
      : 'Your GitLab group connection has been updated.';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Connected - Qualys</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      background: white;
      border-radius: 12px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      padding: 40px;
      max-width: 500px;
      width: 100%;
      text-align: center;
    }
    .success-icon {
      width: 64px;
      height: 64px;
      background: #10b981;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 24px;
    }
    .success-icon svg {
      width: 32px;
      height: 32px;
      fill: white;
    }
    h1 {
      font-size: 24px;
      color: #1a1a2e;
      margin-bottom: 8px;
    }
    .message {
      color: #666;
      margin-bottom: 16px;
    }
    .group-path {
      background: #f3f4f6;
      padding: 12px 20px;
      border-radius: 8px;
      font-family: monospace;
      color: #667eea;
      margin-bottom: 24px;
    }
    .next-steps {
      text-align: left;
      background: #f8f9ff;
      padding: 20px;
      border-radius: 8px;
      margin-bottom: 24px;
    }
    .next-steps h3 {
      font-size: 14px;
      color: #667eea;
      margin-bottom: 12px;
    }
    .next-steps ul {
      padding-left: 20px;
      color: #666;
    }
    .next-steps li {
      margin-bottom: 8px;
    }
    a.button {
      display: inline-block;
      padding: 12px 24px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      text-decoration: none;
      border-radius: 8px;
      font-weight: 600;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="success-icon">
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/>
      </svg>
    </div>
    <h1>Successfully Connected!</h1>
    <p class="message">${message}</p>
    <div class="group-path">${this.escapeHtml(result.groupPath)}</div>

    <div class="next-steps">
      <h3>What happens next:</h3>
      <ul>
        <li>All repositories in this group will be discovered</li>
        <li>Webhooks will be registered automatically</li>
        <li>Merge requests will trigger container scans</li>
        <li>New repositories are discovered every hour</li>
      </ul>
    </div>

    <a href="/api/organizations/${result.id}" class="button">View Organization</a>
  </div>
</body>
</html>`;
  }

  private renderErrorPage(title: string, message: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Error - Qualys</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      background: white;
      border-radius: 12px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      padding: 40px;
      max-width: 500px;
      width: 100%;
      text-align: center;
    }
    .error-icon {
      width: 64px;
      height: 64px;
      background: #ef4444;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 24px;
    }
    .error-icon svg {
      width: 32px;
      height: 32px;
      fill: white;
    }
    h1 {
      font-size: 24px;
      color: #1a1a2e;
      margin-bottom: 8px;
    }
    .message {
      color: #666;
      margin-bottom: 24px;
    }
    a.button {
      display: inline-block;
      padding: 12px 24px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      text-decoration: none;
      border-radius: 8px;
      font-weight: 600;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="error-icon">
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"/>
      </svg>
    </div>
    <h1>${this.escapeHtml(title)}</h1>
    <p class="message">${this.escapeHtml(message)}</p>
    <a href="/oauth/connect" class="button">Try Again</a>
  </div>
</body>
</html>`;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
