# How Qualys GitLab Integration Works: A Deep Dive

Learn how the Qualys Container Security integration brings enterprise-grade vulnerability scanning directly into your GitLab CI/CD pipelines, with results appearing in GitLab's native Security Dashboard.

---

## The Problem: Security as an Afterthought

Traditional security scanning happens too late in the development cycle. Teams build and deploy applications, then run security scans as a separate process. By the time vulnerabilities are discovered, the code is already in production.

```mermaid
flowchart LR
    subgraph Traditional["Traditional Approach"]
        dev["Develop"] --> build["Build"] --> deploy["Deploy"] --> scan["Security Scan"]
        scan -->|"Vulnerabilities Found!"| fix["Fix & Redeploy"]
    end

    style scan fill:#ff6b6b
    style fix fill:#ff6b6b
```

## The Solution: Shift-Left Security

The Qualys GitLab integration shifts security scanning left—into the CI/CD pipeline itself. Every merge request triggers an automatic scan, catching vulnerabilities before they reach production.

```mermaid
flowchart LR
    subgraph ShiftLeft["Shift-Left Approach"]
        dev["Develop"] --> mr["Merge Request"]
        mr --> scan["Security Scan"]
        scan -->|"Pass"| build["Build"] --> deploy["Deploy"]
        scan -->|"Fail"| fix["Fix Before Merge"]
    end

    style scan fill:#51cf66
    style fix fill:#ffd43b
```

---

## Architecture Overview

The integration consists of three main components working together:

```mermaid
flowchart TB
    subgraph YourProject["Your GitLab Project"]
        gitlab_ci[".gitlab-ci.yml"]
        dockerfile["Dockerfile"]
        code["Application Code"]
    end

    subgraph QualysComponent["Qualys CI Component"]
        template["template.yml"]
        scanner["Scanner Container"]
        qscanner["QScanner CLI"]
    end

    subgraph QualysCloud["Qualys Cloud"]
        api["Qualys API"]
        vulndb["Vulnerability Database"]
        policies["Security Policies"]
    end

    subgraph GitLabUI["GitLab UI"]
        dashboard["Security Dashboard"]
        mr_widget["MR Security Widget"]
        vuln_report["Vulnerability Report"]
    end

    gitlab_ci -->|"includes"| template
    template -->|"runs"| scanner
    scanner -->|"executes"| qscanner
    qscanner <-->|"communicates"| api
    api -->|"queries"| vulndb
    api -->|"evaluates"| policies
    scanner -->|"uploads reports"| dashboard
    dashboard --> mr_widget
    dashboard --> vuln_report
```

---

## How a Scan Works: Step by Step

Let's walk through exactly what happens when a developer pushes code:

### Step 1: Pipeline Triggered

When a developer pushes to a branch or opens a merge request, GitLab's CI/CD pipeline starts.

```mermaid
sequenceDiagram
    actor Dev as Developer
    participant GL as GitLab
    participant Runner as GitLab Runner

    Dev->>GL: git push / Open MR
    GL->>GL: Parse .gitlab-ci.yml
    GL->>Runner: Queue scan job
    Runner->>Runner: Pull scanner image
```

### Step 2: Scanner Initialization

The scanner container starts and reads configuration from environment variables:

```mermaid
flowchart LR
    subgraph Environment["Environment Variables"]
        token["QUALYS_ACCESS_TOKEN"]
        pod["QUALYS_POD"]
        image["IMAGE_NAME"]
        types["SCAN_TYPES"]
    end

    subgraph Scanner["Scanner Process"]
        init["Initialize"]
        validate["Validate Config"]
        setup["Setup QScanner"]
    end

    token --> init
    pod --> init
    image --> init
    types --> init
    init --> validate --> setup
```

### Step 3: QScanner Binary Setup

The scanner downloads and verifies the QScanner binary:

```mermaid
sequenceDiagram
    participant Scanner as Scanner Container
    participant GitHub as GitHub Releases
    participant FS as File System

    Scanner->>FS: Check if binary exists
    alt Binary not cached
        Scanner->>GitHub: Download qscanner.gz
        GitHub-->>Scanner: Compressed binary
        Scanner->>Scanner: Verify SHA256 checksum
        Scanner->>FS: Extract & chmod +x
    end
    Scanner->>Scanner: Binary ready
```

### Step 4: Container Image Analysis

QScanner analyzes the target container image layer by layer:

```mermaid
flowchart TB
    subgraph Image["Container Image"]
        base["Base Layer<br/>(e.g., alpine:3.18)"]
        deps["Dependencies Layer<br/>(npm packages, apt)"]
        app["Application Layer<br/>(your code)"]
    end

    subgraph Analysis["QScanner Analysis"]
        extract["Extract Layers"]
        os_scan["OS Package Scan"]
        sca_scan["SCA Scan"]
        secret_scan["Secret Scan"]
    end

    subgraph Results["Findings"]
        os_vulns["OS Vulnerabilities<br/>(CVEs in apt/apk packages)"]
        sca_vulns["Dependency Vulnerabilities<br/>(CVEs in npm/pip/etc)"]
        secrets["Exposed Secrets<br/>(API keys, passwords)"]
    end

    base --> extract
    deps --> extract
    app --> extract

    extract --> os_scan --> os_vulns
    extract --> sca_scan --> sca_vulns
    extract --> secret_scan --> secrets
```

### Step 5: Qualys Cloud Processing

The scan results are sent to Qualys Cloud for enrichment:

```mermaid
sequenceDiagram
    participant QS as QScanner
    participant API as Qualys API
    participant DB as Vuln Database
    participant Policy as Policy Engine

    QS->>API: Upload scan manifest
    API->>DB: Query known vulnerabilities
    DB-->>API: CVE details, CVSS scores
    API->>API: Correlate findings

    alt Policy Evaluation Mode
        API->>Policy: Evaluate against policies
        Policy-->>API: ALLOW / DENY / AUDIT
    end

    API-->>QS: Enriched vulnerability report
```

### Step 6: Report Generation

QScanner generates reports in GitLab's native format:

```mermaid
flowchart LR
    subgraph QScannerOutput["QScanner Output"]
        raw["Raw Scan Results"]
        sarif["SARIF Report"]
        gitlab_fmt["GitLab Format"]
    end

    subgraph Transform["Report Processing"]
        parse["Parse Vulnerabilities"]
        map["Map to GitLab Schema"]
        copy["Write to Expected Path"]
    end

    subgraph Artifacts["Pipeline Artifacts"]
        container_report["gl-container-scanning-report.json"]
        secret_report["gl-secret-detection-report.json"]
    end

    raw --> parse
    gitlab_fmt --> map
    sarif --> parse
    parse --> map --> copy
    copy --> container_report
    copy --> secret_report
```

### Step 7: GitLab Security Dashboard

GitLab ingests the reports and displays them in the Security Dashboard:

```mermaid
flowchart TB
    subgraph Pipeline["Pipeline Completion"]
        artifacts["Uploaded Artifacts"]
    end

    subgraph Processing["GitLab Processing"]
        ingest["Ingest Reports"]
        dedupe["Deduplicate Findings"]
        track["Track Over Time"]
    end

    subgraph Display["Security Dashboard"]
        summary["Vulnerability Summary"]
        list["Detailed Findings"]
        trend["Trend Charts"]
        mr_widget["MR Widget"]
    end

    artifacts --> ingest --> dedupe --> track
    track --> summary
    track --> list
    track --> trend
    track --> mr_widget
```

---

## The GitLab Report Format

QScanner's `--report-format gitlab` generates reports that match GitLab's expected schema:

```mermaid
classDiagram
    class GitLabReport {
        +string version
        +Vulnerability[] vulnerabilities
        +Scan scan
    }

    class Vulnerability {
        +string id
        +string category
        +string name
        +string severity
        +string description
        +Location location
        +Identifier[] identifiers
    }

    class Location {
        +string image
        +Dependency dependency
    }

    class Dependency {
        +Package package
        +string version
    }

    class Identifier {
        +string type
        +string name
        +string value
        +string url
    }

    GitLabReport --> Vulnerability
    Vulnerability --> Location
    Vulnerability --> Identifier
    Location --> Dependency
```

---

## Policy Evaluation: Gate Your Deployments

With policy evaluation mode, Qualys can enforce security gates:

```mermaid
flowchart TD
    scan["Scan Complete"]
    eval["Evaluate Against Policies"]

    scan --> eval

    eval -->|"No Critical/High CVEs"| allow["ALLOW<br/>Exit Code: 0"]
    eval -->|"Critical CVE Found"| deny["DENY<br/>Exit Code: 42"]
    eval -->|"No Matching Policy"| audit["AUDIT<br/>Exit Code: 43"]

    allow -->|"Pipeline continues"| deploy["Deploy"]
    deny -->|"Pipeline blocked"| blocked["Deployment Blocked"]
    audit -->|"Warning only"| deploy

    style allow fill:#51cf66
    style deny fill:#ff6b6b
    style audit fill:#ffd43b
```

---

## Performance Considerations

### Caching Strategy

The scanner caches the QScanner binary to speed up subsequent runs:

```mermaid
flowchart LR
    subgraph FirstRun["First Run (~30s)"]
        download["Download Binary"]
        verify["Verify Checksum"]
        extract["Extract"]
        scan1["Scan"]
    end

    subgraph SubsequentRuns["Subsequent Runs (~5s)"]
        check["Check Cache"]
        scan2["Scan"]
    end

    download --> verify --> extract --> scan1
    check -->|"Binary exists"| scan2
```

### Parallel Scanning

For monorepos with multiple images, run scans in parallel:

```yaml
scan-frontend:
  extends: .qualys-scan
  variables:
    IMAGE_NAME: "$CI_REGISTRY_IMAGE/frontend:$CI_COMMIT_SHA"

scan-backend:
  extends: .qualys-scan
  variables:
    IMAGE_NAME: "$CI_REGISTRY_IMAGE/backend:$CI_COMMIT_SHA"

scan-worker:
  extends: .qualys-scan
  variables:
    IMAGE_NAME: "$CI_REGISTRY_IMAGE/worker:$CI_COMMIT_SHA"
```

```mermaid
gantt
    title Parallel Scan Execution
    dateFormat X
    axisFormat %s

    section Frontend
    Scan frontend    :0, 30

    section Backend
    Scan backend     :0, 45

    section Worker
    Scan worker      :0, 25

    section Pipeline
    All scans complete :milestone, 45, 0
```

---

## Security Model

### How Credentials Flow

```mermaid
flowchart TB
    subgraph Setup["One-Time Setup"]
        admin["Admin"]
        qualys_portal["Qualys Portal"]
        gitlab_vars["GitLab CI/CD Variables"]
    end

    subgraph Runtime["Each Pipeline Run"]
        pipeline["Pipeline Start"]
        inject["Inject as Env Var"]
        scanner["Scanner Process"]
        qualys_api["Qualys API"]
    end

    admin -->|"Generate token"| qualys_portal
    qualys_portal -->|"Copy token"| gitlab_vars
    gitlab_vars -->|"Masked variable"| inject
    pipeline --> inject
    inject -->|"QUALYS_ACCESS_TOKEN"| scanner
    scanner -->|"Authenticate"| qualys_api

    style gitlab_vars fill:#51cf66
    style inject fill:#51cf66
```

### What's Protected

| Asset | Protection |
|-------|------------|
| Access Token | Masked in logs, stored encrypted |
| Scan Results | TLS in transit, stored in Qualys Cloud |
| Container Images | Never leave your infrastructure |
| Vulnerability Data | Fetched from Qualys, not stored locally |

---

## Summary

The Qualys GitLab integration provides:

1. **Automated Scanning** - Every MR triggers a security scan
2. **Native Integration** - Results appear in GitLab's Security Dashboard
3. **Policy Enforcement** - Block deployments based on security policies
4. **Zero Configuration** - Add one line to your `.gitlab-ci.yml`

```mermaid
flowchart LR
    code["Write Code"] --> push["Push to GitLab"]
    push --> scan["Automatic Scan"]
    scan --> review["Review in Dashboard"]
    review --> fix["Fix Issues"]
    fix --> merge["Merge Safely"]

    style scan fill:#51cf66
    style review fill:#51cf66
```

---

## Getting Started

Add this to your `.gitlab-ci.yml`:

```yaml
include:
  - component: gitlab.com/qualys/qualys-container-scan@1.0.0

qualys-container-scan:
  variables:
    QUALYS_POD: "US3"
    IMAGE_NAME: "$CI_REGISTRY_IMAGE:$CI_COMMIT_SHA"
```

Set `QUALYS_ACCESS_TOKEN` in your CI/CD variables, and you're done!
