import chalk from 'chalk';
import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ensureRegistry } from './lib/cache.js';
import { registerUpdateCommand } from './commands/update.js';
import { registerCacheCommand } from './commands/cache.js';
import { registerSearchCommand } from './commands/search.js';
import { registerGetCommand } from './commands/get.js';
import { registerBuildCommand } from './commands/build.js';
import { registerFeedbackCommand } from './commands/feedback.js';
import { trackEvent, shutdownAnalytics } from './lib/analytics.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));

function printUsage() {
  console.log(`
${chalk.bold('chub')} — Context Hub CLI v${pkg.version}
Search and retrieve LLM-optimized docs and skills.

${chalk.bold.underline('Getting Started')}

  ${chalk.dim('$')} chub update                                ${chalk.dim('# download the registry')}
  ${chalk.dim('$')} chub search                                ${chalk.dim('# list everything available')}
  ${chalk.dim('$')} chub search "stripe"                       ${chalk.dim('# fuzzy search')}
  ${chalk.dim('$')} chub search stripe/payments                ${chalk.dim('# exact id → full detail')}
  ${chalk.dim('$')} chub get docs stripe/payments              ${chalk.dim('# print doc to terminal')}
  ${chalk.dim('$')} chub get docs stripe/payments -o doc.md    ${chalk.dim('# save to file')}
  ${chalk.dim('$')} chub get docs stripe/payments --lang py    ${chalk.dim('# specific language')}
  ${chalk.dim('$')} chub get skills pw/login-flows             ${chalk.dim('# fetch a skill')}
  ${chalk.dim('$')} chub get docs openai/chat stripe/payments  ${chalk.dim('# fetch multiple')}

${chalk.bold.underline('Commands')}

  ${chalk.bold('search')} [query]              Search docs and skills (no query = list all)
  ${chalk.bold('get docs')} <ids...>           Fetch documentation content
  ${chalk.bold('get skills')} <ids...>         Fetch skill content
  ${chalk.bold('update')}                      Refresh the cached registry
  ${chalk.bold('cache')} status|clear          Manage the local cache
  ${chalk.bold('build')} <content-dir>        Build registry from content directory

${chalk.bold.underline('Flags')}

  --json                 Structured JSON output (for agents and piping)
  --tags <csv>           Filter by tags (e.g. docs, skill, openai, browser)
  --lang <language>      Language variant (js, py, ts)
  --full                 Fetch all files, not just the entry point
  -o, --output <path>    Write content to file or directory

${chalk.bold.underline('Agent Piping Patterns')}

  ${chalk.dim('# Get the top result id')}
  ${chalk.dim('$')} chub search "stripe" --json | jq -r '.results[0].id'

  ${chalk.dim('# Search → pick → fetch → save')}
  ${chalk.dim('$')} ID=$(chub search "stripe" --json | jq -r '.results[0].id')
  ${chalk.dim('$')} chub get docs "$ID" --lang js -o .context/stripe.md

  ${chalk.dim('# Fetch multiple docs at once')}
  ${chalk.dim('$')} chub get docs openai/chat stripe/payments -o .context/

${chalk.bold.underline('Multi-Source Config')} ${chalk.dim('(~/.chub/config.yaml)')}

  ${chalk.dim('sources:')}
  ${chalk.dim('  - name: community')}
  ${chalk.dim('    url: https://cdn.aichub.org/v1')}
  ${chalk.dim('  - name: internal')}
  ${chalk.dim('    path: /path/to/local/docs')}

  ${chalk.dim('# On id collision, use source: prefix: chub get docs internal:openai/chat')}
`);
}

const program = new Command();

program
  .name('chub')
  .description('Context Hub - search and retrieve LLM-optimized docs and skills')
  .version(pkg.version)
  .option('--json', 'Output as JSON (machine-readable)')
  .action(() => {
    printUsage();
  });

// Commands that don't need registry
const SKIP_REGISTRY = ['update', 'cache', 'build', 'feedback', 'help'];

program.hook('preAction', async (thisCommand) => {
  const cmdName = thisCommand.args?.[0] || thisCommand.name();
  // Track command usage (fire-and-forget, never blocks)
  if (cmdName !== 'chub') {
    trackEvent('command_run', { command: cmdName }).catch(() => {});
  }
  if (SKIP_REGISTRY.includes(cmdName)) return;
  if (thisCommand.parent?.name() === 'cache') return;
  // Don't fetch registry for default action (no command)
  if (cmdName === 'chub') return;
  try {
    await ensureRegistry();
  } catch (err) {
    process.stderr.write(`Warning: Could not load registry: ${err.message}\n`);
    process.stderr.write(`Run \`chub update\` to initialize.\n`);
    process.exit(1);
  }
});

registerUpdateCommand(program);
registerCacheCommand(program);
registerSearchCommand(program);
registerGetCommand(program);
registerBuildCommand(program);
registerFeedbackCommand(program);

program.parse();

// Flush analytics before exit (best-effort)
process.on('beforeExit', () => shutdownAnalytics().catch(() => {}));
