import { MRCommentPayload } from '../types';

export interface GitLabClientConfig {
  baseUrl: string;
  token: string;
}

export class GitLabClient {
  private baseUrl: string;
  private token: string;

  constructor(config: GitLabClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.token = config.token;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: Record<string, unknown>
  ): Promise<T> {
    const url = `${this.baseUrl}/api/v4${path}`;

    const response = await fetch(url, {
      method,
      headers: {
        'PRIVATE-TOKEN': this.token,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`GitLab API error ${response.status}: ${text}`);
    }

    if (response.status === 204) {
      return {} as T;
    }

    return response.json() as Promise<T>;
  }

  async createMRNote(payload: MRCommentPayload): Promise<{ id: number }> {
    return this.request<{ id: number }>(
      'POST',
      `/projects/${payload.projectId}/merge_requests/${payload.mergeRequestIid}/notes`,
      { body: payload.body }
    );
  }

  async updateMRNote(
    projectId: number,
    mergeRequestIid: number,
    noteId: number,
    body: string
  ): Promise<{ id: number }> {
    return this.request<{ id: number }>(
      'PUT',
      `/projects/${projectId}/merge_requests/${mergeRequestIid}/notes/${noteId}`,
      { body }
    );
  }

  async getMRNotes(
    projectId: number,
    mergeRequestIid: number
  ): Promise<Array<{ id: number; body: string; author: { username: string } }>> {
    return this.request<Array<{ id: number; body: string; author: { username: string } }>>(
      'GET',
      `/projects/${projectId}/merge_requests/${mergeRequestIid}/notes`
    );
  }

  async getProject(projectId: number): Promise<{
    id: number;
    name: string;
    path_with_namespace: string;
    default_branch: string;
  }> {
    return this.request<{
      id: number;
      name: string;
      path_with_namespace: string;
      default_branch: string;
    }>('GET', `/projects/${projectId}`);
  }

  async getMergeRequest(
    projectId: number,
    mergeRequestIid: number
  ): Promise<{
    id: number;
    iid: number;
    title: string;
    state: string;
    source_branch: string;
    target_branch: string;
    sha: string;
  }> {
    return this.request<{
      id: number;
      iid: number;
      title: string;
      state: string;
      source_branch: string;
      target_branch: string;
      sha: string;
    }>('GET', `/projects/${projectId}/merge_requests/${mergeRequestIid}`);
  }

  async getContainerRepositories(projectId: number): Promise<
    Array<{
      id: number;
      name: string;
      path: string;
      location: string;
      tags_count: number;
    }>
  > {
    return this.request<
      Array<{
        id: number;
        name: string;
        path: string;
        location: string;
        tags_count: number;
      }>
    >('GET', `/projects/${projectId}/registry/repositories`);
  }

  async getContainerRepositoryTags(
    projectId: number,
    repositoryId: number
  ): Promise<Array<{ name: string; path: string; location: string }>> {
    return this.request<Array<{ name: string; path: string; location: string }>>(
      'GET',
      `/projects/${projectId}/registry/repositories/${repositoryId}/tags`
    );
  }
}
