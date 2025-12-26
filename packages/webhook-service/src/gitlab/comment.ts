import { ScanJobResult } from '../types';

const COMMENT_MARKER = '<!-- qualys-scan-result -->';

export function formatScanComment(
  result: ScanJobResult,
  sourceBranch: string,
  targetBranch: string,
  imageId?: string
): string {
  const { summary, policyResult, passed, failureReasons } = result;
  const statusText = passed ? 'PASSED' : 'FAILED';

  let comment = `${COMMENT_MARKER}\n`;
  comment += `## Qualys Security Scan Results\n\n`;
  comment += `**Status:** ${statusText}\n\n`;
  comment += `**Branch:** \`${sourceBranch}\` to \`${targetBranch}\`\n`;

  if (imageId) {
    comment += `**Image:** \`${imageId}\`\n`;
  }

  comment += `\n### Vulnerability Summary\n\n`;
  comment += `| Severity | Count |\n`;
  comment += `|----------|-------|\n`;
  comment += `| Critical | ${summary.critical} |\n`;
  comment += `| High | ${summary.high} |\n`;
  comment += `| Medium | ${summary.medium} |\n`;
  comment += `| Low | ${summary.low} |\n`;
  comment += `| Informational | ${summary.informational} |\n`;
  comment += `| **Total** | **${summary.total}** |\n`;

  if (policyResult !== 'NONE') {
    comment += `\n### Policy Evaluation\n\n`;
    comment += `**Result:** ${policyResult}\n`;
  }

  if (!passed && failureReasons.length > 0) {
    comment += `\n### Failure Reasons\n\n`;
    for (const reason of failureReasons) {
      comment += `- ${reason}\n`;
    }
  }

  comment += `\n---\n`;
  comment += `*Powered by [Qualys Container Security](https://www.qualys.com/apps/container-security/)*\n`;

  return comment;
}

export function formatScanStartedComment(
  sourceBranch: string,
  targetBranch: string,
  imageId?: string
): string {
  let comment = `${COMMENT_MARKER}\n`;
  comment += `## Qualys Security Scan\n\n`;
  comment += `**Scan in progress...**\n\n`;
  comment += `**Branch:** \`${sourceBranch}\` to \`${targetBranch}\`\n`;

  if (imageId) {
    comment += `**Image:** \`${imageId}\`\n`;
  }

  comment += `\n---\n`;
  comment += `*Powered by [Qualys Container Security](https://www.qualys.com/apps/container-security/)*\n`;

  return comment;
}

export function formatScanErrorComment(
  sourceBranch: string,
  targetBranch: string,
  error: string
): string {
  let comment = `${COMMENT_MARKER}\n`;
  comment += `## Qualys Security Scan\n\n`;
  comment += `**Scan failed**\n\n`;
  comment += `**Branch:** \`${sourceBranch}\` to \`${targetBranch}\`\n\n`;
  comment += `**Error:** ${error}\n`;
  comment += `\n---\n`;
  comment += `*Powered by [Qualys Container Security](https://www.qualys.com/apps/container-security/)*\n`;

  return comment;
}

export function isQualysScanComment(body: string): boolean {
  return body.includes(COMMENT_MARKER);
}
