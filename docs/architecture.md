# Qualys GitLab Integration Architecture

## Overview

The Qualys GitLab integration enables automated container security scanning within GitLab CI/CD pipelines. When a pipeline runs, the Qualys scanner analyzes container images for vulnerabilities and reports findings directly to GitLab's Security Dashboard.

## High-Level Architecture

```mermaid
flowchart TB
    subgraph GitLab["GitLab Instance"]
        repo[("Repository")]
        pipeline["CI/CD Pipeline"]
        registry["Container Registry"]
        dashboard["Security Dashboard"]
    end

    subgraph Runner["GitLab Runner"]
        job["Scan Job"]
        scanner["Qualys Scanner Container"]
        qscanner["QScanner Binary"]
    end

    subgraph Qualys["Qualys Cloud Platform"]
        api["Qualys API"]
        vulndb[("Vulnerability DB")]
        policies["Security Policies"]
    end

    repo -->|"triggers"| pipeline
    pipeline -->|"pulls image"| registry
    pipeline -->|"starts"| job
    job -->|"runs"| scanner
    scanner -->|"executes"| qscanner
    qscanner -->|"authenticates"| api
    qscanner -->|"queries"| vulndb
    qscanner -->|"evaluates"| policies
    qscanner -->|"generates"| reports["GitLab Reports"]
    reports -->|"uploads"| dashboard
```

## Component Details

### 1. GitLab CI Component

The CI Component is a reusable pipeline template that users include in their `.gitlab-ci.yml`:

```mermaid
flowchart LR
    subgraph Component["GitLab CI Component"]
        template["template.yml"]
        image["Docker Image"]
        script["Scanner Script"]
    end

    subgraph User["User's Project"]
        gitlab_ci[".gitlab-ci.yml"]
        dockerfile["Dockerfile"]
    end

    gitlab_ci -->|"includes"| template
    template -->|"uses"| image
    image -->|"runs"| script
```

### 2. Scanner Docker Image

The scanner runs as a Docker container within the GitLab Runner:

```mermaid
flowchart TB
    subgraph Container["qualys/gitlab-scanner:latest"]
        node["Node.js 20 Runtime"]
        core["@qualys/gitlab-core"]
        cli["Scanner CLI (index.js)"]
        qscanner["QScanner Binary"]
    end

    env["Environment Variables"]
    env -->|"QUALYS_ACCESS_TOKEN"| cli
    env -->|"QUALYS_POD"| cli
    env -->|"IMAGE_NAME"| cli

    cli -->|"uses"| core
    core -->|"downloads & executes"| qscanner
```

### 3. Scan Execution Flow

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

## Deployment Model

### Current Deployment: GitLab CI Component

```mermaid
flowchart TB
    subgraph Deployment["Deployment Architecture"]
        subgraph Registry["Container Registry"]
            dockerhub["Docker Hub"]
            gitlab_reg["GitLab Registry"]
        end

        subgraph Component["CI Component"]
            template["template.yml"]
            image["qualys/gitlab-scanner"]
        end

        subgraph Usage["User Integration"]
            include["include: component"]
            variables["CI/CD Variables"]
        end
    end

    dockerhub -->|"hosts"| image
    gitlab_reg -->|"optional mirror"| image
    template -->|"references"| image
    include -->|"imports"| template
    variables -->|"configures"| include
```

### Deployment Steps

```mermaid
flowchart LR
    subgraph Build["Build Phase"]
        A1["Build core package"]
        A2["Build scanner package"]
        A3["Build Docker image"]
    end

    subgraph Publish["Publish Phase"]
        B1["Push to Docker Hub"]
        B2["Publish CI Component"]
    end

    subgraph Configure["User Setup"]
        C1["Add CI/CD variables"]
        C2["Include component"]
        C3["Run pipeline"]
    end

    A1 --> A2 --> A3
    A3 --> B1 --> B2
    B2 --> C1 --> C2 --> C3
```

## Data Flow

### Authentication Flow

```mermaid
sequenceDiagram
    participant User as GitLab User
    participant CI as GitLab CI/CD
    participant Scanner as Scanner
    participant Qualys as Qualys API

    User->>CI: Configure QUALYS_ACCESS_TOKEN
    Note over CI: Stored as masked variable
    CI->>Scanner: Inject as environment variable
    Scanner->>Qualys: Authenticate with token
    Qualys-->>Scanner: Token validated
    Scanner->>Scanner: Proceed with scan
```

### Report Generation Flow

```mermaid
flowchart LR
    subgraph QScanner["QScanner Output"]
        scan["Scan Results JSON"]
        sarif["SARIF Report"]
        gitlab["GitLab Report"]
    end

    subgraph Transform["Report Processing"]
        parse["Parse Results"]
        summary["Generate Summary"]
        copy["Copy to Expected Paths"]
    end

    subgraph GitLab["GitLab Artifacts"]
        container["gl-container-scanning-report.json"]
        secret["gl-secret-detection-report.json"]
        dashboard["Security Dashboard"]
    end

    scan --> parse
    sarif --> parse
    gitlab --> copy
    parse --> summary
    copy --> container
    copy --> secret
    container --> dashboard
    secret --> dashboard
```

## GitLab Security Dashboard Integration

```mermaid
flowchart TB
    subgraph Pipeline["CI/CD Pipeline"]
        job["Qualys Scan Job"]
        artifacts["Job Artifacts"]
    end

    subgraph Reports["Security Reports"]
        container["Container Scanning Report"]
        secret["Secret Detection Report"]
    end

    subgraph Dashboard["Security Dashboard"]
        vuln_list["Vulnerability List"]
        severity["Severity Breakdown"]
        trends["Trend Analysis"]
        mr_widget["MR Security Widget"]
    end

    job -->|"generates"| artifacts
    artifacts -->|"contains"| container
    artifacts -->|"contains"| secret
    container -->|"populates"| vuln_list
    container -->|"calculates"| severity
    vuln_list -->|"tracks"| trends
    container -->|"displays in"| mr_widget
```

## Exit Codes and Pipeline Status

```mermaid
flowchart TD
    scan["Scan Complete"]

    scan --> check{"Check Results"}

    check -->|"Exit 0"| success["Pipeline Success"]
    check -->|"Exit 1"| fail["Pipeline Failed"]
    check -->|"Exit 42"| deny["Policy DENY"]
    check -->|"Exit 43"| audit["Policy AUDIT"]

    success -->|"No vulnerabilities above threshold"| green["✅ Green Pipeline"]
    fail -->|"Vulnerabilities found or scan error"| red["❌ Red Pipeline"]
    deny -->|"Policy blocked deployment"| red
    audit -->|"No matching policies"| yellow["⚠️ Warning"]

    subgraph Threshold["Severity Threshold Check"]
        t5["Critical (5)"]
        t4["High (4)"]
        t3["Medium (3)"]
        t2["Low (2)"]
    end
```

## Security Considerations

```mermaid
flowchart TB
    subgraph Security["Security Measures"]
        token["Access Token"]
        tls["TLS Encryption"]
        sandbox["Container Isolation"]
        mask["Variable Masking"]
    end

    subgraph Protection["What's Protected"]
        creds["Credentials"]
        results["Scan Results"]
        images["Container Images"]
    end

    token -->|"authenticates"| creds
    tls -->|"encrypts"| results
    sandbox -->|"isolates"| images
    mask -->|"hides in logs"| token
```
