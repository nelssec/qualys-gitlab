# Qualys GitLab Integration Architecture

## Overview

The Qualys GitLab integration enables automated container security scanning within GitLab CI/CD pipelines. When a pipeline runs, the Qualys scanner analyzes container images for vulnerabilities and reports findings directly to GitLab's Security Dashboard.

```mermaid
flowchart TB
    subgraph gitlab["GitLab Instance"]
        repo[("Repository")]
        pipeline["CI/CD Pipeline"]
        registry["Container Registry"]
        dashboard["Security Dashboard"]
    end

    subgraph runner["GitLab Runner"]
        job["Scan Job"]
        scanner["Scanner Container"]
        qscanner["QScanner Binary"]
    end

    subgraph qualys["Qualys Cloud"]
        api["Qualys API"]
        vulndb[("Vulnerability DB")]
        policies["Security Policies"]
    end

    repo -->|triggers| pipeline
    pipeline -->|pulls image| registry
    pipeline -->|starts| job
    job -->|runs| scanner
    scanner -->|executes| qscanner
    qscanner -->|authenticates| api
    qscanner -->|queries| vulndb
    qscanner -->|evaluates| policies
    qscanner -->|generates| reports["GitLab Reports"]
    reports -->|uploads| dashboard

    style gitlab fill:#e1f5fe
    style runner fill:#fff3e0
    style qualys fill:#fce4ec
```

## Components

### GitLab CI Component

A reusable pipeline template that users include in their `.gitlab-ci.yml`:

```mermaid
flowchart LR
    subgraph component["GitLab CI Component"]
        template["template.yml"]
        image["Docker Image"]
        script["Scanner Script"]
    end

    subgraph user["User's Project"]
        gitlab_ci[".gitlab-ci.yml"]
        dockerfile["Dockerfile"]
    end

    gitlab_ci -->|includes| template
    template -->|uses| image
    image -->|runs| script

    style component fill:#e8f5e9
    style user fill:#fff3e0
```

### Scanner Container

The scanner runs as a Docker container within the GitLab Runner:

```mermaid
flowchart TB
    subgraph container["qualys/gitlab-scanner:latest"]
        node["Node.js 20 Runtime"]
        core["@qualys/gitlab-core"]
        cli["Scanner CLI"]
        qscanner["QScanner Binary"]
    end

    env["Environment Variables"]
    env -->|QUALYS_ACCESS_TOKEN| cli
    env -->|QUALYS_POD| cli
    env -->|IMAGE_NAME| cli

    cli -->|uses| core
    core -->|downloads & executes| qscanner

    style container fill:#e8f5e9
```

## Scan Execution Flow

```mermaid
sequenceDiagram
    participant GL as GitLab Pipeline
    participant Runner as GitLab Runner
    participant Scanner as Scanner Container
    participant QS as QScanner Binary
    participant API as Qualys API
    participant DB as Vulnerability DB

    GL->>Runner: Start scan job
    Runner->>Scanner: Pull & run container
    Scanner->>Scanner: Read environment variables
    Scanner->>QS: Download binary (if not cached)
    Scanner->>QS: Execute scan command

    QS->>API: Authenticate (access token)
    API-->>QS: Session established

    QS->>QS: Analyze container image
    QS->>API: Upload scan results
    API->>DB: Query vulnerabilities
    DB-->>API: Vulnerability matches
    API-->>QS: Vulnerability report

    alt Policy Evaluation Mode
        QS->>API: Evaluate against policies
        API-->>QS: ALLOW / DENY / AUDIT
    end

    QS-->>Scanner: Exit code + reports
    Scanner->>Scanner: Generate GitLab reports
    Scanner-->>Runner: Upload artifacts
    Runner-->>GL: Job complete + reports
    GL->>GL: Update Security Dashboard
```

## Report Generation

QScanner generates reports in GitLab's native format using `--report-format gitlab`:

```mermaid
flowchart LR
    subgraph qscanner["QScanner Output"]
        scan["Scan Results JSON"]
        sarif["SARIF Report"]
        gitlab_fmt["GitLab Format"]
    end

    subgraph transform["Report Processing"]
        parse["Parse Results"]
        summary["Generate Summary"]
        copy["Copy to Expected Paths"]
    end

    subgraph artifacts["Pipeline Artifacts"]
        container["gl-container-scanning-report.json"]
        secret["gl-secret-detection-report.json"]
        dashboard["Security Dashboard"]
    end

    scan --> parse
    sarif --> parse
    gitlab_fmt --> copy
    parse --> summary
    copy --> container
    copy --> secret
    container --> dashboard
    secret --> dashboard

    style qscanner fill:#fff3e0
    style transform fill:#e8f5e9
    style artifacts fill:#e1f5fe
```

## GitLab Security Dashboard Integration

```mermaid
flowchart TB
    subgraph pipeline["CI/CD Pipeline"]
        job["Qualys Scan Job"]
        artifacts["Job Artifacts"]
    end

    subgraph reports["Security Reports"]
        container["Container Scanning Report"]
        secret["Secret Detection Report"]
    end

    subgraph dashboard["Security Dashboard"]
        vuln_list["Vulnerability List"]
        severity["Severity Breakdown"]
        trends["Trend Analysis"]
        mr_widget["MR Security Widget"]
    end

    job -->|generates| artifacts
    artifacts -->|contains| container
    artifacts -->|contains| secret
    container -->|populates| vuln_list
    container -->|calculates| severity
    vuln_list -->|tracks| trends
    container -->|displays in| mr_widget

    style pipeline fill:#fff3e0
    style reports fill:#e8f5e9
    style dashboard fill:#e1f5fe
```

## Exit Codes

| Code | Result | Pipeline Status |
|------|--------|-----------------|
| 0 | Success | Pass |
| 1 | Scan failed or vulnerabilities exceed threshold | Fail |
| 42 | Policy evaluation: DENY | Fail |
| 43 | Policy evaluation: AUDIT | Warning |

## Security

| Asset | Protection |
|-------|------------|
| Access Token | Masked in logs, stored encrypted in GitLab CI/CD variables |
| Scan Results | TLS in transit, stored in Qualys Cloud |
| Container Images | Never leave your infrastructure |
| Vulnerability Data | Fetched from Qualys, not stored locally |
