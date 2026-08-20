function hasFlag(args, flag) {
  return args.includes(flag);
}

function outputFormat(args) {
  const index = args.indexOf('--format');
  if (index !== -1 && args[index + 1]) return args[index + 1];
  if (args.includes('--json')) return 'json';
  return 'text';
}

export { hasFlag, outputFormat };
