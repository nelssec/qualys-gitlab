# Platform Service (Zero-Config)

The Platform Service provides enterprise-wide container scanning with a single OAuth authorization. Connect once, and all repositories are automatically discovered and configured for merge request scanning.

## How It Works

```mermaid
flowchart TB
    subgraph step1["Step 1: Connect"]
        ADMIN[Admin clicks Connect]
        OAUTH[OAuth Authorization]
        SELECT[Select Group]
    end

    subgraph step2["Step 2: Discover"]
        FETCH[Fetch all projects]
        STORE[Store in database]
    end

    subgraph step3["Step 3: Configure"]
        REGISTER[Register webhooks]
        ENABLE[Enable scanning]
    end

    subgraph step4["Step 4: Scan"]
        MR[MR opened]
        QUEUE[Queue job]
        WORKER[Worker processes]
        COMMENT[Post results]
    end

    step1 --> step2 --> step3
    MR --> QUEUE --> WORKER --> COMMENT

    style step1 fill:#e1f5fe
    style step2 fill:#fff3e0
    style step3 fill:#e8f5e9
    style step4 fill:#f3e5f5
```

## Key Features

### Multi-Group Selection

When authorizing the OAuth application, if your account has access to multiple GitLab groups, you will see a group selection page. Choose which group to connect for container scanning.

```mermaid
sequenceDiagram
    participant Admin
    participant Platform
    participant GitLab

    Admin->>Platform: /oauth/connect
    Platform->>GitLab: OAuth redirect
    GitLab->>Admin: Authorize?
    Admin->>GitLab: Approve
    GitLab->>Platform: Callback with token
    Platform->>GitLab: Fetch user groups

    alt Single group
        Platform->>Platform: Auto-select group
        Platform->>Admin: Success page
    else Multiple groups
        Platform->>Admin: Group selection page
        Admin->>Platform: Select group
        Platform->>Admin: Success page
    end
```

### Queue-Based Scanning

Scans are processed asynchronously through a job queue. This prevents webhook timeouts and allows processing multiple MRs concurrently.

```mermaid
flowchart LR
    subgraph webhooks["Incoming Webhooks"]
        W1[MR !1]
        W2[MR !2]
        W3[MR !3]
    end

    subgraph queue["Job Queue"]
        Q[(Queued Jobs)]
    end

    subgraph worker["Scan Worker"]
        P1[Process 1]
        P2[Process 2]
    end

    W1 & W2 & W3 --> Q
    Q --> P1 & P2

    style webhooks fill:#e1f5fe
    style queue fill:#fff3e0
    style worker fill:#e8f5e9
```

| Benefit | Description |
|---------|-------------|
| No timeouts | Webhooks return immediately after queueing |
| Concurrency | Up to 2 scans run in parallel (configurable) |
| Reliability | Failed jobs are logged with error details |
| Visibility | Queue status available via API |

## Customer Setup

Total time: 5 minutes

### Prerequisites

- Docker or Kubernetes for running the service
- A publicly accessible URL for webhook callbacks
- GitLab admin access (for creating OAuth application)
- Qualys access token

### Step 1: Create GitLab OAuth Application

Navigate to GitLab Admin Area > Applications:

| Setting | Value |
|---------|-------|
| Name | Qualys Container Security |
| Redirect URI | `https://your-service.example.com/oauth/callback` |
| Trusted | Yes (recommended) |
| Confidential | Yes |
| Scopes | `api`, `read_user`, `read_repository` |

Save the Application ID and Secret.

### Step 2: Deploy the Platform Service

**Docker:**

```bash
docker run -d \
  --name qualys-platform \
  -p 3000:3000 \
  -v qualys-data:/app/data \
  -e QUALYS_ACCESS_TOKEN="your-qualys-token" \
  -e QUALYS_POD="US3" \
  -e GITLAB_APP_ID="your-oauth-app-id" \
  -e GITLAB_APP_SECRET="your-oauth-app-secret" \
  -e BASE_URL="https://your-service.example.com" \
  qualys/gitlab-platform-service:latest
```

**Docker Compose:**

```yaml
version: '3.8'
services:
  platform:
    image: qualys/gitlab-platform-service:latest
    ports:
      - "3000:3000"
    volumes:
      - platform-data:/app/data
    environment:
      - QUALYS_ACCESS_TOKEN=${QUALYS_ACCESS_TOKEN}
      - QUALYS_POD=${QUALYS_POD}
      - GITLAB_APP_ID=${GITLAB_APP_ID}
      - GITLAB_APP_SECRET=${GITLAB_APP_SECRET}
      - BASE_URL=${BASE_URL}
    restart: unless-stopped

volumes:
  platform-data:
```

### Step 3: Connect Your GitLab Organization

1. Open `https://your-service.example.com/oauth/connect`
2. GitLab prompts: "Authorize Qualys Container Security?"
3. Click **Authorize**
4. Done. All repositories are now configured.

```mermaid
sequenceDiagram
    participant Admin as Admin
    participant Platform as Platform Service
    participant GL as GitLab

    Admin->>Platform: Visit /oauth/connect
    Platform->>GL: Redirect to OAuth
    GL->>Admin: "Authorize Qualys?"
    Admin->>GL: Approve
    GL->>Platform: Authorization code
    Platform->>GL: Exchange for token
    GL-->>Platform: Access token
    Platform->>GL: Discover all projects
    Platform->>GL: Register webhooks
    Platform->>Admin: Redirect to success page
```

## What Happens Automatically

| Event | Response |
|-------|----------|
| OAuth authorized | All repos discovered, webhooks registered |
| New repo created | Discovered within 1 hour, webhook registered |
| MR opened | Image scanned, results posted as comment |
| MR updated | Re-scanned with new commit |
| Token expiring | Automatic refresh |

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `QUALYS_ACCESS_TOKEN` | Yes | - | Qualys API access token |
| `QUALYS_POD` | Yes | - | Qualys platform POD |
| `GITLAB_APP_ID` | Yes | - | GitLab OAuth Application ID |
| `GITLAB_APP_SECRET` | Yes | - | GitLab OAuth Application Secret |
| `BASE_URL` | Yes | - | Public URL of this service |
| `PORT` | No | 3000 | Service port |
| `DATABASE_PATH` | No | /app/data/qualys-gitlab.json | Data storage path |
| `SYNC_INTERVAL_MINUTES` | No | 60 | Repo discovery interval |
| `SCAN_TYPES` | No | pkg | Comma-separated scan types |
| `FAIL_ON_SEVERITY` | No | 4 | Fail threshold |

### Scan Configuration

Control what gets scanned:

| Variable | Options | Description |
|----------|---------|-------------|
| `SCAN_TYPES` | `pkg`, `secret`, `malware` | What to scan for |
| `FAIL_ON_SEVERITY` | 5=critical, 4=high, 3=medium | When to fail the check |
| `SCAN_TIMEOUT` | Seconds | Maximum scan duration |

## API Endpoints

### Public Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Service info |
| `/health` | GET | Health check |
| `/oauth/connect` | GET | Start OAuth flow |
| `/oauth/callback` | GET | OAuth callback |
| `/webhook` | POST | GitLab webhook receiver |

### Admin API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/organizations` | GET | List connected organizations |
| `/api/organizations/:id` | GET | Get organization details |
| `/api/organizations/:id/repositories` | GET | List discovered repositories |
| `/api/organizations/:id/sync` | POST | Trigger manual sync |
| `/api/organizations/:id` | DELETE | Disconnect organization |
| `/api/queue/status` | GET | Get scan queue status |

### Example: List Organizations

```bash
curl https://your-service.example.com/api/organizations
```

```json
[
  {
    "id": 1,
    "groupPath": "my-org",
    "gitlabUrl": "https://gitlab.com",
    "status": "active",
    "lastSyncAt": "2024-01-15T10:30:00.000Z",
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
]
```

### Example: Trigger Manual Sync

```bash
curl -X POST https://your-service.example.com/api/organizations/1/sync
```

```json
{
  "status": "ok",
  "repositoriesDiscovered": 50,
  "webhooksRegistered": 48,
  "webhooksFailed": 2
}
```

### Example: Queue Status

```bash
curl https://your-service.example.com/api/queue/status
```

```json
{
  "running": true,
  "processing": 1,
  "queued": 3
}
```

## Architecture

```mermaid
flowchart TB
    subgraph platform["Platform Service"]
        OAUTH[OAuth Handler]
        DISCOVERY[Discovery Service]
        WEBHOOKS[Webhook Manager]
        SYNC["Sync Scheduler<br/>(every hour)"]
        HANDLER[Webhook Handler]
        QUEUE[(Job Queue)]
        WORKER[Scan Worker]
        SCANNER[Scanner Service]
        DB[(JSON Store)]
    end

    subgraph gitlab["GitLab"]
        GROUP[GitLab Group]
        PROJECTS[Projects]
        MR[Merge Requests]
    end

    subgraph qualys["Qualys"]
        API[Container Security API]
    end

    OAUTH -->|store token| DB
    OAUTH --> DISCOVERY
    DISCOVERY -->|list projects| GROUP
    DISCOVERY -->|store repos| DB
    DISCOVERY --> WEBHOOKS
    WEBHOOKS -->|register hooks| PROJECTS
    SYNC -->|hourly| DISCOVERY
    PROJECTS -->|MR events| HANDLER
    HANDLER -->|queue job| QUEUE
    WORKER -->|poll| QUEUE
    WORKER --> SCANNER --> API
    API --> SCANNER --> WORKER
    WORKER -->|post comment| MR

    style platform fill:#fff3e0
    style gitlab fill:#e8f5e9
    style qualys fill:#fce4ec
```

## Data Storage

The service uses JSON file storage for simplicity. Data is stored at `/app/data/qualys-gitlab.json`:

```json
{
  "organizations": [
    {
      "id": 1,
      "gitlabGroupId": 12345,
      "gitlabGroupPath": "my-org",
      "gitlabUrl": "https://gitlab.com",
      "accessToken": "...",
      "refreshToken": "...",
      "tokenExpiresAt": "2024-02-01T00:00:00.000Z",
      "status": "active",
      "lastSyncAt": "2024-01-15T10:30:00.000Z"
    }
  ],
  "repositories": [
    {
      "id": 1,
      "organizationId": 1,
      "gitlabProjectId": 67890,
      "name": "my-project",
      "pathWithNamespace": "my-org/my-project",
      "webUrl": "https://gitlab.com/my-org/my-project",
      "webhookId": 123456,
      "webhookStatus": "active",
      "scanEnabled": true
    }
  ]
}
```

For production deployments with high availability requirements, consider migrating to PostgreSQL.

## Troubleshooting

| Issue | Resolution |
|-------|------------|
| OAuth callback error | Verify redirect URI matches exactly |
| No repos discovered | Check OAuth scopes include `api` and `read_repository` |
| Webhook registration failed | Verify user has maintainer access to projects |
| Scans not triggering | Check webhook is set to MR events |
| Token refresh failed | Re-authorize the organization |

### View Logs

```bash
# Docker
docker logs qualys-platform

# Docker Compose
docker-compose logs -f platform
```

## Comparison with Other Options

| Feature | CI Component | Webhook Service | Platform Service |
|---------|--------------|-----------------|------------------|
| Setup per project | Yes | One webhook | None |
| New repo coverage | Manual | Manual | Automatic |
| Token management | CI variables | Service config | OAuth (auto-refresh) |
| Admin dashboard | No | No | Yes |
| Best for | CI/CD integration | Central scanning | Enterprise-wide |
