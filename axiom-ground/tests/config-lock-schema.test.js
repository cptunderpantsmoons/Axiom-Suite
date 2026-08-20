import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { test } from 'node:test';
import { assertValidSchema, bundledSchemaPath } from '../src/utils/schema.js';
import {
  buildDefaultConfig,
  buildDefaultLock,
  writeConfigJson,
  writeLockJson
} from '../src/init/index.js';

function tmpDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'contextlock-config-lock-'));
}

test('config schema validates a default config', () => {
  const config = buildDefaultConfig('/tmp/fixture');
  assert.doesNotThrow(() => assertValidSchema(config, bundledSchemaPath('config'), 'config'));
});

test('config schema rejects a config missing project_id', () => {
  const config = buildDefaultConfig('/tmp/fixture');
  delete config.project_id;
  assert.throws(
    () => assertValidSchema(config, bundledSchemaPath('config'), 'config'),
    /project_id is required/
  );
});

test('config schema rejects a non-integer version', () => {
  const config = buildDefaultConfig('/tmp/fixture');
  config.version = '1';
  assert.throws(
    () => assertValidSchema(config, bundledSchemaPath('config'), 'config'),
    /version/
  );
});

test('lock schema validates a default lock', () => {
  const lock = buildDefaultLock('ctxproj_fixture', '/tmp/fixture');
  assert.doesNotThrow(() => assertValidSchema(lock, bundledSchemaPath('lock'), 'lock'));
});

test('lock schema rejects a missing project_id', () => {
  const lock = buildDefaultLock('ctxproj_fixture', '/tmp/fixture');
  delete lock.project_id;
  assert.throws(
    () => assertValidSchema(lock, bundledSchemaPath('lock'), 'lock'),
    /project_id is required/
  );
});

test('lock schema rejects a non-string latest_drift_score', () => {
  const lock = buildDefaultLock('ctxproj_fixture', '/tmp/fixture');
  lock.latest_drift_score = 'not-a-number';
  assert.throws(
    () => assertValidSchema(lock, bundledSchemaPath('lock'), 'lock'),
    /latest_drift_score/
  );
});

test('writeConfigJson and writeLockJson persist valid artifacts', () => {
  const root = tmpDir();
  try {
    const config = buildDefaultConfig(root);
    const lock = buildDefaultLock(config.project_id, root);
    assert.doesNotThrow(() => writeConfigJson(root, config));
    assert.doesNotThrow(() => writeLockJson(root, lock));

    const writtenConfig = JSON.parse(readFileSync(path.join(root, '.contextlock', 'config.json'), 'utf8'));
    const writtenLock = JSON.parse(readFileSync(path.join(root, '.contextlock', 'lock.json'), 'utf8'));
    assert.equal(writtenConfig.project_id, config.project_id);
    assert.equal(writtenLock.project_id, lock.project_id);
    assert.ok(existsSync(path.join(root, '.contextlock', 'config.json')));
    assert.ok(existsSync(path.join(root, '.contextlock', 'lock.json')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('writeLockJson rejects an invalid lock and writes nothing', () => {
  const root = tmpDir();
  try {
    const lock = buildDefaultLock('ctxproj_fixture', root);
    lock.project_id = null;
    assert.throws(() => writeLockJson(root, lock), /project_id/);
    assert.equal(existsSync(path.join(root, '.contextlock', 'lock.json')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
