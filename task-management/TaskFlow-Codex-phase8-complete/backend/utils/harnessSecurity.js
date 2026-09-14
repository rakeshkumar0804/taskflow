const crypto = require('crypto');
const os = require('os');
const path = require('path');
const fs = require('fs');

const FORBIDDEN_DB_NAMES = new Set([
  'taskflow',
  'taskflow_prod',
  'taskdb',
  'production',
  'prod',
  'admin',
  'local',
  'config',
]);

/**
 * Calculate Shannon entropy of a string (in bits per character)
 */
function computeShannonEntropy(str) {
  if (!str || typeof str !== 'string' || str.length === 0) return 0;
  const len = str.length;
  const freq = {};
  for (let i = 0; i < len; i++) {
    const ch = str[i];
    freq[ch] = (freq[ch] || 0) + 1;
  }
  let entropy = 0;
  for (const count of Object.values(freq)) {
    const p = count / len;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/**
 * Validate harness environment variables with fail-closed security guards
 */
function validateHarnessEnvironment(env = process.env) {
  const mongoUri = env.SCREENSHOT_MONGO_URI;
  if (!mongoUri || typeof mongoUri !== 'string' || !mongoUri.trim()) {
    throw new Error('FATAL: SCREENSHOT_MONGO_URI must be explicitly supplied. Insecure defaults are forbidden.');
  }

  const jwtSecret = env.SCREENSHOT_JWT_SECRET;
  if (!jwtSecret || typeof jwtSecret !== 'string' || !jwtSecret.trim()) {
    throw new Error('FATAL: SCREENSHOT_JWT_SECRET must be explicitly supplied. Insecure defaults are forbidden.');
  }

  // Minimum length rule: at least 32 characters
  if (jwtSecret.trim().length < 32) {
    throw new Error(`FATAL: SCREENSHOT_JWT_SECRET does not meet length requirements (length ${jwtSecret.trim().length} < 32).`);
  }

  // Shannon entropy rule: must have entropy >= 3.0 and distinct character diversity
  const entropy = computeShannonEntropy(jwtSecret.trim());
  const uniqueChars = new Set(jwtSecret.trim()).size;
  if (entropy < 3.0 || uniqueChars < 8) {
    throw new Error(`FATAL: SCREENSHOT_JWT_SECRET does not meet entropy requirements (Shannon entropy ${entropy.toFixed(2)} < 3.0 or repeated characters, unique: ${uniqueChars}).`);
  }

  // Parse Mongo URI
  let parsed;
  try {
    const urlStr = mongoUri.replace(/^mongodb(\+srv)?:\/\//, 'http://');
    parsed = new URL(urlStr);
  } catch (err) {
    throw new Error(`FATAL: Invalid SCREENSHOT_MONGO_URI format: ${err.message}`);
  }

  const host = parsed.hostname;
  const isLoopback = host === '127.0.0.1' || host === 'localhost' || host === '::1';
  if (!isLoopback) {
    throw new Error(`FATAL: SCREENSHOT_MONGO_URI must target a loopback host (127.0.0.1 or localhost). Refusing remote host "${host}".`);
  }

  let dbName = parsed.pathname.replace(/^\//, '').split('?')[0];
  if (!dbName || FORBIDDEN_DB_NAMES.has(dbName.toLowerCase())) {
    throw new Error(`FATAL: Refusing to execute against production or default database "${dbName}".`);
  }

  if (!dbName.toLowerCase().includes('visual_qa') && !dbName.toLowerCase().includes('_qa')) {
    throw new Error(`FATAL: Target database "${dbName}" must be explicitly designated for visual QA (must contain "visual_qa" or "_qa").`);
  }

  return {
    mongoUri,
    dbName,
    jwtSecret,
  };
}

/**
 * Generate a unique ephemeral database URI for this QA run
 */
function createEphemeralDbUri(baseMongoUri, runId = crypto.randomUUID().slice(0, 8)) {
  const urlStr = baseMongoUri.replace(/^mongodb:\/\//, 'http://');
  const parsed = new URL(urlStr);
  const ephemeralDbName = `taskflow_visual_qa_${runId}`;
  parsed.pathname = `/${ephemeralDbName}`;
  return {
    runId,
    ephemeralDbName,
    ephemeralMongoUri: parsed.toString().replace(/^http:\/\//, 'mongodb://'),
  };
}

/**
 * Create a temporary browser user-data-dir outside the repository
 */
function createExternalProfileDir(runId = crypto.randomUUID().slice(0, 8)) {
  const tempDir = path.join(os.tmpdir(), `taskflow_qa_profile_${runId}`);
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  return tempDir;
}

/**
 * Safely remove temporary browser profile directory
 */
function removeExternalProfileDir(tempDir) {
  if (tempDir && fs.existsSync(tempDir)) {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (e) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch (err2) {
        console.warn(`Warning: Could not remove temporary profile directory: ${err2.message}`);
      }
    }
  }
}

/**
 * Clean up ephemeral database and verify it is dropped/absent
 */
async function cleanupEphemeralDatabase(connection, ephemeralDbName) {
  if (!connection || !ephemeralDbName) {
    throw new Error('FATAL: Database connection and ephemeralDbName are required for cleanup.');
  }

  if (FORBIDDEN_DB_NAMES.has(ephemeralDbName.toLowerCase())) {
    throw new Error(`FATAL: Refusing to drop database "${ephemeralDbName}".`);
  }

  try {
    const db = connection.useDb(ephemeralDbName);
    await db.dropDatabase();

    const collections = await db.db.listCollections().toArray();
    if (collections.length > 0) {
      throw new Error(`Verification failed: database "${ephemeralDbName}" still contains ${collections.length} collections after drop.`);
    }
    return { success: true, droppedDb: ephemeralDbName };
  } catch (err) {
    const cleanupErr = new Error(`FATAL: Ephemeral database cleanup failed: ${err.message}`);
    cleanupErr.isCleanupFailure = true;
    throw cleanupErr;
  }
}

/**
 * Find an available loopback TCP port without collisions
 */
async function findCollisionSafePort(startPort = 5050, maxAttempts = 50) {
  const net = require('net');
  for (let port = startPort; port < startPort + maxAttempts; port++) {
    const available = await new Promise((resolve) => {
      const server = net.createServer();
      server.unref();
      server.on('error', () => resolve(false));
      server.listen({ port, host: '127.0.0.1' }, () => {
        server.close(() => resolve(true));
      });
    });
    if (available) return port;
  }
  throw new Error(`Could not find an available loopback port in range ${startPort}..${startPort + maxAttempts}`);
}

/**
 * Sanitize harness log output to guarantee no leaked tokens or credentials
 */
function sanitizeHarnessLog(logStr) {
  if (!logStr || typeof logStr !== 'string') return '';
  return logStr
    .replace(/(?:password|token|secret|jwt)\s*[:=]\s*['"]?[^\s'",]+['"]?/gi, (match) => {
      const parts = match.split(/[:=]/);
      return `${parts[0]}: [REDACTED]`;
    })
    .replace(/mongodb(\+srv)?:\/\/[^@\s]+@/gi, 'mongodb://[REDACTED]@');
}

module.exports = {
  validateHarnessEnvironment,
  createEphemeralDbUri,
  createExternalProfileDir,
  removeExternalProfileDir,
  cleanupEphemeralDatabase,
  computeShannonEntropy,
  findCollisionSafePort,
  sanitizeHarnessLog,
  FORBIDDEN_DB_NAMES,
};
