#!/usr/bin/env node
/**
 * Simple test runner.
 * Loads and runs all unit tests from addon/test/unit/.
 */

const fs = require('fs');
const path = require('path');

const testDir = path.join(__dirname, '..', 'addon', 'test', 'unit');

if (!fs.existsSync(testDir)) {
  console.error('Test directory not found:', testDir);
  process.exit(1);
}

const files = fs.readdirSync(testDir).filter(f => f.endsWith('.test.js'));

if (files.length === 0) {
  console.log('No test files found.');
  process.exit(0);
}

let allPassed = true;

for (const file of files) {
  const filePath = path.join(testDir, file);
  console.log(`\nRunning: ${file}`);
  try {
    require(filePath);
    console.log(`  ✓ ${file} passed`);
  } catch (err) {
    console.error(`  ✗ ${file} FAILED:`, err.message);
    allPassed = false;
  }
}

if (allPassed) {
  console.log('\nAll tests passed ✓');
  process.exit(0);
} else {
  console.error('\nSome tests FAILED ✗');
  process.exit(1);
}
