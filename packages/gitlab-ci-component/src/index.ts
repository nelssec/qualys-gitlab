#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import {
  QScannerRunner,
  QScannerConfig,
  ContainerScanOptions,
  QScannerExitCode,
  VulnerabilitySummary,
} from '@qualys/gitlab-core';

interface ScanResult {
  passed: boolean;
  summary: VulnerabilitySummary;
  policyResult: string;
  failureReasons: string[];
}

function getEnvOrFail(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Required environment variable ${name} is not set`);
  }
  return value;
}

function getEnvOrDefault(name: string, defaultValue: string): string {
  return process.env[name] || defaultValue;
}

async function main(): Promise<void> {
  console.log('========================================');
  console.log('Qualys Container Security Scan');
  console.log('========================================');

  try {
    const pod = getEnvOrDefault('QUALYS_POD', 'US3');
    const imageId = getEnvOrFail('IMAGE_NAME');
    const scanTypesInput = getEnvOrDefault('SCAN_TYPES', 'pkg');
    const scanMode = getEnvOrDefault('SCAN_MODE', 'get-report') as ContainerScanOptions['mode'];
    const policyTagsInput = getEnvOrDefault('POLICY_TAGS', '');
    const failOnSeverity = parseInt(getEnvOrDefault('FAIL_ON_SEVERITY', '4'), 10);
    const scanTimeout = parseInt(getEnvOrDefault('SCAN_TIMEOUT', '300'), 10);

    const accessToken = process.env.QUALYS_ACCESS_TOKEN;
    if (!accessToken) {
      throw new Error('Authentication required: Set QUALYS_ACCESS_TOKEN environment variable');
    }

    console.log(`Image: ${imageId}`);
    console.log(`Pod: ${pod}`);
    console.log(`Mode: ${scanMode}`);
    console.log(`Scan Types: ${scanTypesInput}`);
    console.log(`Fail on Severity: ${failOnSeverity}`);
    console.log('');

    const config: QScannerConfig = {
      accessToken,
      pod,
      skipTlsVerify: process.env.QUALYS_SKIP_TLS_VERIFY === 'true',
      proxy: process.env.QUALYS_PROXY,
    };

    const runner = new QScannerRunner(config);

    console.log('Setting up QScanner CLI...');
    await runner.setup();

    const outputDir = path.join(process.cwd(), 'qualys-scan-results');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const scanTypes = scanTypesInput.split(',').map((s) => s.trim()) as ContainerScanOptions['scanTypes'];
    const policyTags = policyTagsInput ? policyTagsInput.split(',').map((t) => t.trim()) : undefined;

    const scanOptions: ContainerScanOptions = {
      imageId,
      mode: scanMode,
      scanTypes,
      format: ['json', 'spdx'],
      reportFormat: ['gitlab', 'sarif'],
      outputDir,
      timeout: scanTimeout,
      logLevel: 'info',
    };

    if (policyTags && policyTags.length > 0) {
      scanOptions.policyTags = policyTags;
    }

    console.log('');
    console.log('Starting container image scan...');
    console.log('----------------------------------------');

    const result = await runner.scanImage(scanOptions);

    console.log('----------------------------------------');
    console.log('');

    const scanResult = evaluateResults(runner, result, scanMode, failOnSeverity);

    copyGitLabReports(result, outputDir);

    printSummary(scanResult, scanMode);

    if (!scanResult.passed) {
      console.log('');
      console.log('SCAN FAILED');
      for (const reason of scanResult.failureReasons) {
        console.log(`  - ${reason}`);
      }
      process.exit(1);
    } else {
      console.log('SCAN PASSED');
      process.exit(0);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${errorMessage}`);
    process.exit(1);
  }
}

function evaluateResults(
  runner: QScannerRunner,
  result: {
    exitCode: number;
    policyResult: string;
    reportFile?: string;
    gitlabVulnReportFile?: string;
  },
  scanMode: string,
  failOnSeverity: number
): ScanResult {
  const failureReasons: string[] = [];
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

  let passed = true;

  if (scanMode === 'evaluate-policy') {
    passed = result.policyResult === 'ALLOW';
    if (result.policyResult === 'DENY') {
      failureReasons.push('Qualys policy evaluation returned DENY');
    } else if (result.policyResult === 'AUDIT') {
      passed = true;
      console.log('Warning: No Qualys policies matched for evaluation (AUDIT)');
    }
  } else {
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
  }

  if (
    result.exitCode !== QScannerExitCode.SUCCESS &&
    result.exitCode !== QScannerExitCode.POLICY_EVALUATION_DENY &&
    result.exitCode !== QScannerExitCode.POLICY_EVALUATION_AUDIT
  ) {
    failureReasons.push(`QScanner exited with code ${result.exitCode}`);
    passed = false;
  }

  return {
    passed,
    summary,
    policyResult: result.policyResult,
    failureReasons,
  };
}

function copyGitLabReports(
  result: {
    gitlabVulnReportFile?: string;
    gitlabSecretReportFile?: string;
    outputDir: string;
  },
  _outputDir: string
): void {
  if (result.gitlabVulnReportFile && fs.existsSync(result.gitlabVulnReportFile)) {
    const destPath = path.join(process.cwd(), 'gl-container-scanning-report.json');
    fs.copyFileSync(result.gitlabVulnReportFile, destPath);
    console.log(`GitLab vulnerability report: ${destPath}`);
  }

  if (result.gitlabSecretReportFile && fs.existsSync(result.gitlabSecretReportFile)) {
    const destPath = path.join(process.cwd(), 'gl-secret-detection-report.json');
    fs.copyFileSync(result.gitlabSecretReportFile, destPath);
    console.log(`GitLab secret detection report: ${destPath}`);
  }
}

function printSummary(scanResult: ScanResult, scanMode: string): void {
  const { summary } = scanResult;

  console.log('========================================');
  console.log('Scan Results Summary');
  console.log('========================================');
  console.log(`Total Vulnerabilities: ${summary.total}`);
  console.log(`  Critical: ${summary.critical}`);
  console.log(`  High: ${summary.high}`);
  console.log(`  Medium: ${summary.medium}`);
  console.log(`  Low: ${summary.low}`);
  console.log(`  Informational: ${summary.informational}`);
  console.log('');

  if (scanMode === 'evaluate-policy') {
    console.log(`Policy Evaluation Result: ${scanResult.policyResult}`);
  }

  console.log('========================================');
}

main();
