const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const {
  validateHarnessEnvironment,
  createEphemeralDbUri,
  createExternalProfileDir,
  removeExternalProfileDir,
  cleanupEphemeralDatabase,
  computeShannonEntropy,
  findCollisionSafePort,
  sanitizeHarnessLog,
  FORBIDDEN_DB_NAMES,
} = require('./utils/harnessSecurity');

async function runIsolationGuardsSuite() {
  console.log('--- Phase 7 Fail-Closed Visual QA Harness Isolation Guards Suite ---');
  let passed = 0;
  let total = 0;

  function test(name, fn) {
    total++;
    try {
      fn();
      passed++;
      console.log(`  ✓ [Guard ${total}] ${name}`);
    } catch (err) {
      console.error(`  ✗ [Guard ${total}] ${name}: ${err.message}`);
      throw err;
    }
  }

  async function testAsync(name, fn) {
    total++;
    try {
      await fn();
      passed++;
      console.log(`  ✓ [Guard ${total}] ${name}`);
    } catch (err) {
      console.error(`  ✗ [Guard ${total}] ${name}: ${err.message}`);
      throw err;
    }
  }

  const VALID_SECRET = 'super_secure_entropy_key_with_at_least_32_characters!';

  // 1. Rejection of missing SCREENSHOT_MONGO_URI
  test('Reject missing SCREENSHOT_MONGO_URI', () => {
    assert.throws(
      () => validateHarnessEnvironment({ SCREENSHOT_JWT_SECRET: VALID_SECRET }),
      /SCREENSHOT_MONGO_URI must be explicitly supplied/
    );
  });

  // 2. Rejection of missing SCREENSHOT_JWT_SECRET
  test('Reject missing SCREENSHOT_JWT_SECRET', () => {
    assert.throws(
      () => validateHarnessEnvironment({ SCREENSHOT_MONGO_URI: 'mongodb://127.0.0.1:27017/taskflow_visual_qa' }),
      /SCREENSHOT_JWT_SECRET must be explicitly supplied/
    );
  });

  // 3. Rejection of weak / low-entropy SCREENSHOT_JWT_SECRET (< 32 chars)
  test('Reject short JWT secret (< 32 chars)', () => {
    assert.throws(
      () => validateHarnessEnvironment({
        SCREENSHOT_MONGO_URI: 'mongodb://127.0.0.1:27017/taskflow_visual_qa',
        SCREENSHOT_JWT_SECRET: 'short_secret_123',
      }),
      /does not meet length requirements/
    );
  });

  // 4. Rejection of low Shannon entropy / repeated characters (32 identical chars)
  test('Reject repeated-character low-entropy JWT secret (Shannon entropy < 3.0)', () => {
    const entropy = computeShannonEntropy('a'.repeat(32));
    assert.strictEqual(entropy, 0, 'Shannon entropy of repeated character must be 0');
    assert.throws(
      () => validateHarnessEnvironment({
        SCREENSHOT_MONGO_URI: 'mongodb://127.0.0.1:27017/taskflow_visual_qa',
        SCREENSHOT_JWT_SECRET: 'a'.repeat(32),
      }),
      /does not meet entropy requirements/
    );
  });

  // 5. Rejection of non-loopback host
  test('Reject remote MongoDB host', () => {
    assert.throws(
      () => validateHarnessEnvironment({
        SCREENSHOT_MONGO_URI: 'mongodb://remote-db.example.com:27017/taskflow_visual_qa',
        SCREENSHOT_JWT_SECRET: VALID_SECRET,
      }),
      /must target a loopback host/
    );
  });

  // 6. Rejection of all forbidden taskflow / production / admin database names
  for (const forbidden of ['taskflow', 'taskflow_prod', 'taskdb', 'production', 'prod', 'admin', 'local', 'config']) {
    test(`Reject forbidden database name "${forbidden}"`, () => {
      assert.throws(
        () => validateHarnessEnvironment({
          SCREENSHOT_MONGO_URI: `mongodb://127.0.0.1:27017/${forbidden}`,
          SCREENSHOT_JWT_SECRET: VALID_SECRET,
        }),
        /Refusing to execute against production or default database/
      );
    });
  }

  // 7. Rejection of database name without visual_qa or _qa
  test('Reject database without QA designation', () => {
    assert.throws(
      () => validateHarnessEnvironment({
        SCREENSHOT_MONGO_URI: 'mongodb://127.0.0.1:27017/my_random_database',
        SCREENSHOT_JWT_SECRET: VALID_SECRET,
      }),
      /must be explicitly designated for visual QA/
    );
  });

  // 8. Acceptance of valid isolated environment
  test('Accept valid isolated visual QA environment', () => {
    const env = validateHarnessEnvironment({
      SCREENSHOT_MONGO_URI: 'mongodb://127.0.0.1:27017/taskflow_visual_qa',
      SCREENSHOT_JWT_SECRET: VALID_SECRET,
    });
    assert.strictEqual(env.dbName, 'taskflow_visual_qa');
  });

  // 8. Ephemeral database generation generates unique run-scoped URI
  test('Generate unique ephemeral database URI', () => {
    const res1 = createEphemeralDbUri('mongodb://127.0.0.1:27017/taskflow_visual_qa', 'run1');
    const res2 = createEphemeralDbUri('mongodb://127.0.0.1:27017/taskflow_visual_qa', 'run2');
    assert.strictEqual(res1.ephemeralDbName, 'taskflow_visual_qa_run1');
    assert.strictEqual(res2.ephemeralDbName, 'taskflow_visual_qa_run2');
    assert.notStrictEqual(res1.ephemeralMongoUri, res2.ephemeralMongoUri);
  });

  // 9. Profile directory is created outside repository in os.tmpdir()
  test('Browser profile directory created outside repository in os.tmpdir()', () => {
    const dir = createExternalProfileDir('test_run_123');
    try {
      assert.ok(fs.existsSync(dir), 'Profile dir must exist');
      assert.ok(dir.startsWith(os.tmpdir()), `Profile dir must be in os.tmpdir (${os.tmpdir()})`);
      assert.ok(!dir.includes('task-management-system'), 'Profile dir must not be inside repo');
    } finally {
      removeExternalProfileDir(dir);
      assert.ok(!fs.existsSync(dir), 'Profile dir must be cleaned up');
    }
  });

  // 10. Cleanup failure propagates and causes harness failure
  await testAsync('Cleanup failure propagates without being swallowed', async () => {
    const mockConn = {
      useDb: () => ({
        dropDatabase: async () => {
          throw new Error('Simulated disk failure during dropDatabase');
        },
      }),
    };

    await assert.rejects(
      async () => {
        await cleanupEphemeralDatabase(mockConn, 'taskflow_visual_qa_fail');
      },
      /Ephemeral database cleanup failed: Simulated disk failure during dropDatabase/
    );
  });

  // 11. Cleanup verification detects non-empty database after drop
  await testAsync('Cleanup verification fails if collections remain after drop', async () => {
    const mockConn = {
      useDb: () => ({
        dropDatabase: async () => {},
        db: {
          listCollections: () => ({
            toArray: async () => [{ name: 'ghost_collection' }],
          }),
        },
      }),
    };

    await assert.rejects(
      async () => {
        await cleanupEphemeralDatabase(mockConn, 'taskflow_visual_qa_uncleared');
      },
      /Verification failed: database "taskflow_visual_qa_uncleared" still contains 1 collections after drop/
    );
  });

  // 12. Successful cleanup drops exact ephemeral DB and confirms emptiness
  await testAsync('Successful cleanup drops exact ephemeral DB and verifies emptiness', async () => {
    let droppedTarget = null;
    const mockConn = {
      useDb: (dbName) => {
        droppedTarget = dbName;
        return {
          dropDatabase: async () => {},
          db: {
            listCollections: () => ({
              toArray: async () => [],
            }),
          },
        };
      },
    };

    const res = await cleanupEphemeralDatabase(mockConn, 'taskflow_visual_qa_clean');
    assert.strictEqual(res.success, true);
    assert.strictEqual(droppedTarget, 'taskflow_visual_qa_clean');
  });

  // 13. Dynamic collision-safe port allocation on loopback
  await testAsync('Collision-safe port assignment finds available loopback port', async () => {
    const port = await findCollisionSafePort(5900, 20);
    assert.ok(typeof port === 'number' && port >= 5900, 'Allocated port must be valid number');
  });

  // 14. Log absence and credential sanitization
  test('Log sanitization strips credentials, secrets, tokens, and MongoDB auth', () => {
    const rawLog = 'Connecting to mongodb://qa_user:super_secret_pwd@127.0.0.1:27017/taskflow_visual_qa with token: eyJhbGciOiJIUzI1NiJ9 and password: my_password_123';
    const sanitized = sanitizeHarnessLog(rawLog);
    assert.ok(!sanitized.includes('super_secret_pwd'), 'Database password must be redacted');
    assert.ok(!sanitized.includes('my_password_123'), 'User password must be redacted');
    assert.ok(!sanitized.includes('eyJhbGciOiJIUzI1NiJ9'), 'JWT token must be redacted');
    assert.ok(sanitized.includes('[REDACTED]'), 'Must contain [REDACTED] marker');
  });

  console.log(`\nIsolation Guards Summary: ${passed}/${total} guards passed.\n`);
}

runIsolationGuardsSuite().catch((err) => {
  console.error('Isolation Guards Suite Failed:', err);
  process.exit(1);
});
