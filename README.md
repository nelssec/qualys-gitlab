# qualys-gitlab

Qualys Container Security integration for GitLab CI/CD.

## Features

- Native GitLab Security Dashboard integration
- Container image vulnerability scanning
- SCA (Software Composition Analysis)
- Secret detection
- Policy-based evaluation
- SARIF report generation

## Quick Start

### Using as GitLab CI Component

Add to your `.gitlab-ci.yml`:

```yaml
include:
  - component: gitlab.com/qualys/qualys-container-scan@1.0.0

qualys-container-scan:
  variables:
    QUALYS_POD: "US3"
    IMAGE_NAME: "$CI_REGISTRY_IMAGE:$CI_COMMIT_SHA"
```

### Required Variables

Set these in GitLab CI/CD Settings > Variables:

| Variable | Description | Required |
|----------|-------------|----------|
| `QUALYS_ACCESS_TOKEN` | Qualys API access token | Yes |

### Optional Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `QUALYS_POD` | `US3` | Qualys platform POD |
| `SCAN_TYPES` | `pkg` | Comma-separated: pkg, secret, malware |
| `SCAN_MODE` | `get-report` | Mode: get-report, evaluate-policy |
| `POLICY_TAGS` | - | Policy tags for evaluate-policy mode |
| `FAIL_ON_SEVERITY` | `4` | Fail threshold: 5=critical, 4=high, 3=medium |
| `SCAN_TIMEOUT` | `300` | Timeout in seconds |

## Component Inputs

```yaml
include:
  - component: gitlab.com/qualys/qualys-container-scan@1.0.0
    inputs:
      pod: "US3"
      image: "$CI_REGISTRY_IMAGE:$CI_COMMIT_SHA"
      scan_types: "pkg,secret"
      mode: "evaluate-policy"
      policy_tags: "production,pci"
      fail_on_severity: "4"
      scan_timeout: "600"
      stage: "test"
      allow_failure: "false"
```

## Development

### Project Structure

```
qualys-gitlab/
├── packages/
│   ├── core/                    # Shared QScanner library
│   │   └── src/
│   │       ├── qscanner/
│   │       │   └── QScannerRunner.ts
│   │       ├── types.ts
│   │       └── index.ts
│   └── gitlab-ci-component/     # GitLab CI Component
│       ├── src/
│       │   └── index.ts
│       ├── template.yml
│       └── Dockerfile
├── package.json
└── tsconfig.json
```

### Building

```bash
npm install
npm run build
```

### Building Docker Image

```bash
docker build -t qualys/gitlab-scanner:latest -f packages/gitlab-ci-component/Dockerfile .
```

## Supported PODs

| POD | Region |
|-----|--------|
| US1 | US Platform 1 |
| US2 | US Platform 2 |
| US3 | US Platform 3 |
| US4 | US Platform 4 |
| EU1 | EU Platform 1 |
| EU2 | EU Platform 2 |
| CA1 | Canada |
| IN1 | India |
| AU1 | Australia |
| UK1 | United Kingdom |
| AE1 | UAE |
| KSA1 | Saudi Arabia |

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Scan failed or vulnerabilities exceed threshold |
| 42 | Policy evaluation: DENY |
| 43 | Policy evaluation: AUDIT |

## Documentation

- [Architecture Overview](docs/architecture.md) - System design with Mermaid diagrams
- [Deployment Guide](docs/deployment.md) - How to build, publish, and deploy
- [How It Works](docs/blog-how-it-works.md) - Deep dive blog post

## License

Proprietary - Qualys, Inc.
