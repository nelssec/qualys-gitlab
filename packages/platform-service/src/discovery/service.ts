import { Organization, GitLabProject, Repository } from '../types';
import { DatabaseService } from '../db/database';

export class DiscoveryService {
  private db: DatabaseService;

  constructor(db: DatabaseService) {
    this.db = db;
  }

  async discoverRepositories(organization: Organization): Promise<Repository[]> {
    console.log(`Discovering repositories for ${organization.gitlabGroupPath}...`);

    const projects = await this.fetchAllProjects(organization);
    console.log(`Found ${projects.length} projects in ${organization.gitlabGroupPath}`);

    const repositories: Repository[] = [];

    for (const project of projects) {
      const repoId = this.db.upsertRepository({
        organizationId: organization.id,
        gitlabProjectId: project.id,
        name: project.name,
        pathWithNamespace: project.path_with_namespace,
        webUrl: project.web_url,
        defaultBranch: project.default_branch || 'main',
        webhookStatus: 'pending',
        scanEnabled: true,
      });

      const repo = this.db.getRepository(repoId);
      if (repo) {
        repositories.push(repo);
      }
    }

    this.db.updateOrganizationSyncTime(organization.id);

    return repositories;
  }

  private async fetchAllProjects(organization: Organization): Promise<GitLabProject[]> {
    const allProjects: GitLabProject[] = [];
    let page = 1;
    const perPage = 100;

    while (true) {
      const url = `${organization.gitlabUrl}/api/v4/groups/${organization.gitlabGroupId}/projects?include_subgroups=true&per_page=${perPage}&page=${page}`;

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${organization.accessToken}`,
        },
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Access token expired or invalid');
        }
        throw new Error(`Failed to fetch projects: ${response.status}`);
      }

      const projects = (await response.json()) as GitLabProject[];
      allProjects.push(...projects);

      const totalPages = parseInt(response.headers.get('x-total-pages') || '1', 10);
      if (page >= totalPages) {
        break;
      }

      page++;
    }

    return allProjects;
  }

  async getDiscoveryStats(organizationId: number): Promise<{
    total: number;
    withWebhook: number;
    pendingWebhook: number;
    scanEnabled: number;
  }> {
    const repos = this.db.getRepositoriesByOrganization(organizationId);

    return {
      total: repos.length,
      withWebhook: repos.filter((r) => r.webhookStatus === 'active').length,
      pendingWebhook: repos.filter((r) => r.webhookStatus === 'pending').length,
      scanEnabled: repos.filter((r) => r.scanEnabled).length,
    };
  }
}
