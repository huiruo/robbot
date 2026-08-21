const [expectedPlatform, expectedArch] = process.argv.slice(2);

if (!expectedPlatform || !expectedArch) {
  console.error('Usage: node scripts/verify-target.mjs <platform> <arch>');
  process.exit(1);
}

if (process.platform !== expectedPlatform || process.arch !== expectedArch) {
  console.error(
    `Robbot desktop target mismatch: expected ${expectedPlatform}/${expectedArch}, current ${process.platform}/${process.arch}.`,
  );
  console.error('Build this target on the matching OS/arch runner so bundled Node and native DSH runtime files are correct.');
  process.exit(1);
}
