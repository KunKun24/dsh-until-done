/**
 * CI wrapper around the pinned dsh-plugin-check checkout in /tmp/dsh-plugin-check.
 * Exits non-zero when the report verdict is `fail`, or when strict mode reports
 * warnings that the checker classifies as errors.
 */
import { checkRepo } from '/tmp/dsh-plugin-check/lib/index.js';

const dir = process.argv[2] ?? process.cwd();
const report = await checkRepo(dir, true);

console.log(`kind: ${report.kind}`);
console.log(`checks: ${report.checks.passed}/${report.checks.total} passed, ${report.checks.failed} failed, ${report.checks.warned} warned, ${report.checks.skipped} skipped`);
for (const issue of report.errors) console.log(`error: ${issue.code} — ${issue.detail}`);
for (const issue of report.warnings) console.log(`warn:  ${issue.code} — ${issue.detail}`);
for (const suggestion of report.suggestions) console.log(`tip:   ${suggestion}`);
console.log(`verdict: ${report.verdict}`);

process.exit(report.verdict === 'fail' ? 1 : 0);
