import { fail } from '../utils/core.js';
import { printHelp, VERSION } from './help.js';
import { initCommand } from './commands/init.js';
import { statusCommand } from './commands/status.js';
import { snapshotCommand } from './commands/snapshot.js';
import { promptCommand } from './commands/prompt.js';
import { auditCommand } from './commands/audit.js';
import { siteCommand } from './commands/site.js';
import { memoryCommand } from './commands/memory.js';
import { codeIndexCommand } from './commands/code.js';
import { progressCommand } from './commands/progress.js';
import { installHooksCommand, uninstallHooksCommand } from '../hooks/index.js';
import { remoteAddCommand, syncCommand, pullCommand } from '../storage/index.js';
import { rulesValidateCommand } from '../rules/index.js';
import { planCommand } from '../plan/index.js';
import { bootstrapCommand, doctorCommand } from '../bootstrap/index.js';
import { contextExportCommand } from '../integration/index.js';

const COMMANDS = {
  init: initCommand,
  status: statusCommand,
  snapshot: snapshotCommand,
  prompt: promptCommand,
  audit: auditCommand,
  site: siteCommand,
  memory: memoryCommand,
  progress: progressCommand
};

const SUBCOMMANDS = {
  hooks: {
    install: (args, cwd) => installHooksCommand(cwd),
    uninstall: (args, cwd) => uninstallHooksCommand(cwd),
    default: () => fail('hooks subcommand must be install or uninstall', {
      reason: 'Unsupported hooks subcommand.',
      recovery: 'Use install to add automation or uninstall to remove it.',
      command: 'ctx hooks install',
      code: 2
    })
  },
  remote: {
    add: (args, cwd) => remoteAddCommand(args.slice(1), cwd),
    default: () => fail('remote subcommand must be add', {
      reason: 'Unsupported remote subcommand.',
      recovery: 'Configure a supported remote backend.',
      command: 'ctx remote add hf <username>/<repo>',
      code: 2
    })
  }
};

export async function main(argv, cwd = process.cwd()) {
  const [command, ...args] = argv;

  if (!command || command === '--help' || command === '-h') {
    printHelp();
    return 0;
  }

  if (command === '--version' || command === '-v') {
    console.log(VERSION);
    return 0;
  }

  if (COMMANDS[command]) {
    return COMMANDS[command](args, cwd);
  }

  if (SUBCOMMANDS[command]) {
    const [subcommand] = args;
    const group = SUBCOMMANDS[command];
    const handler = subcommand ? group[subcommand] : group.default;
    if (handler) return handler(args, cwd);
    return group.default(args, cwd);
  }

  if (command === 'rules') {
    return rulesValidateCommand(args, cwd);
  }

  if (command === 'plan') {
    return planCommand(args, cwd);
  }

  if (command === 'sync') {
    return syncCommand(args, cwd);
  }

  if (command === 'pull') {
    return pullCommand(args, cwd);
  }

  if (command === 'bootstrap') {
    return bootstrapCommand(args, cwd);
  }

  if (command === 'doctor') {
    return doctorCommand(args, cwd);
  }

  if (command === 'context') {
    if (args[0] === 'export') return contextExportCommand(args.slice(1), cwd);
    return fail('context subcommand must be export', {
      reason: 'Only the curated Ground context export is available.',
      recovery: 'Use the export subcommand to emit GroundContext v1.',
      command: 'ctx context export --format json',
      code: 2
    });
  }

  if (command === 'code') {
    if ((args[0] || 'index') === 'index') return codeIndexCommand(args.slice(1), cwd);
    return fail(`code subcommand "${args[0] || ''}" is not implemented yet`, {
      reason: 'Only the index subcommand is available.',
      recovery: 'Use ctx code index to build the code index artifact.',
      command: 'ctx code index',
      code: 2
    });
  }

  return fail(`command "${command}" is not implemented yet`, {
    reason: 'The requested command is not part of the implemented ContextLock CLI surface.',
    recovery: 'Check the help output for available commands.',
    command: 'ctx --help',
    code: 2
  });
}
