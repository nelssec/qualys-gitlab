import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  QScannerRunner,
  QScannerConfig,
  ContainerScanOptions,
  QScannerExitCode,
  VulnerabilitySummary,
} from '@qualys/gitlab-core';
import { ScanJobResult, WebhookConfig } from '../types';

export class ScannerService {
  private config: WebhookConfig;

  constructor(config: WebhookConfig) {
    this.config = config;
  }

  async scanImage(imageId: string): Promise<ScanJobResult> {
    const qscannerConfig: QScannerConfig = {
      accessToken: this.config.qualys.accessToken,
      pod: this.config.qualys.pod,
      skipTlsVerify: this.config.qualys.skipTlsVerify,
      proxy: this.config.qualys.proxy,
    };

    const runner = new QScannerRunner(qscannerConfig);

    try {
      console.log(`Setting up QScanner for image: ${imageId}`);
      await runner.setup();

      const outputDir = path.join(os.tmpdir(), `qualys-scan-${Date.now()}`);
      fs.mkdirSync(outputDir, { recursive: true });

      const scanOptions: ContainerScanOptions = {
        imageId,
        mode: 'get-report',
        scanTypes: this.config.scan.types as ContainerScanOptions['scanTypes'],
        format: ['json'],
        reportFormat: ['gitlab', 'sarif'],
        outputDir,
        timeout: this.config.scan.timeout,
        logLevel: 'info',
      };

      console.log(`Starting scan for image: ${imageId}`);
      const result = await runner.scanImage(scanOptions);

      let summary: VulnerabilitySummary = {
        total: 0,
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        informational: 0,
      };

      if (result.gitlabVulnReportFile && fs.existsSync(result.gitlabVulnReportFile)) {
        const parsed = runner.parseGitLabReport(result.gitlabVulnReportFile);
        summary = parsed.summary;
      } else if (result.reportFile && fs.existsSync(result.reportFile)) {
        const parsed = runner.parseSarifReport(result.reportFile);
        summary = parsed.summary;
      }

      const scanResult = this.evaluateResults(result, summary);

      fs.rmSync(outputDir, { recursive: true, force: true });

      return scanResult;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        passed: false,
        summary: {
          total: 0,
          critical: 0,
          high: 0,
          medium: 0,
          low: 0,
          informational: 0,
        },
        policyResult: 'NONE',
        failureReasons: [`Scan error: ${errorMessage}`],
      };
    }
  }

  private evaluateResults(
    result: { exitCode: number; policyResult: string; reportFile?: string },
    summary: VulnerabilitySummary
  ): ScanJobResult {
    const failureReasons: string[] = [];
    let passed = true;
    const failOnSeverity = this.config.scan.failOnSeverity;

    if (failOnSeverity > 0) {
      if (failOnSeverity <= 5 && summary.critical > 0) {
        failureReasons.push(`Found ${summary.critical} critical vulnerabilities`);
      }
      if (failOnSeverity <= 4 && summary.high > 0) {
        failureReasons.push(`Found ${summary.high} high severity vulnerabilities`);
      }
      if (failOnSeverity <= 3 && summary.medium > 0) {
        failureReasons.push(`Found ${summary.medium} medium severity vulnerabilities`);
      }
      if (failOnSeverity <= 2 && summary.low > 0) {
        failureReasons.push(`Found ${summary.low} low severity vulnerabilities`);
      }
      passed = failureReasons.length === 0;
    }

    if (
      result.exitCode !== QScannerExitCode.SUCCESS &&
      result.exitCode !== QScannerExitCode.POLICY_EVALUATION_DENY &&
      result.exitCode !== QScannerExitCode.POLICY_EVALUATION_AUDIT
    ) {
      failureReasons.push(`QScanner exited with code ${result.exitCode}`);
      passed = false;
    }

    if (result.policyResult === 'DENY') {
      failureReasons.push('Qualys policy evaluation returned DENY');
      passed = false;
    }

    return {
      passed,
      summary,
      policyResult: result.policyResult as ScanJobResult['policyResult'],
      reportPath: result.reportFile,
      failureReasons,
    };
  }
}
