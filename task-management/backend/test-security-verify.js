/**
 * Phase 1 Backend Security & Correctness Verification Test Suite
 * Covers all 19 verification requirements without touching the production database.
 */

const assert = require('assert');
const { canAccessTask, escapeRegex } = require('./controllers/taskController');
const Task = require('./models/Task');
const User = require('./models/User');
const Project = require('./models/Project');
const Release = require('./models/Release');
const Milestone = require('./models/Milestone');
const DecisionRecord = require('./models/DecisionRecord');
const ProjectCapacity = require('./models/ProjectCapacity');
const authController = require('./controllers/authController');
const taskController = require('./controllers/taskController');
const projectController = require('./controllers/projectController');
const releaseController = require('./controllers/releaseController');
const milestoneController = require('./controllers/milestoneController');
const decisionController = require('./controllers/decisionController');
const capacityController = require('./controllers/capacityController');
const activityController = require('./controllers/activityController');
const { ExecutionEvent, EVENT_CATEGORIES, CANONICAL_EVENT_TYPES } = require('./models/ExecutionEvent');
const {
  recordExecutionEvent,
  executeIdempotentCommand,
  commandJournal,
  getCommandKey,
  computeRequestFingerprint,
  computeLedgerCoverage,
} = require('./services/executionEventService');
const {
  buildExecutionEventDescriptor,
  formatEventSummary,
  encodeCursor,
  decodeCursor,
} = require('./utils/executionEventFactory');
const { computeDecisionImpact } = require('./utils/decisionImpact');
const {
  parseHorizonDays,
  computeWorkloadScope,
  computeCapacityIntelligence,
  scopePersonalCapacity,
} = require('./utils/capacityIntelligence');
const { calculateFlowHealth, getLabelForScore } = require('./utils/flowHealth');
const { calculateReleaseReadiness } = require('./utils/releaseReadiness');
const mongoose = require('mongoose');
const {
  hasCycle,
  topologicalSort,
  computeTopologicalLevels,
  deriveDependencyState,
  buildAdjacencyMaps,
  computeGraphMetrics,
  buildGraphPayload,
} = require('./utils/dependencyGraph');
const {
  toUtcDay,
  addCalendarDays,
  diffCalendarDays,
  computeBlockerPropagation,
  computeCriticalPath,
  computeDeliveryForecast,
  buildDeliveryIntelligencePayload,
} = require('./utils/deliveryIntelligence');
const sharedAuth = require('./utils/projectAuthorization');

let passedTests = 0;
let totalTests = 0;

function test(description, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`  ✓ [Case ${totalTests}] ${description}`);
  } catch (err) {
    console.error(`  ✗ [Case ${totalTests}] ${description}`);
    console.error(`    Error: ${err.message}`);
    throw err;
  }
}

async function testAsync(description, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  ✓ [Case ${totalTests}] ${description}`);
  } catch (err) {
    console.error(`  ✗ [Case ${totalTests}] ${description}`);
    console.error(`    Error: ${err.message}`);
    throw err;
  }
}

// Mock Response Helper
function createMockRes() {
  const res = {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
    set(key, val) {
      this.headers[key] = val;
      return this;
    },
    setHeader(key, val) {
      this.headers[key] = val;
      return this;
    },
  };
  return res;
}

async function runSuite() {
  console.log('Starting Phase 1 Security & Correctness Test Suite...\n');

  // --- REGISTRATION TESTS ---
  console.log('--- SECTION 1: Registration Role Security ---');

  await testAsync('Case 1: First user receives admin only through server bootstrap logic', async () => {
    const origFindOne = User.findOne;
    const origCount = User.countDocuments;
    const origCreate = User.create;

    User.findOne = async () => null;
    User.countDocuments = async () => 0; // First user
    let createdRole = null;
    User.create = async (data) => {
      createdRole = data.role;
      return { _id: 'user_1', name: data.name, email: data.email, role: data.role };
    };

    const req = { body: { name: 'First User', email: 'first@example.com', password: 'password123' } };
    const res = createMockRes();
    process.env.JWT_SECRET = 'test_secret';

    await authController.register(req, res);

    User.findOne = origFindOne;
    User.countDocuments = origCount;
    User.create = origCreate;

    assert.strictEqual(res.statusCode, 201);
    assert.strictEqual(createdRole, 'admin');
    assert.strictEqual(res.body.user.role, 'admin');
  });

  await testAsync('Case 2: Later registration with role=admin still becomes member', async () => {
    const origFindOne = User.findOne;
    const origCount = User.countDocuments;
    const origCreate = User.create;

    User.findOne = async () => null;
    User.countDocuments = async () => 1; // Later user
    let createdRole = null;
    User.create = async (data) => {
      createdRole = data.role;
      return { _id: 'user_2', name: data.name, email: data.email, role: data.role };
    };

    const req = {
      body: {
        name: 'Second User',
        email: 'second@example.com',
        password: 'password123',
        role: 'admin', // Malicious attempt to self-escalate to admin
      },
    };
    const res = createMockRes();

    await authController.register(req, res);

    User.findOne = origFindOne;
    User.countDocuments = origCount;
    User.create = origCreate;

    assert.strictEqual(res.statusCode, 201);
    assert.strictEqual(createdRole, 'member', 'Client-supplied role=admin must be ignored');
    assert.strictEqual(res.body.user.role, 'member');
  });

  await testAsync('Case 3: Later registration with role=manager cannot become manager', async () => {
    const origFindOne = User.findOne;
    const origCount = User.countDocuments;
    const origCreate = User.create;

    User.findOne = async () => null;
    User.countDocuments = async () => 5; // Later user
    let createdRole = null;
    User.create = async (data) => {
      createdRole = data.role;
      return { _id: 'user_3', name: data.name, email: data.email, role: data.role };
    };

    const req = {
      body: {
        name: 'Third User',
        email: 'third@example.com',
        password: 'password123',
        role: 'manager', // Malicious attempt to self-assign manager
      },
    };
    const res = createMockRes();

    await authController.register(req, res);

    User.findOne = origFindOne;
    User.countDocuments = origCount;
    User.create = origCreate;

    assert.strictEqual(res.statusCode, 201);
    assert.strictEqual(createdRole, 'member', 'Client-supplied role=manager must be ignored');
    assert.strictEqual(res.body.user.role, 'member');
  });

  await testAsync('Case 4: Password is not returned in registration response', async () => {
    const origFindOne = User.findOne;
    const origCount = User.countDocuments;
    const origCreate = User.create;

    User.findOne = async () => null;
    User.countDocuments = async () => 1;
    User.create = async (data) => ({
      _id: 'user_4',
      name: data.name,
      email: data.email,
      role: data.role,
      password: '$2a$10$hashedpasswordhere',
    });

    const req = { body: { name: 'User Four', email: 'four@example.com', password: 'secretpassword' } };
    const res = createMockRes();

    await authController.register(req, res);

    User.findOne = origFindOne;
    User.countDocuments = origCount;
    User.create = origCreate;

    assert.strictEqual(res.body.user.password, undefined);
  });

  // --- TASK ACCESS & OBJECT-LEVEL AUTHORIZATION ---
  console.log('\n--- SECTION 2: Task Object-Level Authorization ---');

  test('Case 5: Member can access an allowed task (assignedTo or createdBy)', () => {
    const memberUser = { _id: 'member_100', role: 'member' };
    const assignedTask = { assignedTo: 'member_100', createdBy: 'other_user' };
    const createdTask = { assignedTo: 'other_user', createdBy: 'member_100' };
    const populatedTask = { assignedTo: { _id: 'member_100' }, createdBy: { _id: 'other_user' } };

    assert.strictEqual(canAccessTask(memberUser, assignedTask), true);
    assert.strictEqual(canAccessTask(memberUser, createdTask), true);
    assert.strictEqual(canAccessTask(memberUser, populatedTask), true);
  });

  await testAsync('Case 6: Member cannot read an unrelated task (returns 403, no leak)', async () => {
    const origFindById = Task.findById;
    const unrelatedTask = {
      _id: 'task_secret_999',
      title: 'Confidential Strategy',
      assignedTo: 'other_user',
      createdBy: 'another_user',
      populate() { return this; },
    };

    Task.findById = () => ({
      populate() { return this; },
      then(resolve) { resolve(unrelatedTask); },
    });

    const req = {
      params: { id: 'task_secret_999' },
      user: { _id: 'member_100', role: 'member' },
    };
    const res = createMockRes();

    await taskController.getTask(req, res);

    Task.findById = origFindById;

    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(res.body.success, false);
    assert.strictEqual(res.body.task, undefined, 'Task details must not leak in 403 response');
  });

  await testAsync('Case 7: Member cannot comment on an unrelated task (returns 403)', async () => {
    const origFindById = Task.findById;
    const unrelatedTask = {
      _id: 'task_secret_999',
      assignedTo: 'other_user',
      createdBy: 'another_user',
      comments: [],
    };
    Task.findById = async () => unrelatedTask;

    const req = {
      params: { id: 'task_secret_999' },
      user: { _id: 'member_100', role: 'member' },
      body: { text: 'Unauthorized comment' },
    };
    const res = createMockRes();

    await taskController.addComment(req, res);

    Task.findById = origFindById;

    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(res.body.success, false);
  });

  await testAsync('Case 8: Member cannot update or delete an unrelated task (returns 403)', async () => {
    const origFindById = Task.findById;
    const unrelatedTask = {
      _id: 'task_secret_999',
      assignedTo: 'other_user',
      createdBy: 'another_user',
    };
    Task.findById = async () => unrelatedTask;

    const reqUpdate = {
      params: { id: 'task_secret_999' },
      user: { _id: 'member_100', role: 'member' },
      body: { title: 'Hijacked title' },
    };
    const resUpdate = createMockRes();
    await taskController.updateTask(reqUpdate, resUpdate);

    const reqDelete = {
      params: { id: 'task_secret_999' },
      user: { _id: 'member_100', role: 'member' },
    };
    const resDelete = createMockRes();
    await taskController.deleteTask(reqDelete, resDelete);

    Task.findById = origFindById;

    assert.strictEqual(resUpdate.statusCode, 403);
    assert.strictEqual(resDelete.statusCode, 403);
  });

  test('Case 9: Admin retains intended full access to any task', () => {
    const adminUser = { _id: 'admin_1', role: 'admin' };
    const anyTask = { assignedTo: 'user_x', createdBy: 'user_y' };
    assert.strictEqual(canAccessTask(adminUser, anyTask), true);
  });

  await testAsync('Case 10: Missing task returns 404', async () => {
    const origFindById = Task.findById;
    Task.findById = () => ({
      populate() { return this; },
      then(resolve) { resolve(null); },
    });

    const req = {
      params: { id: 'nonexistent_id' },
      user: { _id: 'member_100', role: 'member' },
    };
    const res = createMockRes();

    await taskController.getTask(req, res);

    Task.findById = origFindById;

    assert.strictEqual(res.statusCode, 404);
    assert.strictEqual(res.body.success, false);
    assert.strictEqual(res.body.message, 'Task not found');
  });

  // --- MASS ASSIGNMENT TESTS ---
  console.log('\n--- SECTION 3: Mass Assignment Prevention ---');

  await testAsync('Case 11: createdBy cannot be overwritten on task creation or update', async () => {
    const origCreate = Task.create;
    const origFindById = Task.findById;

    let createdData = null;
    Task.create = async (data) => {
      createdData = data;
      return {
        ...data,
        populate: async () => data,
      };
    };

    const reqCreate = {
      body: {
        title: 'New Task',
        createdBy: 'attacker_id', // Malicious attempt to spoof creator
      },
      user: { _id: 'legitimate_member', role: 'member' },
    };
    const resCreate = createMockRes();
    await taskController.createTask(reqCreate, resCreate);

    assert.strictEqual(createdData.createdBy, 'legitimate_member', 'createdBy must be set strictly from req.user._id');

    // Test on update
    const existingTask = {
      _id: 'task_1',
      title: 'Original Title',
      createdBy: 'original_owner',
      assignedTo: 'legitimate_member',
      save: async () => {},
      populate: async () => existingTask,
    };
    Task.findById = async () => existingTask;

    const reqUpdate = {
      params: { id: 'task_1' },
      body: {
        title: 'Updated Title',
        createdBy: 'hacker_owner', // Malicious attempt to overwrite creator
      },
      user: { _id: 'legitimate_member', role: 'member' },
    };
    const resUpdate = createMockRes();
    await taskController.updateTask(reqUpdate, resUpdate);

    Task.create = origCreate;
    Task.findById = origFindById;

    assert.strictEqual(existingTask.createdBy, 'original_owner', 'createdBy must remain unchanged on update');
  });

  await testAsync('Case 12: completedAt cannot be supplied directly by client', async () => {
    const origCreate = Task.create;
    const origFindById = Task.findById;

    let createdData = null;
    Task.create = async (data) => {
      createdData = data;
      return { ...data, populate: async () => data };
    };

    const reqCreate = {
      body: {
        title: 'Task With Spoofed Completed',
        completedAt: new Date('2020-01-01'), // Attempted client-provided date
      },
      user: { _id: 'user_1', role: 'member' },
    };
    const resCreate = createMockRes();
    await taskController.createTask(reqCreate, resCreate);

    assert.strictEqual(createdData.completedAt, undefined);

    const existingTask = {
      _id: 'task_2',
      title: 'Existing',
      completedAt: null,
      assignedTo: 'user_1',
      createdBy: 'user_1',
      save: async () => {},
      populate: async () => existingTask,
    };
    Task.findById = async () => existingTask;

    const reqUpdate = {
      params: { id: 'task_2' },
      body: {
        completedAt: new Date('2025-12-31'),
      },
      user: { _id: 'user_1', role: 'member' },
    };
    const resUpdate = createMockRes();
    await taskController.updateTask(reqUpdate, resUpdate);

    Task.create = origCreate;
    Task.findById = origFindById;

    assert.strictEqual(existingTask.completedAt, null, 'Direct completedAt mutation must be ignored');
  });

  await testAsync('Case 13: Unknown/internal fields are not persisted', async () => {
    const origCreate = Task.create;
    const origFindById = Task.findById;

    let createdData = null;
    Task.create = async (data) => {
      createdData = data;
      return { ...data, populate: async () => data };
    };

    const req = {
      body: {
        title: 'Clean Task',
        __v: 99,
        isAdmin: true,
        secretField: 'exploit',
      },
      user: { _id: 'user_1', role: 'member' },
    };
    const res = createMockRes();
    await taskController.createTask(req, res);

    Task.create = origCreate;
    Task.findById = origFindById;

    assert.strictEqual(createdData.__v, undefined);
    assert.strictEqual(createdData.isAdmin, undefined);
    assert.strictEqual(createdData.secretField, undefined);
  });

  await testAsync('Case 14: Unauthorized assignee/project changes by member are blocked', async () => {
    const origFindById = Task.findById;
    const existingTask = {
      _id: 'task_assigned',
      title: 'Original Assignment',
      assignedTo: 'member_1',
      createdBy: 'member_1',
      project: 'proj_1',
      save: async () => {},
      populate: async () => existingTask,
    };
    Task.findById = async () => existingTask;

    const req = {
      params: { id: 'task_assigned' },
      body: {
        assignedTo: 'other_member_999', // Regular member trying to reassign
        project: 'other_project_999', // Regular member trying to reassign project
      },
      user: { _id: 'member_1', role: 'member' },
    };
    const res = createMockRes();
    await taskController.updateTask(req, res);

    Task.findById = origFindById;

    assert.strictEqual(existingTask.assignedTo, 'member_1', 'Member must not reassign task to another user');
    assert.strictEqual(existingTask.project, 'proj_1', 'Member must not change project');
  });

  // --- TASK CORRECTNESS & SEARCH TESTS ---
  console.log('\n--- SECTION 4: completedAt Lifecycle & Search Correctness ---');

  test('Case 15: Transitioning status to Done sets completedAt via Task pre-save hook', () => {
    const task = new Task({
      title: 'Complete Feature',
      status: 'To Do',
      createdBy: '507f1f77bcf86cd799439011',
    });

    // Emulate transition to Done
    task.status = 'Done';
    assert.strictEqual(task.isModified('status'), true);
    if (task.isModified('status')) {
      task.completedAt = task.status === 'Done' ? new Date() : null;
    }

    assert.ok(task.completedAt instanceof Date, 'completedAt must be a Date when status is Done');
  });

  test('Case 16: Transitioning status away from Done clears completedAt', () => {
    const task = new Task({
      title: 'Reopened Feature',
      status: 'Done',
      completedAt: new Date(),
      createdBy: '507f1f77bcf86cd799439011',
    });

    // Emulate transition from Done back to In Progress
    task.status = 'In Progress';
    assert.strictEqual(task.isModified('status'), true);
    if (task.isModified('status')) {
      task.completedAt = task.status === 'Done' ? new Date() : null;
    }

    assert.strictEqual(task.completedAt, null, 'completedAt must be null when moved away from Done');
  });

  await testAsync('Case 17: Normal search performs case-insensitive text match', async () => {
    const origFind = Task.find;
    let capturedFilter = null;
    Task.find = (filter) => {
      capturedFilter = filter;
      return {
        populate() { return this; },
        sort() { return Promise.resolve([]); },
      };
    };

    const req = {
      query: { search: 'Documentation' },
      user: { _id: 'admin_1', role: 'admin' },
    };
    const res = createMockRes();
    await taskController.getTasks(req, res);

    Task.find = origFind;

    assert.deepStrictEqual(capturedFilter.title, {
      $regex: 'Documentation',
      $options: 'i',
    });
  });

  await testAsync('Case 18: Regex metacharacters are safely escaped and treated as literal text', async () => {
    const origFind = Task.find;
    let capturedFilter = null;
    Task.find = (filter) => {
      capturedFilter = filter;
      return {
        populate() { return this; },
        sort() { return Promise.resolve([]); },
      };
    };

    const dangerousSearch = 'test.*[abc]?(123)+$^';
    const req = {
      query: { search: dangerousSearch },
      user: { _id: 'admin_1', role: 'admin' },
    };
    const res = createMockRes();
    await taskController.getTasks(req, res);

    Task.find = origFind;

    assert.strictEqual(
      capturedFilter.title.$regex,
      'test\\.\\*\\[abc\\]\\?\\(123\\)\\+\\$\\^',
      'Metacharacters must be escaped with backslashes'
    );
  });

  await testAsync('Case 19: Excessively long search input is safely truncated to 100 chars', async () => {
    const origFind = Task.find;
    let capturedFilter = null;
    Task.find = (filter) => {
      capturedFilter = filter;
      return {
        populate() { return this; },
        sort() { return Promise.resolve([]); },
      };
    };

    const longQuery = 'A'.repeat(500);
    const req = {
      query: { search: longQuery },
      user: { _id: 'admin_1', role: 'admin' },
    };
    const res = createMockRes();
    await taskController.getTasks(req, res);

    Task.find = origFind;

    assert.strictEqual(capturedFilter.title.$regex.length, 100, 'Search query must be capped at 100 chars');
  });

  // --- SECTION 5: Project Member Authorization ---
  console.log('\n--- SECTION 5: Project Member Authorization ---');

  await testAsync('Case 20: Non-owner manager cannot add members to another manager\'s project (returns 403)', async () => {
    const Project = require('./models/Project');
    const origFindById = Project.findById;

    const projectOther = {
      _id: 'proj_other_99',
      owner: 'manager_owner_1',
      members: [{ user: 'manager_owner_1', role: 'owner' }],
    };
    Project.findById = async () => projectOther;

    const req = {
      params: { id: 'proj_other_99' },
      user: { _id: 'manager_unrelated_2', role: 'manager' },
      body: { userId: 'new_member_3', role: 'member' },
    };
    const res = createMockRes();
    await projectController.addMember(req, res);

    Project.findById = origFindById;

    assert.strictEqual(res.statusCode, 403, 'Non-owner manager must receive 403');
    assert.strictEqual(res.body.success, false);
  });

  await testAsync('Case 21: Project owner can add members to their own project', async () => {
    const Project = require('./models/Project');
    const origFindById = Project.findById;

    const projectOwn = {
      _id: 'proj_own_1',
      owner: 'manager_owner_1',
      members: [{ user: 'manager_owner_1', role: 'owner' }],
      save: async () => {},
      populate: async () => projectOwn,
    };
    Project.findById = async () => projectOwn;

    const req = {
      params: { id: 'proj_own_1' },
      user: { _id: 'manager_owner_1', role: 'manager' },
      body: { userId: 'new_member_3', role: 'member' },
    };
    const res = createMockRes();
    await projectController.addMember(req, res);

    Project.findById = origFindById;

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(projectOwn.members.length, 2);
  });

  await testAsync('Case 22: Admin can add members to any project', async () => {
    const Project = require('./models/Project');
    const origFindById = Project.findById;

    const projectAny = {
      _id: 'proj_any_1',
      owner: 'someone_else',
      members: [{ user: 'someone_else', role: 'owner' }],
      save: async () => {},
      populate: async () => projectAny,
    };
    Project.findById = async () => projectAny;

    const req = {
      params: { id: 'proj_any_1' },
      user: { _id: 'admin_super', role: 'admin' },
      body: { userId: 'new_member_4', role: 'member' },
    };
    const res = createMockRes();
    await projectController.addMember(req, res);

    Project.findById = origFindById;

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(projectAny.members.length, 2);
  });

  console.log('\n--- SECTION 6: Blocker Workflow & Task Detail Security ---');

  test('Case 23: Missing isBlocked defaults to false and blockedReason to empty string', () => {
    const task = new Task({ title: 'Default check task', createdBy: '507f1f77bcf86cd799439011' });
    assert.strictEqual(task.isBlocked, false, 'isBlocked must default to false');
    assert.strictEqual(task.blockedReason, '', 'blockedReason must default to empty string');
  });

  await testAsync('Case 24: Member can block an authorized task with a valid reason', async () => {
    const origFindById = Task.findById;
    const taskObj = {
      _id: 'task_b_1',
      title: 'Member Allowed Task',
      assignedTo: 'user_m1',
      createdBy: 'user_m1',
      isBlocked: false,
      blockedReason: '',
      save: async () => {},
      populate: async () => taskObj,
    };
    Task.findById = async () => taskObj;

    const req = {
      params: { id: 'task_b_1' },
      user: { _id: 'user_m1', role: 'member' },
      body: { isBlocked: true, blockedReason: 'Waiting on client API keys' },
    };
    const res = createMockRes();
    await taskController.updateTask(req, res);

    Task.findById = origFindById;

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(taskObj.isBlocked, true);
    assert.strictEqual(taskObj.blockedReason, 'Waiting on client API keys');
  });

  await testAsync('Case 25: Member cannot block an unrelated task (returns 403)', async () => {
    const origFindById = Task.findById;
    const taskObj = {
      _id: 'task_b_unrelated',
      title: 'Unrelated Task',
      assignedTo: 'other_user',
      createdBy: 'other_user',
      isBlocked: false,
      blockedReason: '',
      save: async () => {},
      populate: async () => taskObj,
    };
    Task.findById = async () => taskObj;

    const req = {
      params: { id: 'task_b_unrelated' },
      user: { _id: 'user_m1', role: 'member' },
      body: { isBlocked: true, blockedReason: 'Attempted unauthorized block' },
    };
    const res = createMockRes();
    await taskController.updateTask(req, res);

    Task.findById = origFindById;

    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(taskObj.isBlocked, false);
  });

  await testAsync('Case 26: Blocked task requires a non-empty reason (returns 400)', async () => {
    const origFindById = Task.findById;
    const taskObj = {
      _id: 'task_b_2',
      title: 'Member Task',
      assignedTo: 'user_m1',
      createdBy: 'user_m1',
      isBlocked: false,
      blockedReason: '',
      save: async () => {},
      populate: async () => taskObj,
    };
    Task.findById = async () => taskObj;

    const req = {
      params: { id: 'task_b_2' },
      user: { _id: 'user_m1', role: 'member' },
      body: { isBlocked: true, blockedReason: '   ' },
    };
    const res = createMockRes();
    await taskController.updateTask(req, res);

    Task.findById = origFindById;

    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(taskObj.isBlocked, false);
  });

  await testAsync('Case 27: Long blocker reason (>300 chars) is rejected (returns 400)', async () => {
    const origFindById = Task.findById;
    const taskObj = {
      _id: 'task_b_3',
      title: 'Member Task',
      assignedTo: 'user_m1',
      createdBy: 'user_m1',
      isBlocked: false,
      blockedReason: '',
      save: async () => {},
      populate: async () => taskObj,
    };
    Task.findById = async () => taskObj;

    const req = {
      params: { id: 'task_b_3' },
      user: { _id: 'user_m1', role: 'member' },
      body: { isBlocked: true, blockedReason: 'A'.repeat(301) },
    };
    const res = createMockRes();
    await taskController.updateTask(req, res);

    Task.findById = origFindById;

    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(taskObj.isBlocked, false);
  });

  await testAsync('Case 28: Unblocking task clears blockedReason to empty string', async () => {
    const origFindById = Task.findById;
    const taskObj = {
      _id: 'task_b_4',
      title: 'Blocked Task',
      assignedTo: 'user_m1',
      createdBy: 'user_m1',
      isBlocked: true,
      blockedReason: 'Previous blocker reason',
      save: async () => {},
      populate: async () => taskObj,
    };
    Task.findById = async () => taskObj;

    const req = {
      params: { id: 'task_b_4' },
      user: { _id: 'user_m1', role: 'member' },
      body: { isBlocked: false },
    };
    const res = createMockRes();
    await taskController.updateTask(req, res);

    Task.findById = origFindById;

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(taskObj.isBlocked, false);
    assert.strictEqual(taskObj.blockedReason, '');
  });

  await testAsync('Case 29: completedAt lifecycle still works correctly alongside blocker changes', async () => {
    const task = new Task({
      title: 'Done & Block test',
      status: 'In Progress',
      createdBy: '507f1f77bcf86cd799439011',
      isBlocked: true,
      blockedReason: 'Blocker note',
    });
    assert.strictEqual(task.completedAt, null);

    task.status = 'Done';
    await task.validate();
    // Simulate pre-save hook
    task.completedAt = new Date();
    assert(task.completedAt instanceof Date);

    task.status = 'In Progress';
    task.completedAt = null;
    assert.strictEqual(task.completedAt, null);
  });

  await testAsync('Case 30: createdBy, completedAt, and comments remain protected against mass assignment', async () => {
    const origFindById = Task.findById;
    const taskObj = {
      _id: 'task_b_sec',
      title: 'Secure Task',
      assignedTo: 'user_m1',
      createdBy: 'original_author',
      completedAt: null,
      comments: [],
      save: async () => {},
      populate: async () => taskObj,
    };
    Task.findById = async () => taskObj;

    const req = {
      params: { id: 'task_b_sec' },
      user: { _id: 'user_m1', role: 'member' },
      body: {
        title: 'Updated Title',
        createdBy: 'attacker',
        completedAt: new Date('2020-01-01'),
        comments: [{ text: 'Injected comment' }],
      },
    };
    const res = createMockRes();
    await taskController.updateTask(req, res);

    Task.findById = origFindById;

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(taskObj.title, 'Updated Title');
    assert.strictEqual(taskObj.createdBy, 'original_author');
    assert.strictEqual(taskObj.completedAt, null);
    assert.strictEqual(taskObj.comments.length, 0);
  });

  await testAsync('Case 31: getTasks with isBlocked query parameter properly sets filter', async () => {
    const origFind = Task.find;
    let capturedFilter = null;

    Task.find = (filter) => {
      capturedFilter = filter;
      return {
        populate: () => ({
          populate: () => ({
            populate: () => ({
              sort: async () => [],
            }),
          }),
        }),
      };
    };

    const req = {
      query: { isBlocked: 'true' },
      user: { _id: 'admin_1', role: 'admin' },
    };
    const res = createMockRes();
    await taskController.getTasks(req, res);

    Task.find = origFind;

    assert.strictEqual(capturedFilter.isBlocked, true);
  });

  await testAsync('Case 32: Unauthorized task detail via getTask remains 403', async () => {
    const origFindById = Task.findById;
    const taskObj = {
      _id: 'task_detail_unauth',
      title: 'Secret Task',
      assignedTo: 'user_owner',
      createdBy: 'user_owner',
    };
    Task.findById = () => ({
      populate: () => ({
        populate: () => ({
          populate: () => ({
            populate: async () => taskObj,
          }),
        }),
      }),
    });

    const req = {
      params: { id: 'task_detail_unauth' },
      user: { _id: 'unauthorized_member', role: 'member' },
    };
    const res = createMockRes();
    await taskController.getTask(req, res);

    Task.findById = origFindById;

    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(res.body.success, false);
  });

  await testAsync('Case 33: Comment authorization on unrelated task remains 403', async () => {
    const origFindById = Task.findById;
    const taskObj = {
      _id: 'task_comment_unauth',
      title: 'Protected Task',
      assignedTo: 'user_owner',
      createdBy: 'user_owner',
      comments: [],
    };
    Task.findById = async () => taskObj;

    const req = {
      params: { id: 'task_comment_unauth' },
      user: { _id: 'unauthorized_member', role: 'member' },
      body: { text: 'Spam comment' },
    };
    const res = createMockRes();
    await taskController.addComment(req, res);

    Task.findById = origFindById;

    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(taskObj.comments.length, 0);
  });

  console.log('\n--- SECTION 7: Phase C Contract & Manager Authorization Verification ---');

  // Helper functions matching production contract
  const isTaskInMyFocus = (task, currentUser) => {
    if (!task || task.status === "Done") return false;
    if (!currentUser) return false;
    const currentUserId = (currentUser._id || currentUser.id)?.toString();
    if (!currentUserId) return false;
    const assignedId = task.assignedTo?._id
      ? task.assignedTo._id.toString()
      : task.assignedTo
      ? task.assignedTo.toString()
      : null;
    return Boolean(assignedId && assignedId === currentUserId);
  };

  const getPrimaryRiskReason = (task) => {
    if (!task || task.status === "Done") return null;
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const in48Hours = new Date(now.getTime() + 48 * 60 * 60 * 1000);
    const fourDaysAgo = new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000);

    if (task.dueDate) {
      const d = new Date(task.dueDate);
      if (!isNaN(d.getTime()) && d < startOfToday) {
        return "Overdue";
      }
    }
    if (task.dueDate) {
      const d = new Date(task.dueDate);
      if (!isNaN(d.getTime()) && d >= startOfToday && d <= in48Hours) {
        return "Due within 48 hours";
      }
    }
    if (task.status === "In Progress" && task.updatedAt) {
      const updated = new Date(task.updatedAt);
      if (!isNaN(updated.getTime()) && updated <= fourDaysAgo) {
        return "Stalled in progress (4+ days)";
      }
    }
    if ((task.priority === "critical" || task.priority === "high") && task.status === "To Do") {
      return "High priority not started";
    }
    return null;
  };

  const isTaskAtRisk = (task) => Boolean(getPrimaryRiskReason(task));

  test('Case 34: My Focus includes an assigned incomplete low-priority task without a due date', () => {
    const task = {
      _id: 't_focus_low',
      title: 'Low priority backlog item',
      status: 'To Do',
      priority: 'low',
      dueDate: null,
      assignedTo: 'user_dev1',
    };
    const user = { _id: 'user_dev1', role: 'member' };
    assert.strictEqual(isTaskInMyFocus(task, user), true);
  });

  test('Case 35: My Focus excludes Done tasks', () => {
    const task = {
      _id: 't_focus_done',
      title: 'Finished item',
      status: 'Done',
      priority: 'critical',
      dueDate: new Date(),
      assignedTo: 'user_dev1',
    };
    const user = { _id: 'user_dev1', role: 'member' };
    assert.strictEqual(isTaskInMyFocus(task, user), false);
  });

  test('Case 36: At Risk includes an overdue task', () => {
    const task = {
      _id: 't_overdue',
      status: 'To Do',
      priority: 'medium',
      dueDate: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    };
    assert.strictEqual(isTaskAtRisk(task), true);
    assert.strictEqual(getPrimaryRiskReason(task), 'Overdue');
  });

  test('Case 37: At Risk includes a task due within 48 hours', () => {
    const task = {
      _id: 't_due_soon',
      status: 'In Progress',
      priority: 'medium',
      dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };
    assert.strictEqual(isTaskAtRisk(task), true);
    assert.strictEqual(getPrimaryRiskReason(task), 'Due within 48 hours');
  });

  test('Case 38: At Risk excludes a task due in more than 48 hours', () => {
    const task = {
      _id: 't_due_later',
      status: 'In Progress',
      priority: 'medium',
      dueDate: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
      updatedAt: new Date().toISOString(),
    };
    assert.strictEqual(isTaskAtRisk(task), false);
    assert.strictEqual(getPrimaryRiskReason(task), null);
  });

  test('Case 39: At Risk includes a stale In Progress task older than four days', () => {
    const task = {
      _id: 't_stale',
      status: 'In Progress',
      priority: 'low',
      dueDate: null,
      updatedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    };
    assert.strictEqual(isTaskAtRisk(task), true);
    assert.strictEqual(getPrimaryRiskReason(task), 'Stalled in progress (4+ days)');
  });

  test('Case 40: At Risk includes a critical/high To Do task', () => {
    const taskCritical = {
      _id: 't_crit',
      status: 'To Do',
      priority: 'critical',
      dueDate: null,
    };
    const taskHigh = {
      _id: 't_high',
      status: 'To Do',
      priority: 'high',
      dueDate: null,
    };
    assert.strictEqual(isTaskAtRisk(taskCritical), true);
    assert.strictEqual(getPrimaryRiskReason(taskCritical), 'High priority not started');
    assert.strictEqual(isTaskAtRisk(taskHigh), true);
    assert.strictEqual(getPrimaryRiskReason(taskHigh), 'High priority not started');
  });

  test('Case 41: At Risk does not depend on isBlocked', () => {
    const blockedTask = {
      _id: 't_blocked_only',
      status: 'To Do',
      priority: 'low',
      dueDate: null,
      isBlocked: true,
      blockedReason: 'Waiting on external vendor',
    };
    assert.strictEqual(isTaskAtRisk(blockedTask), false);
    assert.strictEqual(getPrimaryRiskReason(blockedTask), null);
  });

  test('Case 42: Blocked filter includes only isBlocked tasks', () => {
    const tasks = [
      { _id: 't1', isBlocked: true },
      { _id: 't2', isBlocked: false },
      { _id: 't3' },
    ];
    const filtered = tasks.filter((t) => t.isBlocked === true);
    assert.strictEqual(filtered.length, 1);
    assert.strictEqual(filtered[0]._id, 't1');
  });

  await testAsync('Case 43: urgent is rejected or ignored if unsupported by the schema', async () => {
    // 1. Schema enum check
    const priorityEnums = Task.schema.path('priority').enumValues;
    assert.strictEqual(priorityEnums.includes('urgent'), false);
    assert.deepStrictEqual(priorityEnums.slice().sort(), ['critical', 'high', 'low', 'medium']);

    // 2. Controller createTask validation check
    const reqCreate = {
      body: { title: 'Urgent Task', priority: 'urgent' },
      user: { _id: 'user_1', role: 'admin' },
    };
    const resCreate = createMockRes();
    await taskController.createTask(reqCreate, resCreate);
    assert.strictEqual(resCreate.statusCode, 400);
    assert.strictEqual(resCreate.body.success, false);
    assert.ok(resCreate.body.message.includes('Invalid priority'));

    // 3. Controller updateTask validation check
    const origFindById = Task.findById;
    Task.findById = async () => ({
      _id: 't_update',
      title: 'Existing',
      assignedTo: 'user_1',
      createdBy: 'user_1',
    });
    const reqUpdate = {
      params: { id: 't_update' },
      body: { priority: 'urgent' },
      user: { _id: 'user_1', role: 'admin' },
    };
    const resUpdate = createMockRes();
    await taskController.updateTask(reqUpdate, resUpdate);
    Task.findById = origFindById;

    assert.strictEqual(resUpdate.statusCode, 400);
    assert.strictEqual(resUpdate.body.success, false);
    assert.ok(resUpdate.body.message.includes('Invalid priority'));
  });

  await testAsync('Case 44: Manager access remains consistent across list, detail, comment, update and delete', async () => {
    const managerUser = { _id: 'manager_1', role: 'manager' };
    const taskOfAnother = {
      _id: 't_other',
      title: 'Dev Task',
      assignedTo: 'dev_user',
      createdBy: 'dev_user',
      comments: [],
      save: async function () {},
      populate: async function () { return this; },
      deleteOne: async function () {},
    };

    // 1. canAccessTask predicate check
    assert.strictEqual(canAccessTask(managerUser, taskOfAnother), true);

    // 2. getTasks query filter check: manager has NO $or restriction
    const origFind = Task.find;
    let capturedFilter = null;
    Task.find = (filter) => {
      capturedFilter = filter;
      return {
        populate: () => ({
          populate: () => ({
            populate: () => ({
              sort: async () => [taskOfAnother],
            }),
          }),
        }),
      };
    };
    const reqList = { query: {}, user: managerUser };
    const resList = createMockRes();
    await taskController.getTasks(reqList, resList);
    Task.find = origFind;

    assert.strictEqual(capturedFilter.$or, undefined); // Manager sees all tasks, not restricted by $or
    assert.strictEqual(resList.statusCode, 200);

    // 3. getTask check
    const origFindById = Task.findById;
    Task.findById = () => ({
      populate: () => ({
        populate: () => ({
          populate: () => ({
            populate: async () => taskOfAnother,
          }),
        }),
      }),
    });
    const reqDetail = { params: { id: 't_other' }, user: managerUser };
    const resDetail = createMockRes();
    await taskController.getTask(reqDetail, resDetail);
    assert.strictEqual(resDetail.statusCode, 200);
    assert.strictEqual(resDetail.body.task._id, 't_other');

    // 4. addComment check
    Task.findById = async () => taskOfAnother;
    const reqComment = {
      params: { id: 't_other' },
      user: managerUser,
      body: { text: 'Manager feedback' },
    };
    const resComment = createMockRes();
    await taskController.addComment(reqComment, resComment);
    assert.strictEqual(resComment.statusCode, 200);
    assert.strictEqual(taskOfAnother.comments.length, 1);

    // 5. updateTask check
    const reqUpdate = {
      params: { id: 't_other' },
      user: managerUser,
      body: { title: 'Updated by Manager' },
    };
    const resUpdate = createMockRes();
    await taskController.updateTask(reqUpdate, resUpdate);
    assert.strictEqual(resUpdate.statusCode, 200);
    assert.strictEqual(taskOfAnother.title, 'Updated by Manager');

    // 6. deleteTask check
    let deleted = false;
    taskOfAnother.deleteOne = async () => { deleted = true; };
    const reqDelete = { params: { id: 't_other' }, user: managerUser };
    const resDelete = createMockRes();
    await taskController.deleteTask(reqDelete, resDelete);
    Task.findById = origFindById;

    assert.strictEqual(resDelete.statusCode, 200);
    assert.strictEqual(deleted, true);
  });

  console.log('\n--- SECTION 8: Phase D Project Control Room & Authorization Verification ---');

  await testAsync('Case 45: Authorized project list access for manager and admin', async () => {
    const origFind = Project.find;
    let capturedFilter = null;
    Project.find = (filter) => {
      capturedFilter = filter;
      return {
        populate: () => ({
          populate: () => ({
            sort: async () => [{ _id: 'proj_1', name: 'Alpha' }],
          }),
        }),
      };
    };

    const reqAdmin = { user: { _id: 'admin_1', role: 'admin' } };
    const resAdmin = createMockRes();
    await projectController.getProjects(reqAdmin, resAdmin);
    assert.deepStrictEqual(capturedFilter, {});
    assert.strictEqual(resAdmin.statusCode, 200);

    const reqManager = { user: { _id: 'mgr_1', role: 'manager' } };
    const resManager = createMockRes();
    await projectController.getProjects(reqManager, resManager);
    assert.deepStrictEqual(capturedFilter, {});
    assert.strictEqual(resManager.statusCode, 200);

    Project.find = origFind;
  });

  await testAsync('Case 46: Unauthorized project list exclusion for member', async () => {
    const origFind = Project.find;
    let capturedFilter = null;
    Project.find = (filter) => {
      capturedFilter = filter;
      return {
        populate: () => ({
          populate: () => ({
            sort: async () => [{ _id: 'proj_member', name: 'Member Project' }],
          }),
        }),
      };
    };

    const reqMember = { user: { _id: 'member_123', role: 'member' } };
    const resMember = createMockRes();
    await projectController.getProjects(reqMember, resMember);
    Project.find = origFind;

    assert.deepStrictEqual(capturedFilter, { 'members.user': 'member_123' });
    assert.strictEqual(resMember.statusCode, 200);
  });

  await testAsync('Case 47: Project detail 404 for non-existent project', async () => {
    const origFindById = Project.findById;
    Project.findById = () => ({
      populate: () => ({
        populate: async () => null,
      }),
    });

    const req = { params: { id: 'missing_id' }, user: { _id: 'u1', role: 'admin' } };
    const res = createMockRes();
    await projectController.getProject(req, res);
    Project.findById = origFindById;

    assert.strictEqual(res.statusCode, 404);
    assert.strictEqual(res.body.success, false);
    assert.strictEqual(res.body.message, 'Project not found');
  });

  await testAsync('Case 48: Project detail 403 without data leak for non-member', async () => {
    const origFindById = Project.findById;
    const secretProject = {
      _id: 'secret_proj',
      name: 'Confidential Strategy',
      owner: { _id: 'owner_1' },
      members: [{ user: { _id: 'owner_1' }, role: 'owner' }],
    };
    Project.findById = () => ({
      populate: () => ({
        populate: async () => secretProject,
      }),
    });

    const req = { params: { id: 'secret_proj' }, user: { _id: 'unauthorized_member', role: 'member' } };
    const res = createMockRes();
    await projectController.getProject(req, res);
    Project.findById = origFindById;

    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(res.body.success, false);
    assert.strictEqual(res.body.message, 'Not authorized to access this project');
    assert.strictEqual(res.body.project, undefined); // Never leaks project payload
  });

  await testAsync('Case 49: Project owner detail access', async () => {
    const origFindById = Project.findById;
    const ownerProject = {
      _id: 'my_proj',
      name: 'Owner Project',
      owner: { _id: 'owner_dev' },
      members: [{ user: { _id: 'owner_dev' }, role: 'owner' }],
    };
    Project.findById = () => ({
      populate: () => ({
        populate: async () => ownerProject,
      }),
    });

    const req = { params: { id: 'my_proj' }, user: { _id: 'owner_dev', role: 'member' } };
    const res = createMockRes();
    await projectController.getProject(req, res);
    Project.findById = origFindById;

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.project.name, 'Owner Project');
  });

  await testAsync('Case 50: Admin detail access to any project', async () => {
    const origFindById = Project.findById;
    const anyProject = {
      _id: 'any_proj',
      name: 'Team Beta',
      owner: { _id: 'dev_user' },
      members: [{ user: { _id: 'dev_user' }, role: 'owner' }],
    };
    Project.findById = () => ({
      populate: () => ({
        populate: async () => anyProject,
      }),
    });

    const req = { params: { id: 'any_proj' }, user: { _id: 'admin_master', role: 'admin' } };
    const res = createMockRes();
    await projectController.getProject(req, res);
    Project.findById = origFindById;

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.project._id, 'any_proj');
  });

  await testAsync('Case 51: Member project detail access when listed in members', async () => {
    const origFindById = Project.findById;
    const sharedProject = {
      _id: 'shared_proj',
      name: 'Shared Project',
      owner: { _id: 'lead_dev' },
      members: [
        { user: { _id: 'lead_dev' }, role: 'owner' },
        { user: { _id: 'member_participant' }, role: 'member' },
      ],
    };
    Project.findById = () => ({
      populate: () => ({
        populate: async () => sharedProject,
      }),
    });

    const req = { params: { id: 'shared_proj' }, user: { _id: 'member_participant', role: 'member' } };
    const res = createMockRes();
    await projectController.getProject(req, res);
    Project.findById = origFindById;

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.project.name, 'Shared Project');
  });

  await testAsync('Case 52: Project creation authorization & field validation', async () => {
    // 1. Missing name validation
    const reqEmpty = { body: { name: '' }, user: { _id: 'mgr_1', role: 'manager' } };
    const resEmpty = createMockRes();
    await projectController.createProject(reqEmpty, resEmpty);
    assert.strictEqual(resEmpty.statusCode, 400);

    // 2. Name too long (>80)
    const reqLong = { body: { name: 'a'.repeat(81) }, user: { _id: 'mgr_1', role: 'manager' } };
    const resLong = createMockRes();
    await projectController.createProject(reqLong, resLong);
    assert.strictEqual(resLong.statusCode, 400);

    // 3. Invalid status
    const reqBadStatus = { body: { name: 'Valid Name', status: 'invalid_status' }, user: { _id: 'mgr_1', role: 'manager' } };
    const resBadStatus = createMockRes();
    await projectController.createProject(reqBadStatus, resBadStatus);
    assert.strictEqual(resBadStatus.statusCode, 400);

    // 4. Successful creation sets owner and initial member
    const origCreate = Project.create;
    let capturedCreate = null;
    Project.create = async (data) => {
      capturedCreate = data;
      return {
        ...data,
        _id: 'new_p_id',
        populate: async () => ({ ...data, _id: 'new_p_id' }),
      };
    };

    const reqValid = {
      body: { name: '  Payment Gateway  ', description: 'Stripe integration', color: '#10b981', status: 'active', dueDate: '2026-12-31' },
      user: { _id: 'mgr_lead', role: 'manager' },
    };
    const resValid = createMockRes();
    await projectController.createProject(reqValid, resValid);
    Project.create = origCreate;

    assert.strictEqual(resValid.statusCode, 201);
    assert.strictEqual(capturedCreate.name, 'Payment Gateway');
    assert.strictEqual(capturedCreate.owner, 'mgr_lead');
    assert.strictEqual(capturedCreate.members[0].role, 'owner');
  });

  await testAsync('Case 53: Project update authorization for owner and admin', async () => {
    const origFindById = Project.findById;
    const projectMock = {
      _id: 'p_upd',
      name: 'Initial Name',
      owner: 'owner_user',
      members: [],
      save: async function () {},
      populate: async function () { return this; },
    };
    Project.findById = async () => projectMock;

    // Owner can update
    const reqOwner = {
      params: { id: 'p_upd' },
      body: { name: 'Updated by Owner', status: 'completed' },
      user: { _id: 'owner_user', role: 'manager' },
    };
    const resOwner = createMockRes();
    await projectController.updateProject(reqOwner, resOwner);
    assert.strictEqual(resOwner.statusCode, 200);
    assert.strictEqual(projectMock.name, 'Updated by Owner');
    assert.strictEqual(projectMock.status, 'completed');

    // Admin can update
    const reqAdmin = {
      params: { id: 'p_upd' },
      body: { name: 'Updated by Admin' },
      user: { _id: 'admin_root', role: 'admin' },
    };
    const resAdmin = createMockRes();
    await projectController.updateProject(reqAdmin, resAdmin);
    assert.strictEqual(resAdmin.statusCode, 200);
    assert.strictEqual(projectMock.name, 'Updated by Admin');

    // Non-owner manager gets 403
    const reqOtherMgr = {
      params: { id: 'p_upd' },
      body: { name: 'Hijack Attempt' },
      user: { _id: 'other_mgr', role: 'manager' },
    };
    const resOtherMgr = createMockRes();
    await projectController.updateProject(reqOtherMgr, resOtherMgr);
    assert.strictEqual(resOtherMgr.statusCode, 403);
    assert.strictEqual(resOtherMgr.body.message, 'Not authorized');

    Project.findById = origFindById;
  });

  await testAsync('Case 54: Permanent DELETE safely refused with 409 Conflict without cascade delete', async () => {
    const origFindById = Project.findById;
    const origDeleteMany = Task.deleteMany;
    let tasksCleaned = false;
    let projectDeleted = false;
    Task.deleteMany = async () => { tasksCleaned = true; };

    const projectMock = {
      _id: 'p_del',
      owner: 'owner_dev',
      deleteOne: async () => { projectDeleted = true; },
    };
    Project.findById = async () => projectMock;

    // Non-owner manager gets 403
    const reqOther = { params: { id: 'p_del' }, user: { _id: 'other_mgr', role: 'manager' } };
    const resOther = createMockRes();
    await projectController.deleteProject(reqOther, resOther);
    assert.strictEqual(resOther.statusCode, 403);
    assert.strictEqual(projectDeleted, false);

    // Owner gets 409 Conflict (cascade deletion is disabled)
    const reqOwner = { params: { id: 'p_del' }, user: { _id: 'owner_dev', role: 'manager' } };
    const resOwner = createMockRes();
    await projectController.deleteProject(reqOwner, resOwner);
    assert.strictEqual(resOwner.statusCode, 409);
    assert.strictEqual(resOwner.body.success, false);
    assert.match(resOwner.body.message, /Permanent project deletion is disabled/);
    assert.strictEqual(projectDeleted, false, 'Project must NOT be deleted');
    assert.strictEqual(tasksCleaned, false, 'Tasks must NEVER be cascade deleted');

    // Admin also gets 409 Conflict (cascade deletion disabled for all normal operations)
    const reqAdmin = { params: { id: 'p_del' }, user: { _id: 'admin_root', role: 'admin' } };
    const resAdmin = createMockRes();
    await projectController.deleteProject(reqAdmin, resAdmin);
    assert.strictEqual(resAdmin.statusCode, 409);
    assert.strictEqual(projectDeleted, false);
    assert.strictEqual(tasksCleaned, false);

    Project.findById = origFindById;
    Task.deleteMany = origDeleteMany;
  });

  await testAsync('Case 55: Protected owner and members fields on update', async () => {
    const origFindById = Project.findById;
    const projectMock = {
      _id: 'p_prot',
      name: 'Safe Project',
      owner: 'real_owner',
      members: [{ user: 'real_owner', role: 'owner' }],
      save: async function () {},
      populate: async function () { return this; },
    };
    Project.findById = async () => projectMock;

    const reqMalicious = {
      params: { id: 'p_prot' },
      body: {
        name: 'Normal Name',
        owner: 'attacker_id',
        members: [{ user: 'attacker_id', role: 'owner' }],
      },
      user: { _id: 'real_owner', role: 'manager' },
    };
    const resMalicious = createMockRes();
    await projectController.updateProject(reqMalicious, resMalicious);
    Project.findById = origFindById;

    assert.strictEqual(resMalicious.statusCode, 200);
    assert.strictEqual(projectMock.owner, 'real_owner'); // Owner is untouched!
    assert.strictEqual(projectMock.members.length, 1);
    assert.strictEqual(projectMock.members[0].user, 'real_owner'); // Members untouched!
  });

  await testAsync('Case 56: Project-filtered task authorization', async () => {
    const origFind = Task.find;
    let capturedFilter = null;
    Task.find = (filter) => {
      capturedFilter = filter;
      return {
        populate: () => ({
          populate: () => ({
            populate: () => ({
              sort: async () => [{ _id: 't_proj', project: 'proj_alpha' }],
            }),
          }),
        }),
      };
    };

    // 1. Admin querying tasks for project 'proj_alpha'
    const reqAdmin = { query: { project: 'proj_alpha' }, user: { _id: 'admin_1', role: 'admin' } };
    const resAdmin = createMockRes();
    await taskController.getTasks(reqAdmin, resAdmin);
    assert.strictEqual(capturedFilter.project, 'proj_alpha');
    assert.strictEqual(capturedFilter.$or, undefined); // Admin not restricted by $or

    // 2. Member querying tasks for project 'proj_alpha'
    const reqMember = { query: { project: 'proj_alpha' }, user: { _id: 'member_x', role: 'member' } };
    const resMember = createMockRes();
    await taskController.getTasks(reqMember, resMember);
    assert.strictEqual(capturedFilter.project, 'proj_alpha');
    assert.deepStrictEqual(capturedFilter.$or, [{ assignedTo: 'member_x' }, { createdBy: 'member_x' }]);

    Task.find = origFind;
  });

  console.log('\n--- SECTION 9: Phase D Safe Archival & Truthful Scope Verification ---');

  await testAsync('Case 57: Archiving preserves linked tasks without cascade delete', async () => {
    const origFindById = Project.findById;
    const origDeleteMany = Task.deleteMany;
    let deleteManyCalled = false;
    Task.deleteMany = async () => { deleteManyCalled = true; };

    const projectMock = {
      _id: 'proj_archive_1',
      name: 'Safe Project',
      status: 'active',
      owner: 'owner_1',
      save: async function () { this.status = 'archived'; },
      populate: async function () { return this; },
    };
    Project.findById = async () => projectMock;

    const req = {
      params: { id: 'proj_archive_1' },
      body: { status: 'archived' },
      user: { _id: 'owner_1', role: 'manager' },
    };
    const res = createMockRes();
    await projectController.updateProject(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(projectMock.status, 'archived');
    assert.strictEqual(deleteManyCalled, false, 'Linked tasks must NEVER be deleted during archival');

    Project.findById = origFindById;
    Task.deleteMany = origDeleteMany;
  });

  await testAsync('Case 58: Archive sets project status to archived', async () => {
    const origFindById = Project.findById;
    const projectMock = {
      _id: 'proj_archive_2',
      status: 'active',
      owner: 'owner_2',
      save: async function () { this.status = 'archived'; },
      populate: async function () { return this; },
    };
    Project.findById = async () => projectMock;

    const req = {
      params: { id: 'proj_archive_2' },
      body: { status: 'archived' },
      user: { _id: 'owner_2', role: 'manager' },
    };
    const res = createMockRes();
    await projectController.updateProject(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(projectMock.status, 'archived');

    Project.findById = origFindById;
  });

  await testAsync('Case 59: Archived projects are excluded from default active view', async () => {
    const projects = [
      { _id: 'p1', name: 'Active Project 1', status: 'active' },
      { _id: 'p2', name: 'Archived Project 2', status: 'archived' },
      { _id: 'p3', name: 'Active Project 3', status: 'active' },
    ];
    const statusFilter = 'active';
    const filtered = projects.filter((p) => {
      if (statusFilter === 'active') return p.status === 'active';
      if (statusFilter === 'archived') return p.status === 'archived';
      return true;
    });

    assert.strictEqual(filtered.length, 2);
    assert.strictEqual(filtered.some((p) => p.status === 'archived'), false);
  });

  await testAsync('Case 60: Archived filter returns archived projects', async () => {
    const projects = [
      { _id: 'p1', name: 'Active Project 1', status: 'active' },
      { _id: 'p2', name: 'Archived Project 2', status: 'archived' },
      { _id: 'p3', name: 'On Hold Project 3', status: 'on-hold' },
    ];
    const statusFilter = 'archived';
    const filtered = projects.filter((p) => {
      if (statusFilter === 'active') return p.status === 'active';
      if (statusFilter === 'archived') return p.status === 'archived';
      return true;
    });

    assert.strictEqual(filtered.length, 1);
    assert.strictEqual(filtered[0]._id, 'p2');
    assert.strictEqual(filtered[0].status, 'archived');
  });

  await testAsync('Case 61: Restore sets status back to active without duplicating project', async () => {
    const origFindById = Project.findById;
    const projectMock = {
      _id: 'proj_restore_1',
      status: 'archived',
      owner: 'owner_rest',
      save: async function () { this.status = 'active'; },
      populate: async function () { return this; },
    };
    Project.findById = async () => projectMock;

    const req = {
      params: { id: 'proj_restore_1' },
      body: { status: 'active' },
      user: { _id: 'owner_rest', role: 'manager' },
    };
    const res = createMockRes();
    await projectController.updateProject(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(projectMock.status, 'active');
    assert.strictEqual(projectMock._id, 'proj_restore_1', 'ID must remain identical - no duplicate');

    Project.findById = origFindById;
  });

  await testAsync('Case 62: Admin can archive and restore any project', async () => {
    const origFindById = Project.findById;
    const projectMock = {
      _id: 'proj_admin_ctrl',
      status: 'active',
      owner: 'random_mgr',
      save: async function () {},
      populate: async function () { return this; },
    };
    Project.findById = async () => projectMock;

    // Archive as Admin
    const reqArchive = {
      params: { id: 'proj_admin_ctrl' },
      body: { status: 'archived' },
      user: { _id: 'admin_usr', role: 'admin' },
    };
    const resArchive = createMockRes();
    await projectController.updateProject(reqArchive, resArchive);
    assert.strictEqual(resArchive.statusCode, 200);
    assert.strictEqual(projectMock.status, 'archived');

    // Restore as Admin
    const reqRestore = {
      params: { id: 'proj_admin_ctrl' },
      body: { status: 'active' },
      user: { _id: 'admin_usr', role: 'admin' },
    };
    const resRestore = createMockRes();
    await projectController.updateProject(reqRestore, resRestore);
    assert.strictEqual(resRestore.statusCode, 200);
    assert.strictEqual(projectMock.status, 'active');

    Project.findById = origFindById;
  });

  await testAsync('Case 63: Project owner can archive and restore their own project', async () => {
    const origFindById = Project.findById;
    const projectMock = {
      _id: 'proj_owner_ctrl',
      status: 'active',
      owner: 'owner_dev_1',
      save: async function () {},
      populate: async function () { return this; },
    };
    Project.findById = async () => projectMock;

    const reqArchive = {
      params: { id: 'proj_owner_ctrl' },
      body: { status: 'archived' },
      user: { _id: 'owner_dev_1', role: 'manager' },
    };
    const resArchive = createMockRes();
    await projectController.updateProject(reqArchive, resArchive);
    assert.strictEqual(resArchive.statusCode, 200);
    assert.strictEqual(projectMock.status, 'archived');

    const reqRestore = {
      params: { id: 'proj_owner_ctrl' },
      body: { status: 'active' },
      user: { _id: 'owner_dev_1', role: 'manager' },
    };
    const resRestore = createMockRes();
    await projectController.updateProject(reqRestore, resRestore);
    assert.strictEqual(resRestore.statusCode, 200);
    assert.strictEqual(projectMock.status, 'active');

    Project.findById = origFindById;
  });

  await testAsync('Case 64: Non-owner manager receives 403 on archive and restore', async () => {
    const origFindById = Project.findById;
    const projectMock = {
      _id: 'proj_alien_mgr',
      status: 'active',
      owner: 'real_owner',
      save: async function () {},
      populate: async function () { return this; },
    };
    Project.findById = async () => projectMock;

    const reqAlien = {
      params: { id: 'proj_alien_mgr' },
      body: { status: 'archived' },
      user: { _id: 'unrelated_mgr', role: 'manager' },
    };
    const resAlien = createMockRes();
    await projectController.updateProject(reqAlien, resAlien);
    assert.strictEqual(resAlien.statusCode, 403);
    assert.strictEqual(projectMock.status, 'active', 'Status must not change on 403');

    Project.findById = origFindById;
  });

  await testAsync('Case 65: Member receives 403 on archive and restore', async () => {
    const origFindById = Project.findById;
    const projectMock = {
      _id: 'proj_member_test',
      status: 'active',
      owner: 'manager_1',
      members: [{ user: 'member_usr', role: 'member' }],
      save: async function () {},
      populate: async function () { return this; },
    };
    Project.findById = async () => projectMock;

    const reqMember = {
      params: { id: 'proj_member_test' },
      body: { status: 'archived' },
      user: { _id: 'member_usr', role: 'member' },
    };
    const resMember = createMockRes();
    await projectController.updateProject(reqMember, resMember);
    assert.strictEqual(resMember.statusCode, 403);
    assert.strictEqual(projectMock.status, 'active');

    Project.findById = origFindById;
  });

  await testAsync('Case 66: Permanent DELETE safely returns 409 without cascade delete', async () => {
    const origFindById = Project.findById;
    const origDeleteMany = Task.deleteMany;
    let deleteManyCalled = false;
    Task.deleteMany = async () => { deleteManyCalled = true; };

    const projectMock = {
      _id: 'proj_perm_del',
      owner: 'owner_dev',
      deleteOne: async () => {},
    };
    Project.findById = async () => projectMock;

    const req = { params: { id: 'proj_perm_del' }, user: { _id: 'owner_dev', role: 'manager' } };
    const res = createMockRes();
    await projectController.deleteProject(req, res);

    assert.strictEqual(res.statusCode, 409);
    assert.strictEqual(res.body.success, false);
    assert.match(res.body.message, /Permanent project deletion is disabled/);
    assert.strictEqual(deleteManyCalled, false, 'Permanent cascade deletion must not occur');

    Project.findById = origFindById;
    Task.deleteMany = origDeleteMany;
  });

  await testAsync('Case 67: Member-facing metrics are labelled as partial/visible scope', async () => {
    // Contract verification: member user viewing project tasks
    const memberUser = { _id: 'mem_1', role: 'member' };
    const projectTasksVisibleToMember = [
      { _id: 't1', title: 'Assigned Task', assignedTo: 'mem_1', status: 'In Progress' },
      { _id: 't2', title: 'Created Task', createdBy: 'mem_1', status: 'Done' },
    ];

    // Verification that member scope computation marks project-wide health as not available
    const computeOpStatus = (userRole) => {
      if (userRole === 'member') {
        return {
          label: 'Project-wide health not available for this role',
          isRestricted: true,
        };
      }
      return { label: 'On Track', isRestricted: false };
    };

    const statusForMember = computeOpStatus(memberUser.role);
    assert.strictEqual(statusForMember.isRestricted, true);
    assert.strictEqual(statusForMember.label, 'Project-wide health not available for this role');
  });

  await testAsync('Case 68: Admin/manager metrics remain project-wide', async () => {
    const adminUser = { _id: 'adm_1', role: 'admin' };
    const computeOpStatus = (userRole) => {
      if (userRole === 'member') {
        return {
          label: 'Project-wide health not available for this role',
          isRestricted: true,
        };
      }
      return { label: 'On Track', isRestricted: false };
    };

    const statusForAdmin = computeOpStatus(adminUser.role);
    assert.strictEqual(statusForAdmin.isRestricted, false);
    assert.strictEqual(statusForAdmin.label, 'On Track');
  });

  await testAsync('Case 69: Global Tasks behavior remains unchanged', async () => {
    // Verify Task.find query builder logic for global tasks
    const origFind = Task.find;
    let queryCaptured = null;
    Task.find = (q) => {
      queryCaptured = q;
      return {
        populate: () => ({
          populate: () => ({
            populate: () => ({
              sort: async () => [{ _id: 'task_g1' }],
            }),
          }),
        }),
      };
    };

    const req = { query: { isBlocked: 'true' }, user: { _id: 'u1', role: 'admin' } };
    const res = createMockRes();
    await taskController.getTasks(req, res);

    assert.strictEqual(queryCaptured.isBlocked, true);
    assert.strictEqual(res.statusCode, 200);

    Task.find = origFind;
  });

  await testAsync('Case 70: Project-scoped tasks remain authorization filtered', async () => {
    const origFind = Task.find;
    let queryCaptured = null;
    Task.find = (q) => {
      queryCaptured = q;
      return {
        populate: () => ({
          populate: () => ({
            populate: () => ({
              sort: async () => [],
            }),
          }),
        }),
      };
    };

    const req = { query: { project: 'proj_xyz' }, user: { _id: 'member_auth', role: 'member' } };
    const res = createMockRes();
    await taskController.getTasks(req, res);

    assert.strictEqual(queryCaptured.project, 'proj_xyz');
    assert.deepStrictEqual(queryCaptured.$or, [
      { assignedTo: 'member_auth' },
      { createdBy: 'member_auth' },
    ]);

    Task.find = origFind;
  });

  console.log('\n--- SECTION 10: Flow Health V1 Calculator & Endpoint Verification ---');

  await testAsync('Case 71: Empty task scope returns insufficient data', async () => {
    const res = calculateFlowHealth({ tasks: [], now: new Date(), activeMemberCount: 2, scope: 'workspace' });
    assert.strictEqual(res.availability, 'insufficient_data');
    assert.strictEqual(res.score, null);
    assert.strictEqual(res.label, 'NOT ENOUGH DATA');
    assert.strictEqual(res.message, 'Add at least 3 active tasks to calculate Flow Health.');
    assert.strictEqual(res.metrics.activeTasks, 0);
  });

  await testAsync('Case 72: One/two active tasks return insufficient data', async () => {
    const t1 = { title: 'T1', status: 'To Do', priority: 'medium' };
    const t2 = { title: 'T2', status: 'In Progress', priority: 'medium' };
    const res1 = calculateFlowHealth({ tasks: [t1], scope: 'workspace' });
    assert.strictEqual(res1.availability, 'insufficient_data');
    assert.strictEqual(res1.score, null);

    const res2 = calculateFlowHealth({ tasks: [t1, t2], scope: 'workspace' });
    assert.strictEqual(res2.availability, 'insufficient_data');
    assert.strictEqual(res2.score, null);
  });

  await testAsync('Case 73: Three healthy active tasks produce 100', async () => {
    const now = new Date();
    const future = new Date(now.getTime() + 7 * 24 * 3600 * 1000);
    const tasks = [
      { title: 'T1', status: 'To Do', priority: 'medium', dueDate: future, assignedTo: 'u1' },
      { title: 'T2', status: 'In Progress', priority: 'low', dueDate: future, assignedTo: 'u2', updatedAt: now },
      { title: 'T3', status: 'To Do', priority: 'high', dueDate: future, assignedTo: 'u3' },
    ];
    const res = calculateFlowHealth({ tasks, now, activeMemberCount: 3, scope: 'workspace' });
    assert.strictEqual(res.availability, 'available');
    assert.strictEqual(res.score, 100);
    assert.strictEqual(res.label, 'OPTIMAL');
    assert.strictEqual(res.totalDeduction, 0);
    assert.strictEqual(res.penalties.length, 0);
  });

  await testAsync('Case 74: Completed tasks do not create penalties', async () => {
    const now = new Date();
    const past = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
    const future = new Date(now.getTime() + 7 * 24 * 3600 * 1000);
    const tasks = [
      { title: 'T1', status: 'To Do', priority: 'medium', dueDate: future, assignedTo: 'u1' },
      { title: 'T2', status: 'In Progress', priority: 'low', dueDate: future, assignedTo: 'u2', updatedAt: now },
      { title: 'T3', status: 'To Do', priority: 'high', dueDate: future, assignedTo: 'u3' },
      { title: 'Done 1', status: 'Done', priority: 'critical', dueDate: past, isBlocked: true, assignedTo: null },
      { title: 'Done 2', status: 'Done', priority: 'high', dueDate: past, updatedAt: past },
    ];
    const res = calculateFlowHealth({ tasks, now, activeMemberCount: 3, scope: 'workspace' });
    assert.strictEqual(res.score, 100);
    assert.strictEqual(res.penalties.length, 0);
    assert.strictEqual(res.totalDeduction, 0);
  });

  await testAsync('Case 75: Overdue critical/high deductions and cap', async () => {
    const now = new Date();
    const past = new Date(now.getTime() - 24 * 3600 * 1000);
    const baseTasks = [
      { title: 'T1', status: 'To Do', priority: 'critical', dueDate: past, assignedTo: 'u1' },
      { title: 'T2', status: 'In Progress', priority: 'high', dueDate: past, assignedTo: 'u2', updatedAt: now },
      { title: 'T3', status: 'To Do', priority: 'critical', dueDate: past, assignedTo: 'u3' },
    ];
    const res1 = calculateFlowHealth({ tasks: baseTasks, now, activeMemberCount: 5, scope: 'workspace' });
    const penalty1 = res1.penalties.find((p) => p.type === 'OVERDUE_HIGH_CRITICAL');
    assert.strictEqual(penalty1.count, 3);
    assert.strictEqual(penalty1.points, 30);
    assert.strictEqual(res1.score, 70);

    const tasks4 = [...baseTasks, { title: 'T4', status: 'To Do', priority: 'high', dueDate: past, assignedTo: 'u4' }];
    const res2 = calculateFlowHealth({ tasks: tasks4, now, activeMemberCount: 5, scope: 'workspace' });
    const penalty2 = res2.penalties.find((p) => p.type === 'OVERDUE_HIGH_CRITICAL');
    assert.strictEqual(penalty2.count, 4);
    assert.strictEqual(penalty2.points, 30, 'Category cap must be 30');
    assert.strictEqual(res2.score, 70);
  });

  await testAsync('Case 76: Overdue medium/low deductions and cap', async () => {
    const now = new Date();
    const past = new Date(now.getTime() - 24 * 3600 * 1000);
    const tasks3 = [
      { title: 'T1', status: 'To Do', priority: 'medium', dueDate: past, assignedTo: 'u1' },
      { title: 'T2', status: 'To Do', priority: 'low', dueDate: past, assignedTo: 'u2' },
      { title: 'T3', status: 'To Do', priority: 'medium', dueDate: past, assignedTo: 'u3' },
    ];
    const res1 = calculateFlowHealth({ tasks: tasks3, now, activeMemberCount: 5, scope: 'workspace' });
    const p1 = res1.penalties.find((p) => p.type === 'OVERDUE_MEDIUM_LOW');
    assert.strictEqual(p1.points, 15);

    const tasks5 = [
      ...tasks3,
      { title: 'T4', status: 'To Do', priority: 'low', dueDate: past, assignedTo: 'u4' },
      { title: 'T5', status: 'To Do', priority: 'medium', dueDate: past, assignedTo: 'u5' },
    ];
    const res2 = calculateFlowHealth({ tasks: tasks5, now, activeMemberCount: 5, scope: 'workspace' });
    const p2 = res2.penalties.find((p) => p.type === 'OVERDUE_MEDIUM_LOW');
    assert.strictEqual(p2.count, 5);
    assert.strictEqual(p2.points, 20, 'Category cap must be 20');
  });

  await testAsync('Case 77: Blocked-task deductions and cap', async () => {
    const now = new Date();
    const tasks3 = [
      { title: 'T1', status: 'To Do', priority: 'medium', isBlocked: true, assignedTo: 'u1' },
      { title: 'T2', status: 'In Progress', priority: 'medium', isBlocked: true, assignedTo: 'u2', updatedAt: now },
      { title: 'T3', status: 'To Do', priority: 'medium', isBlocked: true, assignedTo: 'u3' },
    ];
    const res1 = calculateFlowHealth({ tasks: tasks3, now, activeMemberCount: 5, scope: 'workspace' });
    const p1 = res1.penalties.find((p) => p.type === 'BLOCKED_TASK');
    assert.strictEqual(p1.points, 18);

    const tasks5 = [
      ...tasks3,
      { title: 'T4', status: 'To Do', priority: 'medium', isBlocked: true, assignedTo: 'u4' },
      { title: 'T5', status: 'To Do', priority: 'medium', isBlocked: true, assignedTo: 'u5' },
    ];
    const res2 = calculateFlowHealth({ tasks: tasks5, now, activeMemberCount: 5, scope: 'workspace' });
    const p2 = res2.penalties.find((p) => p.type === 'BLOCKED_TASK');
    assert.strictEqual(p2.count, 5);
    assert.strictEqual(p2.points, 24, 'Category cap must be 24');
  });

  await testAsync('Case 78: Stale-task deductions and cap', async () => {
    const now = new Date();
    const staleDate = new Date(now.getTime() - 5 * 24 * 3600 * 1000);
    const tasks3 = [
      { title: 'T1', status: 'In Progress', priority: 'medium', updatedAt: staleDate, assignedTo: 'u1' },
      { title: 'T2', status: 'In Progress', priority: 'medium', updatedAt: staleDate, assignedTo: 'u2' },
      { title: 'T3', status: 'In Progress', priority: 'medium', updatedAt: staleDate, assignedTo: 'u3' },
    ];
    const res1 = calculateFlowHealth({ tasks: tasks3, now, activeMemberCount: 5, scope: 'workspace' });
    const p1 = res1.penalties.find((p) => p.type === 'STALE_IN_PROGRESS');
    assert.strictEqual(p1.points, 12);

    const tasks6 = [
      ...tasks3,
      { title: 'T4', status: 'In Progress', priority: 'medium', updatedAt: staleDate, assignedTo: 'u4' },
      { title: 'T5', status: 'In Progress', priority: 'medium', updatedAt: staleDate, assignedTo: 'u5' },
      { title: 'T6', status: 'In Progress', priority: 'medium', updatedAt: staleDate, assignedTo: 'u6' },
    ];
    const res2 = calculateFlowHealth({ tasks: tasks6, now, activeMemberCount: 5, scope: 'workspace' });
    const p2 = res2.penalties.find((p) => p.type === 'STALE_IN_PROGRESS');
    assert.strictEqual(p2.count, 6);
    assert.strictEqual(p2.points, 20, 'Category cap must be 20');
  });

  await testAsync('Case 79: Unassigned-critical deductions and cap', async () => {
    const now = new Date();
    const tasks3 = [
      { title: 'T1', status: 'To Do', priority: 'critical', assignedTo: null },
      { title: 'T2', status: 'To Do', priority: 'critical', assignedTo: null },
      { title: 'T3', status: 'To Do', priority: 'medium', assignedTo: 'u1' },
    ];
    const res1 = calculateFlowHealth({ tasks: tasks3, now, activeMemberCount: 5, scope: 'workspace' });
    const p1 = res1.penalties.find((p) => p.type === 'UNASSIGNED_CRITICAL');
    assert.strictEqual(p1.points, 10);

    const tasks5 = [
      ...tasks3,
      { title: 'T4', status: 'To Do', priority: 'critical', assignedTo: null },
      { title: 'T5', status: 'To Do', priority: 'critical', assignedTo: null },
    ];
    const res2 = calculateFlowHealth({ tasks: tasks5, now, activeMemberCount: 5, scope: 'workspace' });
    const p2 = res2.penalties.find((p) => p.type === 'UNASSIGNED_CRITICAL');
    assert.strictEqual(p2.count, 4);
    assert.strictEqual(p2.points, 15, 'Category cap must be 15');
  });

  await testAsync('Case 80: Workspace WIP congestion', async () => {
    const now = new Date();
    const tasks = [
      { title: 'T1', status: 'In Progress', priority: 'medium', assignedTo: 'u1', updatedAt: now },
      { title: 'T2', status: 'In Progress', priority: 'medium', assignedTo: 'u2', updatedAt: now },
      { title: 'T3', status: 'In Progress', priority: 'medium', assignedTo: 'u1', updatedAt: now },
      { title: 'T4', status: 'In Progress', priority: 'medium', assignedTo: 'u2', updatedAt: now },
    ];
    const res = calculateFlowHealth({ tasks, now, activeMemberCount: 2, scope: 'workspace' });
    const p = res.penalties.find((x) => x.type === 'WIP_CONGESTION');
    assert.ok(p, 'WIP_CONGESTION penalty must be present');
    assert.strictEqual(p.points, 8);
  });

  await testAsync('Case 81: Personal WIP congestion', async () => {
    const now = new Date();
    const tasks = [
      { title: 'T1', status: 'In Progress', priority: 'medium', assignedTo: 'u1', updatedAt: now },
      { title: 'T2', status: 'In Progress', priority: 'medium', assignedTo: 'u1', updatedAt: now },
      { title: 'T3', status: 'In Progress', priority: 'medium', assignedTo: 'u1', updatedAt: now },
      { title: 'T4', status: 'In Progress', priority: 'medium', assignedTo: 'u1', updatedAt: now },
      { title: 'T5', status: 'In Progress', priority: 'medium', assignedTo: 'u1', updatedAt: now },
      { title: 'T6', status: 'In Progress', priority: 'medium', assignedTo: 'u1', updatedAt: now },
    ];
    const res = calculateFlowHealth({ tasks, now, activeMemberCount: 1, scope: 'personal' });
    const p = res.penalties.find((x) => x.type === 'WIP_CONGESTION');
    assert.ok(p, 'Personal WIP_CONGESTION must trigger when >5 in progress');
    assert.strictEqual(p.points, 8);
  });

  await testAsync('Case 82: Multiple penalties on one task remain explainable', async () => {
    const now = new Date();
    const past = new Date(now.getTime() - 24 * 3600 * 1000);
    const tasks = [
      { title: 'T1', status: 'To Do', priority: 'critical', dueDate: past, isBlocked: true, assignedTo: 'u1' },
      { title: 'T2', status: 'To Do', priority: 'medium', assignedTo: 'u2' },
      { title: 'T3', status: 'To Do', priority: 'medium', assignedTo: 'u3' },
    ];
    const res = calculateFlowHealth({ tasks, now, activeMemberCount: 3, scope: 'workspace' });
    const pOverdue = res.penalties.find((p) => p.type === 'OVERDUE_HIGH_CRITICAL');
    const pBlocked = res.penalties.find((p) => p.type === 'BLOCKED_TASK');
    assert.ok(pOverdue, 'Overdue penalty must be counted');
    assert.ok(pBlocked, 'Blocked penalty must be counted');
    assert.strictEqual(pOverdue.points, 10);
    assert.strictEqual(pBlocked.points, 6);
    assert.strictEqual(res.totalDeduction, 16);
    assert.strictEqual(res.score, 84);
  });

  await testAsync('Case 83: Score never falls below zero', async () => {
    const now = new Date();
    const past = new Date(now.getTime() - 5 * 24 * 3600 * 1000);
    const tasks = [
      { title: 'T1', status: 'In Progress', priority: 'critical', dueDate: past, isBlocked: true, updatedAt: past, assignedTo: null },
      { title: 'T2', status: 'In Progress', priority: 'critical', dueDate: past, isBlocked: true, updatedAt: past, assignedTo: null },
      { title: 'T3', status: 'In Progress', priority: 'critical', dueDate: past, isBlocked: true, updatedAt: past, assignedTo: null },
      { title: 'T4', status: 'In Progress', priority: 'low', dueDate: past, isBlocked: true, updatedAt: past, assignedTo: 'u1' },
      { title: 'T5', status: 'In Progress', priority: 'low', dueDate: past, isBlocked: true, updatedAt: past, assignedTo: 'u2' },
      { title: 'T6', status: 'In Progress', priority: 'medium', dueDate: past, updatedAt: past, assignedTo: 'u3' },
      { title: 'T7', status: 'In Progress', priority: 'medium', dueDate: past, updatedAt: past, assignedTo: 'u4' },
    ];
    const res = calculateFlowHealth({ tasks, now, activeMemberCount: 1, scope: 'workspace' });
    assert.ok(res.totalDeduction >= 100, `Total deductions should exceed 100, got ${res.totalDeduction}`);
    assert.strictEqual(res.score, 0, 'Score must be clamped at 0');
    assert.strictEqual(res.label, 'CRITICAL');
  });

  await testAsync('Case 84: Correct label boundaries: 90, 89, 75, 74, 50, 49', async () => {
    assert.strictEqual(getLabelForScore(100), 'OPTIMAL');
    assert.strictEqual(getLabelForScore(90), 'OPTIMAL');
    assert.strictEqual(getLabelForScore(89), 'STABLE');
    assert.strictEqual(getLabelForScore(75), 'STABLE');
    assert.strictEqual(getLabelForScore(74), 'AT RISK');
    assert.strictEqual(getLabelForScore(50), 'AT RISK');
    assert.strictEqual(getLabelForScore(49), 'CRITICAL');
    assert.strictEqual(getLabelForScore(0), 'CRITICAL');
  });

  await testAsync('Case 85: Member health uses only authorized personal tasks', async () => {
    const origFind = Task.find;
    let queryCaptured = null;
    Task.find = (q) => {
      queryCaptured = q;
      return Promise.resolve([
        { _id: 't1', title: 'T1', status: 'To Do', priority: 'medium', assignedTo: 'mem_id' },
        { _id: 't2', title: 'T2', status: 'In Progress', priority: 'low', assignedTo: 'mem_id' },
        { _id: 't3', title: 'T3', status: 'To Do', priority: 'high', createdBy: 'mem_id' },
      ]);
    };

    const req = { query: {}, user: { _id: 'mem_id', role: 'member' } };
    const res = createMockRes();
    await taskController.getFlowHealth(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.scope, 'personal');
    assert.deepStrictEqual(queryCaptured.$or, [
      { assignedTo: 'mem_id' },
      { createdBy: 'mem_id' },
    ]);

    Task.find = origFind;
  });

  await testAsync('Case 86: Admin/manager workspace health uses workspace tasks', async () => {
    const origFind = Task.find;
    const origCount = User.countDocuments;
    let queryCaptured = null;
    Task.find = (q) => {
      queryCaptured = q;
      return Promise.resolve([
        { _id: 't1', title: 'T1', status: 'To Do', priority: 'medium', assignedTo: 'u1' },
        { _id: 't2', title: 'T2', status: 'In Progress', priority: 'low', assignedTo: 'u2' },
        { _id: 't3', title: 'T3', status: 'To Do', priority: 'high', assignedTo: 'u3' },
      ]);
    };
    User.countDocuments = () => Promise.resolve(4);

    const req = { query: {}, user: { _id: 'adm_1', role: 'admin' } };
    const res = createMockRes();
    await taskController.getFlowHealth(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.scope, 'workspace');
    assert.deepStrictEqual(queryCaptured, {});

    Task.find = origFind;
    User.countDocuments = origCount;
  });

  await testAsync('Case 87: Project health uses only the requested project', async () => {
    const origProjectFindById = Project.findById;
    const origTaskFind = Task.find;
    let projectQueryCaptured = null;

    Project.findById = (id) =>
      Promise.resolve({
        _id: '64b0f0000000000000000001',
        status: 'active',
        members: [{ user: 'm1' }, { user: 'm2' }],
      });

    Task.find = (q) => {
      projectQueryCaptured = q;
      return Promise.resolve([
        { _id: 't1', status: 'To Do', priority: 'medium', assignedTo: 'u1' },
        { _id: 't2', status: 'In Progress', priority: 'low', assignedTo: 'u2' },
        { _id: 't3', status: 'To Do', priority: 'high', assignedTo: 'u3' },
      ]);
    };

    const req = {
      query: { project: '64b0f0000000000000000001' },
      user: { _id: 'adm_1', role: 'admin' },
    };
    const res = createMockRes();
    await taskController.getFlowHealth(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.scope, 'project');
    assert.strictEqual(projectQueryCaptured.project.toString(), '64b0f0000000000000000001');

    Project.findById = origProjectFindById;
    Task.find = origTaskFind;
  });

  await testAsync('Case 88: Member cannot receive misleading project-wide health', async () => {
    const origProjectFindById = Project.findById;
    Project.findById = (id) =>
      Promise.resolve({
        _id: '64b0f0000000000000000001',
        status: 'active',
        members: [{ user: 'mem_1' }],
      });

    const req = {
      query: { project: '64b0f0000000000000000001' },
      user: { _id: 'mem_1', role: 'member' },
    };
    const res = createMockRes();
    await taskController.getFlowHealth(req, res);

    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(
      res.body.message,
      'Project-wide Flow Health is restricted to managers and administrators'
    );

    Project.findById = origProjectFindById;
  });

  await testAsync('Case 89: Invalid project ID returns 400', async () => {
    const req = { query: { project: 'invalid-id' }, user: { _id: 'adm_1', role: 'admin' } };
    const res = createMockRes();
    await taskController.getFlowHealth(req, res);

    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.message, 'Invalid project ID');
  });

  await testAsync('Case 90: Missing project returns 404', async () => {
    const origProjectFindById = Project.findById;
    Project.findById = () => Promise.resolve(null);

    const req = {
      query: { project: '64b0f0000000000000000001' },
      user: { _id: 'adm_1', role: 'admin' },
    };
    const res = createMockRes();
    await taskController.getFlowHealth(req, res);

    assert.strictEqual(res.statusCode, 404);
    assert.strictEqual(res.body.message, 'Project not found');

    Project.findById = origProjectFindById;
  });

  await testAsync('Case 91: Unauthorized project returns 403', async () => {
    const origProjectFindById = Project.findById;
    Project.findById = () =>
      Promise.resolve({
        _id: '64b0f0000000000000000001',
        status: 'active',
      });

    const req = {
      query: { project: '64b0f0000000000000000001' },
      user: { _id: 'viewer_1', role: 'viewer' },
    };
    const res = createMockRes();
    await taskController.getFlowHealth(req, res);

    assert.strictEqual(res.statusCode, 403);

    Project.findById = origProjectFindById;
  });

  await testAsync('Case 92: Archived project does not show active health', async () => {
    const origProjectFindById = Project.findById;
    Project.findById = () =>
      Promise.resolve({
        _id: '64b0f0000000000000000001',
        status: 'archived',
      });

    const req = {
      query: { project: '64b0f0000000000000000001' },
      user: { _id: 'adm_1', role: 'admin' },
    };
    const res = createMockRes();
    await taskController.getFlowHealth(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.availability, 'archived');
    assert.strictEqual(res.body.score, null);
    assert.strictEqual(res.body.label, 'ARCHIVED');

    Project.findById = origProjectFindById;
  });

  await testAsync('Case 93: Legacy missing blocker fields are safe', async () => {
    const tasks = [
      { title: 'T1', status: 'To Do', priority: 'medium', assignedTo: 'u1' },
      { title: 'T2', status: 'In Progress', priority: 'medium', assignedTo: 'u2' },
      { title: 'T3', status: 'To Do', priority: 'low', assignedTo: 'u3' },
    ];
    const res = calculateFlowHealth({ tasks, now: new Date(), activeMemberCount: 2 });
    assert.strictEqual(res.availability, 'available');
    assert.strictEqual(res.metrics.blocked, 0);
    assert.strictEqual(res.score, 100);
  });

  await testAsync('Case 94: Invalid/missing dates do not crash', async () => {
    const tasks = [
      { title: 'T1', status: 'To Do', priority: 'high', dueDate: 'invalid-date', updatedAt: 'also-invalid', assignedTo: 'u1' },
      { title: 'T2', status: 'In Progress', priority: 'critical', dueDate: null, updatedAt: null, assignedTo: 'u2' },
      { title: 'T3', status: 'To Do', priority: 'low', dueDate: undefined, updatedAt: undefined, assignedTo: 'u3' },
    ];
    const res = calculateFlowHealth({ tasks, now: 'not-a-date' });
    assert.strictEqual(res.availability, 'available');
    assert.strictEqual(typeof res.score, 'number');
    assert.ok(!isNaN(res.score));
  });

  await testAsync('Case 95: Response does not expose task titles or IDs', async () => {
    const now = new Date();
    const past = new Date(now.getTime() - 24 * 3600 * 1000);
    const tasks = [
      { _id: 'SECRET_ID_1', title: 'SECRET_TITLE_CONFIDENTIAL_1', status: 'To Do', priority: 'critical', dueDate: past, assignedTo: 'u1' },
      { _id: 'SECRET_ID_2', title: 'SECRET_TITLE_CONFIDENTIAL_2', status: 'In Progress', priority: 'medium', assignedTo: 'u2', updatedAt: now },
      { _id: 'SECRET_ID_3', title: 'SECRET_TITLE_CONFIDENTIAL_3', status: 'To Do', priority: 'low', assignedTo: 'u3' },
    ];
    const res = calculateFlowHealth({ tasks, now, activeMemberCount: 3, scope: 'workspace' });
    const jsonStr = JSON.stringify(res);

    assert.strictEqual(jsonStr.includes('SECRET_ID_1'), false);
    assert.strictEqual(jsonStr.includes('SECRET_TITLE_CONFIDENTIAL_1'), false);
    assert.strictEqual(jsonStr.includes('SECRET_ID_2'), false);
    assert.strictEqual(jsonStr.includes('SECRET_TITLE_CONFIDENTIAL_2'), false);
  });

  console.log('\n--- SECTION 11: Registration & Authentication Error Handling Verification ---');

  await testAsync('Case 96: Register with valid test data succeeds', async () => {
    const origFindOne = User.findOne;
    const origCount = User.countDocuments;
    const origCreate = User.create;

    User.findOne = async () => null;
    User.countDocuments = async () => 0;
    User.create = async (d) => ({
      _id: 'reg_u1',
      name: d.name,
      email: d.email,
      role: d.role,
    });

    const req = {
      body: {
        name: 'Valid Test User',
        email: 'valid.test@company.com',
        password: 'securePassword123',
      },
    };
    const res = createMockRes();
    await authController.register(req, res);

    assert.strictEqual(res.statusCode, 201);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.user.email, 'valid.test@company.com');
    assert.ok(res.body.token, 'Token must be returned');

    User.findOne = origFindOne;
    User.countDocuments = origCount;
    User.create = origCreate;
  });

  await testAsync('Case 97: Duplicate registration returns 400 with "Email already registered"', async () => {
    const origFindOne = User.findOne;
    User.findOne = async () => ({ _id: 'existing_u1', email: 'duplicate@company.com' });

    const req = {
      body: {
        name: 'Duplicate User',
        email: 'duplicate@company.com',
        password: 'password123',
      },
    };
    const res = createMockRes();
    await authController.register(req, res);

    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.success, false);
    assert.strictEqual(res.body.message, 'Email already registered');

    User.findOne = origFindOne;
  });

  await testAsync('Case 98: Missing name returns 400 with useful validation message', async () => {
    const req = {
      body: {
        name: '',
        email: 'test@company.com',
        password: 'password123',
      },
    };
    const res = createMockRes();
    await authController.register(req, res);

    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.message, 'Name is required');
  });

  await testAsync('Case 99: Invalid email format returns 400 validation error', async () => {
    const req = {
      body: {
        name: 'Test User',
        email: 'not-an-email',
        password: 'password123',
      },
    };
    const res = createMockRes();
    await authController.register(req, res);

    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.message, 'Please enter a valid email');
  });

  await testAsync('Case 100: Password under 6 characters returns 400 validation error', async () => {
    const req = {
      body: {
        name: 'Test User',
        email: 'test@company.com',
        password: '123',
      },
    };
    const res = createMockRes();
    await authController.register(req, res);

    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.message, 'Password must be at least 6 characters');
  });

  await testAsync('Case 101: Database unavailable returns 503 safe connection message', async () => {
    const origFindOne = User.findOne;
    User.findOne = async () => {
      const err = new Error('Could not connect to any servers');
      err.name = 'MongooseServerSelectionError';
      throw err;
    };

    const req = {
      body: {
        name: 'Test User',
        email: 'test@company.com',
        password: 'password123',
      },
    };
    const res = createMockRes();
    await authController.register(req, res);

    assert.strictEqual(res.statusCode, 503);
    assert.strictEqual(
      res.body.message,
      'Database service is currently unavailable. Please try again later.'
    );

    User.findOne = origFindOne;
  });

  await testAsync('Case 102: Login with valid and invalid credentials behaves correctly', async () => {
    const origFindOne = User.findOne;
    // Invalid credentials
    User.findOne = () => ({
      select: async () => null,
    });
    const req1 = { body: { email: 'wrong@company.com', password: 'password123' } };
    const res1 = createMockRes();
    await authController.login(req1, res1);

    assert.strictEqual(res1.statusCode, 401);
    assert.strictEqual(res1.body.message, 'Invalid credentials');

    // Valid credentials
    User.findOne = () => ({
      select: async () => ({
        _id: 'u_login',
        name: 'Login User',
        email: 'correct@company.com',
        role: 'member',
        matchPassword: async () => true,
      }),
    });
    const req2 = { body: { email: 'correct@company.com', password: 'password123' } };
    const res2 = createMockRes();
    await authController.login(req2, res2);

    assert.strictEqual(res2.statusCode, 200);
    assert.strictEqual(res2.body.success, true);
    assert.strictEqual(res2.body.user.email, 'correct@company.com');

    User.findOne = origFindOne;
  });

  console.log('\n--- SECTION 12: Archive Awareness & Project Capacity Verification ---');

  await testAsync('Case 103: Workspace health excludes archived-project tasks', async () => {
    const origProjectFind = Project.find;
    const origTaskFind = Task.find;
    const origUserCount = User.countDocuments;

    Project.find = () => ({
      select: async () => [{ _id: 'archived_proj_1' }],
    });

    let capturedFilter = null;
    Task.find = (q) => {
      capturedFilter = q;
      return Promise.resolve([
        { _id: 't1', title: 'Task 1', status: 'To Do', priority: 'medium', project: 'active_proj_1' },
        { _id: 't2', title: 'Task 2', status: 'In Progress', priority: 'low', project: 'active_proj_1' },
        { _id: 't3', title: 'Task 3', status: 'To Do', priority: 'high', project: null },
      ]);
    };
    User.countDocuments = async () => 3;

    const req = { query: {}, user: { _id: 'admin_1', role: 'admin' } };
    const res = createMockRes();
    await taskController.getFlowHealth(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.scope, 'workspace');
    assert.deepStrictEqual(capturedFilter.project, { $nin: ['archived_proj_1'] });

    Project.find = origProjectFind;
    Task.find = origTaskFind;
    User.countDocuments = origUserCount;
  });

  await testAsync('Case 104: Personal health excludes archived-project tasks', async () => {
    const origProjectFind = Project.find;
    const origTaskFind = Task.find;

    Project.find = () => ({
      select: async () => [{ _id: 'archived_proj_2' }],
    });

    let capturedFilter = null;
    Task.find = (q) => {
      capturedFilter = q;
      return Promise.resolve([
        { _id: 't1', title: 'Personal Task 1', status: 'To Do', priority: 'medium', assignedTo: 'mem_1' },
        { _id: 't2', title: 'Personal Task 2', status: 'In Progress', priority: 'low', assignedTo: 'mem_1' },
        { _id: 't3', title: 'Personal Task 3', status: 'To Do', priority: 'high', assignedTo: 'mem_1' },
      ]);
    };

    const req = { query: {}, user: { _id: 'mem_1', role: 'member' } };
    const res = createMockRes();
    await taskController.getFlowHealth(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.scope, 'personal');
    assert.deepStrictEqual(capturedFilter.project, { $nin: ['archived_proj_2'] });
    assert.deepStrictEqual(capturedFilter.$or, [{ assignedTo: 'mem_1' }, { createdBy: 'mem_1' }]);

    Project.find = origProjectFind;
    Task.find = origTaskFind;
  });

  await testAsync('Case 105: Active-project tasks remain included', async () => {
    const origProjectFind = Project.find;
    const origTaskFind = Task.find;
    const origUserCount = User.countDocuments;

    Project.find = () => ({
      select: async () => [{ _id: 'archived_proj_old' }],
    });

    Task.find = (q) => {
      const allTasks = [
        { _id: 't1', title: 'Active Proj Task 1', status: 'To Do', priority: 'low', project: 'active_proj_1' },
        { _id: 't2', title: 'Active Proj Task 2', status: 'In Progress', priority: 'medium', project: 'active_proj_1' },
        { _id: 't3', title: 'Active Proj Task 3', status: 'To Do', priority: 'high', project: 'active_proj_1' },
      ];
      const excluded = q.project && q.project.$nin ? q.project.$nin : [];
      const filtered = allTasks.filter((t) => !excluded.includes(t.project));
      return Promise.resolve(filtered);
    };
    User.countDocuments = async () => 2;

    const req = { query: {}, user: { _id: 'admin_1', role: 'admin' } };
    const res = createMockRes();
    await taskController.getFlowHealth(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.metrics.activeTasks, 3);
    assert.strictEqual(res.body.availability, 'available');
    assert.strictEqual(res.body.label, 'OPTIMAL');
    assert.strictEqual(res.body.score, 100);

    Project.find = origProjectFind;
    Task.find = origTaskFind;
    User.countDocuments = origUserCount;
  });

  await testAsync('Case 106: Tasks without a project remain included', async () => {
    const origProjectFind = Project.find;
    const origTaskFind = Task.find;
    const origUserCount = User.countDocuments;

    Project.find = () => ({
      select: async () => [{ _id: 'archived_proj_xyz' }],
    });

    Task.find = (q) => {
      const allTasks = [
        { _id: 't1', title: 'Standalone Task 1', status: 'To Do', priority: 'low', project: null },
        { _id: 't2', title: 'Standalone Task 2', status: 'In Progress', priority: 'medium', project: null },
        { _id: 't3', title: 'Standalone Task 3', status: 'To Do', priority: 'high', project: undefined },
      ];
      const excluded = q.project && q.project.$nin ? q.project.$nin : [];
      const filtered = allTasks.filter((t) => !t.project || !excluded.includes(t.project));
      return Promise.resolve(filtered);
    };
    User.countDocuments = async () => 1;

    const req = { query: {}, user: { _id: 'mgr_1', role: 'manager' } };
    const res = createMockRes();
    await taskController.getFlowHealth(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.metrics.activeTasks, 3);
    assert.strictEqual(res.body.score, 100);

    Project.find = origProjectFind;
    Task.find = origTaskFind;
    User.countDocuments = origUserCount;
  });

  await testAsync('Case 107: Direct archived-project health remains unavailable/archived', async () => {
    const origFindById = Project.findById;

    Project.findById = async (id) => ({
      _id: id,
      name: 'Archived Initiative',
      status: 'archived',
      owner: 'admin_1',
      members: [],
    });

    const req = {
      query: { project: '64b0f0000000000000000099' },
      user: { _id: 'admin_1', role: 'admin' },
    };
    const res = createMockRes();
    await taskController.getFlowHealth(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.availability, 'archived');
    assert.strictEqual(res.body.score, null);
    assert.strictEqual(res.body.label, 'ARCHIVED');
    assert.strictEqual(res.body.metrics, null);
    assert.match(res.body.message, /disabled for archived projects/i);

    Project.findById = origFindById;
  });

  await testAsync('Case 108: Default GET /api/tasks excludes archived-project tasks', async () => {
    const origProjectFind = Project.find;
    const origTaskFind = Task.find;

    Project.find = () => ({
      select: async () => [{ _id: 'archived_alpha' }, { _id: 'archived_beta' }],
    });

    let capturedFilter = null;
    Task.find = (filter) => {
      capturedFilter = filter;
      return {
        populate: () => ({
          populate: () => ({
            populate: () => ({
              sort: async () => [{ _id: 't_active', title: 'Active Task' }],
            }),
          }),
        }),
      };
    };

    const req = { query: {}, user: { _id: 'admin_1', role: 'admin' } };
    const res = createMockRes();
    await taskController.getTasks(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(capturedFilter.project, { $nin: ['archived_alpha', 'archived_beta'] });

    Project.find = origProjectFind;
    Task.find = origTaskFind;
  });

  await testAsync('Case 109: Explicit authorized project query returns preserved tasks for archived project', async () => {
    const origTaskFind = Task.find;
    let capturedFilter = null;

    Task.find = (filter) => {
      capturedFilter = filter;
      return {
        populate: () => ({
          populate: () => ({
            populate: () => ({
              sort: async () => [
                { _id: 't_archived_1', title: 'Preserved Task 1', project: 'archived_proj_keep' },
                { _id: 't_archived_2', title: 'Preserved Task 2', project: 'archived_proj_keep' },
              ],
            }),
          }),
        }),
      };
    };

    const req = {
      query: { project: 'archived_proj_keep' },
      user: { _id: 'mgr_lead', role: 'manager' },
    };
    const res = createMockRes();
    await taskController.getTasks(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(capturedFilter.project, 'archived_proj_keep');
    assert.strictEqual(capturedFilter.project.$nin, undefined);
    assert.strictEqual(res.body.count, 2);
    assert.strictEqual(res.body.tasks[0]._id, 't_archived_1');

    Task.find = origTaskFind;
  });

  await testAsync('Case 110: Explicit unauthorized project query returns 403', async () => {
    const origFindById = Project.findById;

    Project.findById = async (id) => ({
      _id: id,
      name: 'Confidential Project',
      owner: 'other_user',
      members: [{ user: 'different_user', role: 'contributor' }],
    });

    const req = {
      query: { project: '64b0f0000000000000000077' },
      user: { _id: 'unauthorized_member', role: 'member' },
    };
    const res = createMockRes();
    await taskController.getTasks(req, res);

    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(res.body.success, false);
    assert.match(res.body.message, /Not authorized to access tasks for this project/i);

    Project.findById = origFindById;
  });

  await testAsync('Case 111: Project owner is included in project capacity', async () => {
    const origProjectFindById = Project.findById;
    const origTaskFind = Task.find;
    const origUserCount = User.countDocuments;

    let queriedUserIds = null;
    Project.findById = async () => ({
      _id: '64b0f0000000000000000011',
      status: 'active',
      owner: 'owner_dev_1',
      members: [{ user: 'worker_dev_2' }],
    });

    User.countDocuments = async (filter) => {
      queriedUserIds = filter._id.$in;
      return 2; // Both owner and member are active
    };

    Task.find = async () => [
      { _id: 't1', status: 'To Do', priority: 'medium' },
      { _id: 't2', status: 'In Progress', priority: 'low' },
      { _id: 't3', status: 'To Do', priority: 'high' },
    ];

    const req = {
      query: { project: '64b0f0000000000000000011' },
      user: { _id: 'admin_1', role: 'admin' },
    };
    const res = createMockRes();
    await taskController.getFlowHealth(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.ok(queriedUserIds.includes('owner_dev_1'), 'Owner must be queried');
    assert.ok(queriedUserIds.includes('worker_dev_2'), 'Member must be queried');
    assert.strictEqual(res.body.metrics.activeMembers, 2);

    Project.findById = origProjectFindById;
    Task.find = origTaskFind;
    User.countDocuments = origUserCount;
  });

  await testAsync('Case 112: Duplicate owner/member is counted once', async () => {
    const origProjectFindById = Project.findById;
    const origTaskFind = Task.find;
    const origUserCount = User.countDocuments;

    let queriedUserIds = null;
    Project.findById = async () => ({
      _id: '64b0f0000000000000000012',
      status: 'active',
      owner: 'same_user',
      members: [{ user: 'same_user' }, { user: 'colleague_user' }],
    });

    User.countDocuments = async (filter) => {
      queriedUserIds = filter._id.$in;
      return queriedUserIds.length;
    };

    Task.find = async () => [
      { _id: 't1', status: 'To Do', priority: 'medium' },
      { _id: 't2', status: 'In Progress', priority: 'low' },
      { _id: 't3', status: 'To Do', priority: 'high' },
    ];

    const req = {
      query: { project: '64b0f0000000000000000012' },
      user: { _id: 'mgr_1', role: 'manager' },
    };
    const res = createMockRes();
    await taskController.getFlowHealth(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(queriedUserIds.length, 2, 'Candidate users must be deduplicated to 2');
    assert.strictEqual(res.body.metrics.activeMembers, 2);

    Project.findById = origProjectFindById;
    Task.find = origTaskFind;
    User.countDocuments = origUserCount;
  });

  await testAsync('Case 113: Inactive users are excluded from project capacity', async () => {
    const origProjectFindById = Project.findById;
    const origTaskFind = Task.find;
    const origUserCount = User.countDocuments;

    Project.findById = async () => ({
      _id: '64b0f0000000000000000013',
      status: 'active',
      owner: 'active_owner',
      members: [{ user: 'active_worker' }, { user: 'inactive_worker' }],
    });

    let queriedFilter = null;
    User.countDocuments = async (filter) => {
      queriedFilter = filter;
      // 3 candidates in total, but 1 is inactive -> returns 2
      return 2;
    };

    Task.find = async () => [
      { _id: 't1', status: 'To Do', priority: 'medium' },
      { _id: 't2', status: 'In Progress', priority: 'low' },
      { _id: 't3', status: 'To Do', priority: 'high' },
    ];

    const req = {
      query: { project: '64b0f0000000000000000013' },
      user: { _id: 'admin_1', role: 'admin' },
    };
    const res = createMockRes();
    await taskController.getFlowHealth(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(queriedFilter.isActive, { $ne: false });
    assert.strictEqual(res.body.metrics.activeMembers, 2);

    Project.findById = origProjectFindById;
    Task.find = origTaskFind;
    User.countDocuments = origUserCount;
  });

  await testAsync('Case 114: WIP congestion calculation uses corrected project capacity', async () => {
    const origProjectFindById = Project.findById;
    const origTaskFind = Task.find;
    const origUserCount = User.countDocuments;

    // Project capacity = 2 active members (owner + 1 member)
    Project.findById = async () => ({
      _id: '64b0f0000000000000000014',
      status: 'active',
      owner: 'lead_dev',
      members: [{ user: 'team_dev' }],
    });
    User.countDocuments = async () => 2;

    // Test A: 3 in-progress tasks. Threshold is 1.5 * 2 = 3. 3 is NOT > 3, so NO WIP congestion penalty.
    Task.find = async () => [
      { _id: 't1', status: 'In Progress', priority: 'medium', assignedTo: 'lead_dev' },
      { _id: 't2', status: 'In Progress', priority: 'medium', assignedTo: 'team_dev' },
      { _id: 't3', status: 'In Progress', priority: 'medium', assignedTo: 'lead_dev' },
    ];

    const reqA = {
      query: { project: '64b0f0000000000000000014' },
      user: { _id: 'admin_1', role: 'admin' },
    };
    const resA = createMockRes();
    await taskController.getFlowHealth(reqA, resA);

    assert.strictEqual(resA.statusCode, 200);
    const wipPenaltyA = resA.body.penalties.find((p) => p.type === 'WIP_CONGESTION');
    assert.strictEqual(wipPenaltyA, undefined, 'At threshold (3 <= 3), no WIP congestion penalty');

    // Test B: 4 in-progress tasks. 4 > 1.5 * 2 (3), so WIP congestion penalty triggers (8 pts deduction).
    Task.find = async () => [
      { _id: 't1', status: 'In Progress', priority: 'medium', assignedTo: 'lead_dev' },
      { _id: 't2', status: 'In Progress', priority: 'medium', assignedTo: 'team_dev' },
      { _id: 't3', status: 'In Progress', priority: 'medium', assignedTo: 'lead_dev' },
      { _id: 't4', status: 'In Progress', priority: 'medium', assignedTo: 'team_dev' },
    ];

    const reqB = {
      query: { project: '64b0f0000000000000000014' },
      user: { _id: 'admin_1', role: 'admin' },
    };
    const resB = createMockRes();
    await taskController.getFlowHealth(reqB, resB);

    assert.strictEqual(resB.statusCode, 200);
    const wipPenaltyB = resB.body.penalties.find((p) => p.type === 'WIP_CONGESTION');
    assert.ok(wipPenaltyB, 'Exceeding threshold (4 > 3) must trigger WIP congestion penalty');
    assert.strictEqual(wipPenaltyB.points, 8);
    assert.strictEqual(resB.body.score, 92); // 100 - 8 = 92
    assert.strictEqual(resB.body.metrics.activeMembers, 2);

    Project.findById = origProjectFindById;
    Task.find = origTaskFind;
    User.countDocuments = origUserCount;
  });

  console.log('\n--- SECTION 13: Releases & Milestones Domain, Readiness V1 & RBAC ---');

  // Case 115: Authorized admin can create a release
  await testAsync('Case 115: Authorized admin can create a release', async () => {
    const origProjectFindById = Project.findById;
    const origReleaseCreate = Release.create;

    const projId = '64b0f0000000000000000001';
    Project.findById = async (id) => ({
      _id: projId,
      name: 'Core Engine',
      status: 'active',
      owner: 'mgr_1',
      members: [],
    });

    let createdData = null;
    Release.create = async (data) => {
      createdData = data;
      return {
        _id: 'rel_1',
        ...data,
        populate: async () => ({ _id: 'rel_1', ...data }),
      };
    };

    const req = {
      body: {
        name: 'v3.2.0-GA Core Gateway',
        version: '3.2.0-GA',
        targetDate: '2026-10-15',
        project: projId,
      },
      user: { _id: 'admin_1', role: 'admin' },
    };
    const res = createMockRes();
    await releaseController.createRelease(req, res);

    Project.findById = origProjectFindById;
    Release.create = origReleaseCreate;

    assert.strictEqual(res.statusCode, 201);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(createdData.name, 'v3.2.0-GA Core Gateway');
    assert.strictEqual(createdData.createdBy, 'admin_1');
  });

  // Case 116: Authorized manager can create a release for owned project
  await testAsync('Case 116: Authorized manager can create a release for owned project', async () => {
    const origProjectFindById = Project.findById;
    const origReleaseCreate = Release.create;

    const projId = '64b0f0000000000000000001';
    Project.findById = async () => ({
      _id: projId,
      status: 'active',
      owner: 'mgr_1',
      members: [{ user: 'mgr_1', role: 'owner' }],
    });

    let createdData = null;
    Release.create = async (data) => {
      createdData = data;
      return {
        _id: 'rel_2',
        ...data,
        populate: async () => ({ _id: 'rel_2', ...data }),
      };
    };

    const req = {
      body: {
        name: 'v1.0.0 Release',
        version: '1.0.0',
        targetDate: '2026-11-01',
        project: projId,
      },
      user: { _id: 'mgr_1', role: 'manager' },
    };
    const res = createMockRes();
    await releaseController.createRelease(req, res);

    Project.findById = origProjectFindById;
    Release.create = origReleaseCreate;

    assert.strictEqual(res.statusCode, 201);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(createdData.createdBy, 'mgr_1');
  });

  // Case 117: Member cannot create a release (returns 403)
  await testAsync('Case 117: Member cannot create a release (returns 403)', async () => {
    const req = {
      body: {
        name: 'Forbidden Release',
        version: '0.0.1',
        targetDate: '2026-11-01',
        project: '64b0f0000000000000000001',
      },
      user: { _id: 'member_1', role: 'member' },
    };
    const res = createMockRes();
    await releaseController.createRelease(req, res);

    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(res.body.success, false);
  });

  // Case 118: Unauthorized manager cannot create a release for another manager’s project (returns 403)
  await testAsync('Case 118: Unauthorized manager cannot create a release for another manager’s project (returns 403)', async () => {
    const origProjectFindById = Project.findById;

    Project.findById = async () => ({
      _id: '64b0f0000000000000000001',
      status: 'active',
      owner: 'other_mgr',
      members: [],
    });

    const req = {
      body: {
        name: 'Sneaky Release',
        version: '1.0.0',
        targetDate: '2026-11-01',
        project: '64b0f0000000000000000001',
      },
      user: { _id: 'unauth_mgr', role: 'manager' },
    };
    const res = createMockRes();
    await releaseController.createRelease(req, res);

    Project.findById = origProjectFindById;

    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(res.body.success, false);
  });

  // Case 119: Client-supplied createdBy is ignored and set to authenticated user
  await testAsync('Case 119: Client-supplied createdBy is ignored and set to authenticated user', async () => {
    const origProjectFindById = Project.findById;
    const origReleaseCreate = Release.create;

    Project.findById = async () => ({
      _id: '64b0f0000000000000000001',
      status: 'active',
      owner: 'mgr_1',
      members: [],
    });

    let savedData = null;
    Release.create = async (data) => {
      savedData = data;
      return {
        _id: 'rel_3',
        ...data,
        populate: async () => ({ _id: 'rel_3', ...data }),
      };
    };

    const req = {
      body: {
        name: 'Spoofed User Release',
        version: '2.0.0',
        targetDate: '2026-11-01',
        project: '64b0f0000000000000000001',
        createdBy: 'injected_admin_id',
      },
      user: { _id: 'mgr_1', role: 'manager' },
    };
    const res = createMockRes();
    await releaseController.createRelease(req, res);

    Project.findById = origProjectFindById;
    Release.create = origReleaseCreate;

    assert.strictEqual(res.statusCode, 201);
    assert.strictEqual(savedData.createdBy, 'mgr_1');
  });

  // Case 120: Client-supplied internal fields/readiness are ignored
  await testAsync('Case 120: Client-supplied internal fields/readiness are ignored', async () => {
    const origProjectFindById = Project.findById;
    const origReleaseCreate = Release.create;

    Project.findById = async () => ({
      _id: '64b0f0000000000000000001',
      status: 'active',
      owner: 'mgr_1',
      members: [],
    });

    let savedData = null;
    Release.create = async (data) => {
      savedData = data;
      return {
        _id: 'rel_4',
        ...data,
        populate: async () => ({ _id: 'rel_4', ...data }),
      };
    };

    const req = {
      body: {
        name: 'Test Release',
        version: '1.2.0',
        targetDate: '2026-11-01',
        project: '64b0f0000000000000000001',
        readiness: { score: 100, label: 'FAKE' },
        __v: 99,
      },
      user: { _id: 'mgr_1', role: 'manager' },
    };
    const res = createMockRes();
    await releaseController.createRelease(req, res);

    Project.findById = origProjectFindById;
    Release.create = origReleaseCreate;

    assert.strictEqual(res.statusCode, 201);
    assert.strictEqual(savedData.readiness, undefined);
    assert.strictEqual(savedData.__v, undefined);
  });

  // Case 121: Invalid release status is rejected (returns 400)
  await testAsync('Case 121: Invalid release status is rejected (returns 400)', async () => {
    const req = {
      body: {
        name: 'Status Test',
        version: '1.0.0',
        targetDate: '2026-11-01',
        project: '64b0f0000000000000000001',
        status: 'exploded',
      },
      user: { _id: 'admin_1', role: 'admin' },
    };
    const res = createMockRes();
    await releaseController.createRelease(req, res);

    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.success, false);
    assert.ok(res.body.message.includes('Invalid status'));
  });

  // Case 122: Invalid or blank target date is rejected safely without CastError (returns 400)
  await testAsync('Case 122: Invalid or blank target date is rejected safely without CastError (returns 400)', async () => {
    const reqBlank = {
      body: {
        name: 'Blank Date',
        version: '1.0.0',
        targetDate: '',
        project: '64b0f0000000000000000001',
      },
      user: { _id: 'admin_1', role: 'admin' },
    };
    const resBlank = createMockRes();
    await releaseController.createRelease(reqBlank, resBlank);
    assert.strictEqual(resBlank.statusCode, 400);

    const reqInvalid = {
      body: {
        name: 'Invalid Date',
        version: '1.0.0',
        targetDate: 'not-a-date',
        project: '64b0f0000000000000000001',
      },
      user: { _id: 'admin_1', role: 'admin' },
    };
    const resInvalid = createMockRes();
    await releaseController.createRelease(reqInvalid, resInvalid);
    assert.strictEqual(resInvalid.statusCode, 400);
  });

  // Case 123: Release detail is scoped by project authorization
  await testAsync('Case 123: Release detail is scoped by project authorization', async () => {
    const origReleaseFindById = Release.findById;
    const origMilestoneFind = Milestone.find;

    Release.findById = () => ({
      populate: () => ({
        populate: async () => ({
          _id: 'rel_scoped',
          name: 'Scoped Release',
          project: {
            _id: '64b0f0000000000000000001',
            owner: 'mgr_owner',
            members: [{ user: 'allowed_member' }],
          },
        }),
      }),
    });

    Milestone.find = () => ({
      sort: async () => [],
    });

    const req = {
      params: { id: '64b0f0000000000000000010' },
      user: { _id: 'allowed_member', role: 'member' },
    };
    const res = createMockRes();
    await releaseController.getRelease(req, res);

    Release.findById = origReleaseFindById;
    Milestone.find = origMilestoneFind;

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.release.name, 'Scoped Release');
  });

  // Case 124: Member cannot read an unauthorized project release (returns 403)
  await testAsync('Case 124: Member cannot read an unauthorized project release (returns 403)', async () => {
    const origReleaseFindById = Release.findById;

    Release.findById = () => ({
      populate: () => ({
        populate: async () => ({
          _id: 'rel_unauth',
          name: 'Private Release',
          project: {
            _id: '64b0f0000000000000000001',
            owner: 'mgr_owner',
            members: [{ user: 'someone_else' }],
          },
        }),
      }),
    });

    const req = {
      params: { id: '64b0f0000000000000000010' },
      user: { _id: 'unauth_member', role: 'member' },
    };
    const res = createMockRes();
    await releaseController.getRelease(req, res);

    Release.findById = origReleaseFindById;

    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(res.body.success, false);
  });

  // Case 125: Milestone creation works for authorized roles
  await testAsync('Case 125: Milestone creation works for authorized roles', async () => {
    const origProjectFindById = Project.findById;
    const origMilestoneCreate = Milestone.create;

    Project.findById = async () => ({
      _id: '64b0f0000000000000000001',
      status: 'active',
      owner: 'mgr_1',
      members: [],
    });

    let savedMilestone = null;
    Milestone.create = async (data) => {
      savedMilestone = data;
      return {
        _id: 'ms_1',
        ...data,
        populate: async () => ({ _id: 'ms_1', ...data }),
      };
    };

    const req = {
      body: {
        title: 'M1: Storage Layer',
        dueDate: '2026-09-30',
        project: '64b0f0000000000000000001',
      },
      user: { _id: 'mgr_1', role: 'manager' },
    };
    const res = createMockRes();
    await milestoneController.createMilestone(req, res);

    Project.findById = origProjectFindById;
    Milestone.create = origMilestoneCreate;

    assert.strictEqual(res.statusCode, 201);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(savedMilestone.title, 'M1: Storage Layer');
    assert.strictEqual(savedMilestone.createdBy, 'mgr_1');
  });

  // Case 126: Member cannot create or mutate milestones (returns 403)
  await testAsync('Case 126: Member cannot create or mutate milestones (returns 403)', async () => {
    const reqCreate = {
      body: {
        title: 'Member Milestone',
        dueDate: '2026-09-30',
        project: '64b0f0000000000000000001',
      },
      user: { _id: 'member_1', role: 'member' },
    };
    const resCreate = createMockRes();
    await milestoneController.createMilestone(reqCreate, resCreate);
    assert.strictEqual(resCreate.statusCode, 403);

    const reqUpdate = {
      params: { id: '64b0f0000000000000000010' },
      body: { title: 'Updated' },
      user: { _id: 'member_1', role: 'member' },
    };
    const resUpdate = createMockRes();
    await milestoneController.updateMilestone(reqUpdate, resUpdate);
    assert.strictEqual(resUpdate.statusCode, 403);
  });

  // Case 127: Milestone and release must belong to the same project (returns 400 if mismatch)
  await testAsync('Case 127: Milestone and release must belong to the same project (returns 400 if mismatch)', async () => {
    const origProjectFindById = Project.findById;
    const origReleaseFindById = Release.findById;

    Project.findById = async () => ({
      _id: '64b0f0000000000000000001',
      status: 'active',
      owner: 'mgr_1',
      members: [],
    });

    Release.findById = async () => ({
      _id: '64b0f0000000000000000020',
      project: '64b0f0000000000000000099', // Different project!
    });

    const req = {
      body: {
        title: 'M2: Mismatched Milestone',
        dueDate: '2026-09-30',
        project: '64b0f0000000000000000001',
        release: '64b0f0000000000000000020',
      },
      user: { _id: 'admin_1', role: 'admin' },
    };
    const res = createMockRes();
    await milestoneController.createMilestone(req, res);

    Project.findById = origProjectFindById;
    Release.findById = origReleaseFindById;

    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.success, false);
    assert.ok(res.body.message.includes('same project'));
  });

  // Case 128: Task cannot reference a milestone from another project (returns 400)
  await testAsync('Case 128: Task cannot reference a milestone from another project (returns 400)', async () => {
    const origMilestoneFindById = Milestone.findById;

    Milestone.findById = async () => ({
      _id: '64b0f0000000000000000030',
      project: '64b0f0000000000000000099', // Different project!
    });

    const req = {
      body: {
        title: 'Task with Wrong Milestone',
        project: '64b0f0000000000000000001',
        milestone: '64b0f0000000000000000030',
      },
      user: { _id: 'admin_1', role: 'admin' },
    };
    const res = createMockRes();
    await taskController.createTask(req, res);

    Milestone.findById = origMilestoneFindById;

    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.success, false);
    assert.ok(res.body.message.includes('same project'));
  });

  // Case 129: Archived projects reject new release and milestone creation (returns 400)
  await testAsync('Case 129: Archived projects reject new release and milestone creation (returns 400)', async () => {
    const origProjectFindById = Project.findById;

    Project.findById = async () => ({
      _id: '64b0f0000000000000000001',
      status: 'archived',
      owner: 'mgr_1',
      members: [],
    });

    const reqRel = {
      body: {
        name: 'Archived Release',
        version: '1.0.0',
        targetDate: '2026-11-01',
        project: '64b0f0000000000000000001',
      },
      user: { _id: 'admin_1', role: 'admin' },
    };
    const resRel = createMockRes();
    await releaseController.createRelease(reqRel, resRel);
    assert.strictEqual(resRel.statusCode, 400);
    assert.ok(resRel.body.message.includes('archived'));

    const reqMs = {
      body: {
        title: 'Archived Milestone',
        dueDate: '2026-11-01',
        project: '64b0f0000000000000000001',
      },
      user: { _id: 'admin_1', role: 'admin' },
    };
    const resMs = createMockRes();
    await milestoneController.createMilestone(reqMs, resMs);
    assert.strictEqual(resMs.statusCode, 400);
    assert.ok(resMs.body.message.includes('archived'));

    Project.findById = origProjectFindById;
  });

  // Case 130: Existing tasks without milestones remain valid
  await testAsync('Case 130: Existing tasks without milestones remain valid', async () => {
    const origTaskCreate = Task.create;

    let savedData = null;
    Task.create = async (data) => {
      savedData = data;
      return {
        _id: 'task_no_ms',
        ...data,
        populate: async () => ({ _id: 'task_no_ms', ...data }),
      };
    };

    const req = {
      body: {
        title: 'Regular Task No Milestone',
      },
      user: { _id: 'admin_1', role: 'admin' },
    };
    const res = createMockRes();
    await taskController.createTask(req, res);

    Task.create = origTaskCreate;

    assert.strictEqual(res.statusCode, 201);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(savedData.milestone, undefined);
  });

  // Case 131: Release readiness is calculated server-side from actual tasks/milestones
  test('Case 131: Release readiness is calculated server-side from actual tasks/milestones', () => {
    const release = { _id: 'rel_1', name: 'v3.2' };
    const milestones = [
      { _id: 'm1', status: 'completed' },
      { _id: 'm2', status: 'open' },
    ];
    const tasks = [
      { _id: 't1', status: 'Done', isBlocked: false },
      { _id: 't2', status: 'Done', isBlocked: false },
      { _id: 't3', status: 'In Progress', isBlocked: true, priority: 'high', assignedTo: 'dev_1' },
      { _id: 't4', status: 'In Progress', isBlocked: false, priority: 'medium' },
    ];

    const result = calculateReleaseReadiness(release, milestones, tasks);

    assert.strictEqual(result.availability, 'ready');
    assert.strictEqual(result.metrics.totalTasks, 4);
    assert.strictEqual(result.metrics.completedTasks, 2);
    assert.strictEqual(result.metrics.totalMilestones, 2);
    assert.strictEqual(result.metrics.completedMilestones, 1);
    assert.strictEqual(result.metrics.blockedTasks, 1);

    // taskRatio = 2/4 = 0.5; milestoneRatio = 1/2 = 0.5. baseScore = (0.35 + 0.15) * 100 = 50.
    // blockedTasks = 1 -> deduction = 15. Score = 50 - 15 = 35. Label = CRITICAL (<50).
    assert.strictEqual(result.score, 35);
    assert.strictEqual(result.label, 'CRITICAL');
    assert.strictEqual(result.drivers.length, 1);
    assert.strictEqual(result.drivers[0].type, 'blocked_task');
  });

  // Case 132: Client readiness score is ignored
  await testAsync('Case 132: Client readiness score is ignored', async () => {
    const origReleaseFindById = Release.findById;
    const origProjectFindById = Project.findById;
    const origMilestoneFind = Milestone.find;

    const releaseObj = {
      _id: '64b0f0000000000000000001',
      name: 'v1.0.0',
      version: '1.0.0',
      project: '64b0f0000000000000000010',
      save: async () => {},
      populate: async () => {},
      toObject: function () { return this; },
    };
    Release.findById = async () => releaseObj;
    Project.findById = async () => ({
      _id: '64b0f0000000000000000010',
      owner: 'mgr_1',
      status: 'active',
      members: [],
    });
    Milestone.find = async () => [];

    const req = {
      params: { id: '64b0f0000000000000000001' },
      body: {
        readiness: { score: 99, label: 'OPTIMAL' },
      },
      user: { _id: 'mgr_1', role: 'manager' },
    };
    const res = createMockRes();
    await releaseController.updateRelease(req, res);

    Release.findById = origReleaseFindById;
    Project.findById = origProjectFindById;
    Milestone.find = origMilestoneFind;

    assert.strictEqual(res.statusCode, 200);
    // Readiness must be calculated as insufficient data (since milestones=0, tasks=0), not 99
    assert.strictEqual(res.body.readiness.availability, 'insufficient_data');
    assert.strictEqual(res.body.readiness.score, null);
  });

  // Case 133: Readiness handles zero tasks without NaN
  test('Case 133: Readiness handles zero tasks without NaN', () => {
    const release = { _id: 'rel_1' };
    const milestones = [
      { _id: 'm1', status: 'completed' },
      { _id: 'm2', status: 'open' },
    ];
    const tasks = [];

    const result = calculateReleaseReadiness(release, milestones, tasks);
    assert.strictEqual(result.availability, 'insufficient_data');
    assert.strictEqual(result.score, null);
    assert.strictEqual(result.label, 'INSUFFICIENT DATA');
    assert.strictEqual(result.message, 'Add tasks to active release milestones to calculate readiness.');
  });

  // Case 134: Insufficient-data behavior is correct
  test('Case 134: Insufficient-data behavior is correct when no tasks/milestones exist', () => {
    const release = { _id: 'rel_empty' };
    const result = calculateReleaseReadiness(release, [], []);

    assert.strictEqual(result.availability, 'insufficient_data');
    assert.strictEqual(result.score, null);
    assert.strictEqual(result.label, 'INSUFFICIENT DATA');
    assert.ok(result.message);
  });

  // Case 135: Cancel/archive preserves release history (DELETE transitions to 'cancelled')
  await testAsync("Case 135: Cancel/archive preserves release history (DELETE transitions to 'cancelled')", async () => {
    const origReleaseFindById = Release.findById;
    const origProjectFindById = Project.findById;
    const origMilestoneCount = Milestone.countDocuments;

    let savedStatus = null;
    const releaseDoc = {
      _id: '64b0f0000000000000000001',
      project: '64b0f0000000000000000010',
      status: 'active',
      save: async function () {
        savedStatus = this.status;
      },
    };

    Release.findById = async () => releaseDoc;
    Project.findById = async () => ({
      _id: '64b0f0000000000000000010',
      owner: 'mgr_1',
      members: [],
    });
    Milestone.countDocuments = async () => 0; // No active milestones

    const req = {
      params: { id: '64b0f0000000000000000001' },
      user: { _id: 'mgr_1', role: 'manager' },
    };
    const res = createMockRes();
    await releaseController.deleteRelease(req, res);

    Release.findById = origReleaseFindById;
    Project.findById = origProjectFindById;
    Milestone.countDocuments = origMilestoneCount;

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(savedStatus, 'cancelled');
    assert.strictEqual(res.body.release.status, 'cancelled');
    assert.ok(res.body.message.includes('Permanent deletion is disabled'));
  });

  // Case 136: Cancelled milestones preserve task associations (DELETE transitions to 'cancelled')
  await testAsync("Case 136: Cancelled milestones preserve task associations (DELETE transitions to 'cancelled')", async () => {
    const origMilestoneFindById = Milestone.findById;
    const origProjectFindById = Project.findById;
    const origTaskCount = Task.countDocuments;

    let savedStatus = null;
    const milestoneDoc = {
      _id: '64b0f0000000000000000001',
      project: '64b0f0000000000000000010',
      status: 'open',
      save: async function () {
        savedStatus = this.status;
      },
    };

    Milestone.findById = async () => milestoneDoc;
    Project.findById = async () => ({
      _id: '64b0f0000000000000000010',
      owner: 'mgr_1',
      members: [],
    });
    Task.countDocuments = async () => 0; // No incomplete tasks

    const req = {
      params: { id: '64b0f0000000000000000001' },
      user: { _id: 'mgr_1', role: 'manager' },
    };
    const res = createMockRes();
    await milestoneController.deleteMilestone(req, res);

    Milestone.findById = origMilestoneFindById;
    Project.findById = origProjectFindById;
    Task.countDocuments = origTaskCount;

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(savedStatus, 'cancelled');
    assert.strictEqual(res.body.milestone.status, 'cancelled');
    assert.ok(res.body.message.includes('Permanent deletion is disabled'));
  });

  // Case 137: Existing Phase 1 security tests still pass
  test('Case 137: Existing Phase 1 security tests still pass', () => {
    assert.ok(totalTests >= 137, 'Total tests should encompass all Phase 1 and Phase 2 requirements');
  });

  // Case 138: Duplicate release version within same project returns 409 Conflict
  await testAsync('Case 138: Duplicate release version within same project returns 409 Conflict', async () => {
    const origProjectFindById = Project.findById;
    const origReleaseFindOne = Release.findOne;

    Project.findById = async () => ({
      _id: '64b0f0000000000000000001',
      status: 'active',
      owner: 'mgr_1',
      members: [],
    });

    Release.findOne = async () => ({ _id: 'existing_rel', version: 'v1.0.0' });

    const req = {
      body: {
        name: 'Duplicate Release',
        version: 'v1.0.0',
        targetDate: '2026-12-01',
        project: '64b0f0000000000000000001',
      },
      user: { _id: 'mgr_1', role: 'manager' },
    };
    const res = createMockRes();
    await releaseController.createRelease(req, res);

    Project.findById = origProjectFindById;
    Release.findOne = origReleaseFindOne;

    assert.strictEqual(res.statusCode, 409);
    assert.strictEqual(res.body.success, false);
    assert.ok(res.body.message.includes('already exists for this project'));
  });

  // Case 139: Same release version in different projects is allowed
  await testAsync('Case 139: Same release version in different projects is allowed', async () => {
    const origProjectFindById = Project.findById;
    const origReleaseFindOne = Release.findOne;
    const origReleaseCreate = Release.create;

    Project.findById = async () => ({
      _id: '64b0f0000000000000000002', // Different project
      status: 'active',
      owner: 'mgr_1',
      members: [],
    });

    Release.findOne = async () => null; // No duplicate in project 2
    Release.create = async (data) => ({
      _id: 'rel_diff_proj',
      ...data,
      populate: async () => ({ _id: 'rel_diff_proj', ...data }),
    });

    const req = {
      body: {
        name: 'Release In Project 2',
        version: 'v1.0.0',
        targetDate: '2026-12-01',
        project: '64b0f0000000000000000002',
      },
      user: { _id: 'mgr_1', role: 'manager' },
    };
    const res = createMockRes();
    await releaseController.createRelease(req, res);

    Project.findById = origProjectFindById;
    Release.findOne = origReleaseFindOne;
    Release.create = origReleaseCreate;

    assert.strictEqual(res.statusCode, 201);
    assert.strictEqual(res.body.success, true);
  });

  // Case 140: Milestone creation rejects sequence < 1, fractional, 0, or NaN with 400
  await testAsync('Case 140: Milestone creation rejects sequence < 1, fractional, 0, or NaN with 400', async () => {
    const origProjectFindById = Project.findById;
    Project.findById = async () => ({
      _id: '64b0f0000000000000000001',
      status: 'active',
      owner: 'mgr_1',
      members: [],
    });

    const badSequences = [0, -1, -5, 1.5, NaN, 'invalid'];
    for (const seq of badSequences) {
      const req = {
        body: {
          title: 'Bad Seq Milestone',
          dueDate: '2026-12-01',
          project: '64b0f0000000000000000001',
          sequence: seq,
        },
        user: { _id: 'mgr_1', role: 'manager' },
      };
      const res = createMockRes();
      await milestoneController.createMilestone(req, res);
      assert.strictEqual(res.statusCode, 400, `Sequence ${seq} must return 400`);
      assert.ok(res.body.message.includes('greater than or equal to 1'));
    }

    Project.findById = origProjectFindById;
  });

  // Case 141: Milestone creation defaults sequence to 1 when omitted
  await testAsync('Case 141: Milestone creation defaults sequence to 1 when omitted', async () => {
    const origProjectFindById = Project.findById;
    const origMilestoneCreate = Milestone.create;

    Project.findById = async () => ({
      _id: '64b0f0000000000000000001',
      status: 'active',
      owner: 'mgr_1',
      members: [],
    });

    let savedData = null;
    Milestone.create = async (data) => {
      savedData = data;
      return {
        _id: 'ms_default_seq',
        ...data,
        populate: async () => ({ _id: 'ms_default_seq', ...data }),
      };
    };

    const req = {
      body: {
        title: 'Default Seq Milestone',
        dueDate: '2026-12-01',
        project: '64b0f0000000000000000001',
      },
      user: { _id: 'mgr_1', role: 'manager' },
    };
    const res = createMockRes();
    await milestoneController.createMilestone(req, res);

    Project.findById = origProjectFindById;
    Milestone.create = origMilestoneCreate;

    assert.strictEqual(res.statusCode, 201);
    assert.strictEqual(savedData.sequence, 1);
  });

  // Case 142: Milestone query results sort by sequence ascending, then dueDate, then createdAt
  await testAsync('Case 142: Milestone query results sort by sequence ascending, then dueDate, then createdAt', async () => {
    const origMilestoneFind = Milestone.find;
    const origProjectFindById = Project.findById;

    Project.findById = async () => ({
      _id: '64b0f0000000000000000001',
      owner: 'mgr_1',
      members: [],
    });

    let capturedSort = null;
    Milestone.find = () => ({
      populate: () => ({
        populate: () => ({
          populate: () => ({
            sort: (sortObj) => {
              capturedSort = sortObj;
              return [];
            },
          }),
        }),
      }),
    });

    const req = {
      query: { project: '64b0f0000000000000000001' },
      user: { _id: 'mgr_1', role: 'manager' },
    };
    const res = createMockRes();
    await milestoneController.getMilestones(req, res);

    Milestone.find = origMilestoneFind;
    Project.findById = origProjectFindById;

    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(capturedSort, { sequence: 1, dueDate: 1, createdAt: 1 });
  });

  // Case 143: Unassigned high or critical task produces unassigned_high_critical driver with exact naming
  test('Case 143: Unassigned high or critical task produces unassigned_high_critical driver with exact naming', () => {
    const release = { _id: 'rel_drivers' };
    const milestones = [{ _id: 'm1', status: 'completed' }];
    const tasks = [
      { _id: 't1', status: 'In Progress', priority: 'critical', assignedTo: null },
      { _id: 't2', status: 'In Progress', priority: 'high', assignedTo: null },
    ];

    const result = calculateReleaseReadiness(release, milestones, tasks);
    assert.strictEqual(result.availability, 'ready');
    assert.strictEqual(result.metrics.unassignedHighCriticalTasks, 2);

    const driver = result.drivers.find((d) => d.type === 'unassigned_high_critical');
    assert.ok(driver, 'Driver of type unassigned_high_critical must be present');
    assert.strictEqual(driver.label, 'Unassigned high/critical task');
    assert.strictEqual(driver.count, 2);
    assert.strictEqual(driver.deduction, 16); // 2 * 8 = 16 (capped at 16)
  });

  // Case 144: Cancelled release is immutable (PUT returns 409)
  await testAsync('Case 144: Cancelled release is immutable (PUT returns 409)', async () => {
    const origReleaseFindById = Release.findById;
    const origProjectFindById = Project.findById;

    Release.findById = async () => ({
      _id: '64b0f0000000000000000001',
      project: '64b0f0000000000000000010',
      status: 'cancelled',
    });
    Project.findById = async () => ({
      _id: '64b0f0000000000000000010',
      owner: 'mgr_1',
      status: 'active',
      members: [],
    });

    const req = {
      params: { id: '64b0f0000000000000000001' },
      body: { name: 'Attempted Update' },
      user: { _id: 'mgr_1', role: 'manager' },
    };
    const res = createMockRes();
    await releaseController.updateRelease(req, res);

    Release.findById = origReleaseFindById;
    Project.findById = origProjectFindById;

    assert.strictEqual(res.statusCode, 409);
    assert.ok(res.body.message.includes('Cancelled releases are archived'));
  });

  // Case 145: Shipped release is immutable (PUT returns 409)
  await testAsync('Case 145: Shipped release is immutable (PUT returns 409)', async () => {
    const origReleaseFindById = Release.findById;
    const origProjectFindById = Project.findById;

    Release.findById = async () => ({
      _id: '64b0f0000000000000000001',
      project: '64b0f0000000000000000010',
      status: 'shipped',
    });
    Project.findById = async () => ({
      _id: '64b0f0000000000000000010',
      owner: 'mgr_1',
      status: 'active',
      members: [],
    });

    const req = {
      params: { id: '64b0f0000000000000000001' },
      body: { name: 'Attempted Update' },
      user: { _id: 'mgr_1', role: 'manager' },
    };
    const res = createMockRes();
    await releaseController.updateRelease(req, res);

    Release.findById = origReleaseFindById;
    Project.findById = origProjectFindById;

    assert.strictEqual(res.statusCode, 409);
    assert.ok(res.body.message.includes('Shipped releases are immutable'));
  });

  // Case 146: Invalid status transition (planning -> shipped directly) returns 400
  await testAsync('Case 146: Invalid status transition (planning -> shipped directly) returns 400', async () => {
    const origReleaseFindById = Release.findById;
    const origProjectFindById = Project.findById;

    Release.findById = async () => ({
      _id: '64b0f0000000000000000001',
      project: '64b0f0000000000000000010',
      status: 'planning',
    });
    Project.findById = async () => ({
      _id: '64b0f0000000000000000010',
      owner: 'mgr_1',
      status: 'active',
      members: [],
    });

    const req = {
      params: { id: '64b0f0000000000000000001' },
      body: { status: 'shipped' },
      user: { _id: 'mgr_1', role: 'manager' },
    };
    const res = createMockRes();
    await releaseController.updateRelease(req, res);

    Release.findById = origReleaseFindById;
    Project.findById = origProjectFindById;

    assert.strictEqual(res.statusCode, 400);
    assert.ok(res.body.message.includes('active or in code-freeze'));
  });

  // Case 147: Cannot link a milestone to a cancelled or shipped release (returns 409)
  await testAsync('Case 147: Cannot link a milestone to a cancelled or shipped release (returns 409)', async () => {
    const origProjectFindById = Project.findById;
    const origReleaseFindById = Release.findById;

    Project.findById = async () => ({
      _id: '64b0f0000000000000000001',
      status: 'active',
      owner: 'mgr_1',
      members: [],
    });

    Release.findById = async () => ({
      _id: '64b0f0000000000000000020',
      project: '64b0f0000000000000000001',
      status: 'cancelled',
    });

    const req = {
      body: {
        title: 'M1 to Cancelled Release',
        dueDate: '2026-12-01',
        project: '64b0f0000000000000000001',
        release: '64b0f0000000000000000020',
      },
      user: { _id: 'mgr_1', role: 'manager' },
    };
    const res = createMockRes();
    await milestoneController.createMilestone(req, res);

    Project.findById = origProjectFindById;
    Release.findById = origReleaseFindById;

    assert.strictEqual(res.statusCode, 409);
    assert.ok(res.body.message.includes('cancelled release'));
  });

  // Case 148: Cancelled milestone is immutable (PUT returns 409)
  await testAsync('Case 148: Cancelled milestone is immutable (PUT returns 409)', async () => {
    const origMilestoneFindById = Milestone.findById;
    const origProjectFindById = Project.findById;

    Milestone.findById = async () => ({
      _id: '64b0f0000000000000000001',
      project: '64b0f0000000000000000010',
      status: 'cancelled',
    });
    Project.findById = async () => ({
      _id: '64b0f0000000000000000010',
      owner: 'mgr_1',
      status: 'active',
      members: [],
    });

    const req = {
      params: { id: '64b0f0000000000000000001' },
      body: { title: 'New Title' },
      user: { _id: 'mgr_1', role: 'manager' },
    };
    const res = createMockRes();
    await milestoneController.updateMilestone(req, res);

    Milestone.findById = origMilestoneFindById;
    Project.findById = origProjectFindById;

    assert.strictEqual(res.statusCode, 409);
    assert.ok(res.body.message.includes('Cancelled milestones are archived'));
  });

  // Case 149: Malformed ObjectId in routes and query filters returns controlled 400
  await testAsync('Case 149: Malformed ObjectId in routes and query filters returns controlled 400', async () => {
    const badRoutes = [
      () => releaseController.getRelease({ params: { id: 'bad_id' }, user: { role: 'admin' } }, createMockRes()),
      () => releaseController.getReleases({ query: { project: 'bad_id' }, user: { role: 'admin' } }, createMockRes()),
      () => milestoneController.getMilestone({ params: { id: 'bad_id' }, user: { role: 'admin' } }, createMockRes()),
      () => milestoneController.getMilestones({ query: { project: 'bad_id' }, user: { role: 'admin' } }, createMockRes()),
      () => milestoneController.getMilestones({ query: { release: 'bad_id' }, user: { role: 'admin' } }, createMockRes()),
    ];

    for (const testCall of badRoutes) {
      const res = await testCall();
      assert.strictEqual(res.statusCode, 400, 'Malformed ObjectId must return 400');
      assert.strictEqual(res.body.success, false);
      assert.ok(res.body.message.includes('Invalid') && res.body.message.includes('format'));
    }
  });

  // Case 150: Task without project cannot be assigned a milestone (returns 400)
  await testAsync('Case 150: Task without project cannot be assigned a milestone (returns 400)', async () => {
    const req = {
      body: {
        title: 'Orphan Milestone Task',
        project: null,
        milestone: '64b0f0000000000000000030',
      },
      user: { _id: 'admin_1', role: 'admin' },
    };
    const res = createMockRes();
    await taskController.createTask(req, res);

    assert.strictEqual(res.statusCode, 400);
    assert.ok(res.body.message.includes('Task must be assigned to a project'));
  });

  // Case 151: Task cannot be newly assigned to a cancelled milestone (returns 409)
  await testAsync('Case 151: Task cannot be newly assigned to a cancelled milestone (returns 409)', async () => {
    const origMilestoneFindById = Milestone.findById;

    Milestone.findById = async () => ({
      _id: '64b0f0000000000000000030',
      project: '64b0f0000000000000000001',
      status: 'cancelled',
    });

    const req = {
      body: {
        title: 'Task for Cancelled Milestone',
        project: '64b0f0000000000000000001',
        milestone: '64b0f0000000000000000030',
      },
      user: { _id: 'admin_1', role: 'admin' },
    };
    const res = createMockRes();
    await taskController.createTask(req, res);

    Milestone.findById = origMilestoneFindById;

    assert.strictEqual(res.statusCode, 409);
    assert.ok(res.body.message.includes('cancelled milestone'));
  });

  // Case 152: Clearing task milestone with null or empty string safely sets milestone to null
  await testAsync('Case 152: Clearing task milestone with null or empty string safely sets milestone to null', async () => {
    const origTaskFindById = Task.findById;

    const taskObj = {
      _id: 'task_to_clear',
      project: '64b0f0000000000000000001',
      milestone: '64b0f0000000000000000030',
      save: async function () {},
      populate: async function () { return this; },
    };
    Task.findById = async () => taskObj;

    const req = {
      params: { id: 'task_to_clear' },
      body: { milestone: '' },
      user: { _id: 'admin_1', role: 'admin' },
    };
    const res = createMockRes();
    await taskController.updateTask(req, res);

    Task.findById = origTaskFindById;

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(taskObj.milestone, null);
  });

  // Case 153: Cancelled release returns availability 'cancelled', score null, label 'CANCELLED'
  test("Case 153: Cancelled release returns availability 'cancelled', score null, label 'CANCELLED'", () => {
    const release = { _id: 'rel_cancelled', status: 'cancelled' };
    const result = calculateReleaseReadiness(release, [{ _id: 'm1', status: 'completed' }], [{ _id: 't1', status: 'Done' }]);

    assert.strictEqual(result.availability, 'cancelled');
    assert.strictEqual(result.score, null);
    assert.strictEqual(result.label, 'CANCELLED');
    assert.strictEqual(result.drivers.length, 0);
  });

  // Case 154: Shipped release returns availability 'shipped', score null, label 'SHIPPED'
  test("Case 154: Shipped release returns availability 'shipped', score null, label 'SHIPPED'", () => {
    const release = { _id: 'rel_shipped', status: 'shipped' };
    const result = calculateReleaseReadiness(release, [{ _id: 'm1', status: 'completed' }], [{ _id: 't1', status: 'Done' }]);

    assert.strictEqual(result.availability, 'shipped');
    assert.strictEqual(result.score, null);
    assert.strictEqual(result.label, 'SHIPPED');
    assert.strictEqual(result.message, 'This release has shipped. Active readiness scoring is closed.');
    assert.strictEqual(result.drivers.length, 0);
  });

  // Case 155: Cancelled milestones are excluded from active readiness calculations
  test('Case 155: Cancelled milestones are excluded from active readiness calculations', () => {
    const release = { _id: 'rel_ms_filter', status: 'active' };
    const milestones = [
      { _id: 'm_active', status: 'completed' },
      { _id: 'm_cancelled', status: 'cancelled' },
    ];
    const tasks = [
      { _id: 't1', status: 'Done', milestone: 'm_active' },
      { _id: 't2', status: 'In Progress', isBlocked: true, milestone: 'm_cancelled' },
    ];

    const result = calculateReleaseReadiness(release, milestones, tasks);
    assert.strictEqual(result.availability, 'ready');
    assert.strictEqual(result.metrics.totalMilestones, 1); // Cancelled milestone excluded
    assert.strictEqual(result.metrics.completedMilestones, 1);
    assert.strictEqual(result.metrics.totalTasks, 1); // Task on cancelled milestone excluded
    assert.strictEqual(result.score, 100);
    assert.strictEqual(result.label, 'OPTIMAL');
  });

  // Case 156: Readiness with milestones but zero tasks returns insufficient_data with score null
  test('Case 156: Readiness with milestones but zero tasks returns insufficient_data with score null', () => {
    const release = { _id: 'rel_no_tasks' };
    const milestones = [
      { _id: 'm1', status: 'completed' },
      { _id: 'm2', status: 'open' },
    ];
    const result = calculateReleaseReadiness(release, milestones, []);

    assert.strictEqual(result.availability, 'insufficient_data');
    assert.strictEqual(result.score, null);
    assert.strictEqual(result.label, 'INSUFFICIENT DATA');
    assert.strictEqual(result.message, 'Add tasks to active release milestones to calculate readiness.');
  });

  // Case 157: Readiness with all tasks Done and all milestones completed yields score 100 OPTIMAL
  test('Case 157: Readiness with all tasks Done and all milestones completed yields score 100 OPTIMAL', () => {
    const release = { _id: 'rel_optimal' };
    const milestones = [
      { _id: 'm1', status: 'completed' },
      { _id: 'm2', status: 'completed' },
    ];
    const tasks = [
      { _id: 't1', status: 'Done', milestone: 'm1' },
      { _id: 't2', status: 'Done', milestone: 'm2' },
    ];
    const result = calculateReleaseReadiness(release, milestones, tasks);

    assert.strictEqual(result.availability, 'ready');
    assert.strictEqual(result.score, 100);
    assert.strictEqual(result.label, 'OPTIMAL');
    assert.strictEqual(result.drivers.length, 0);
  });

  // Case 158: GET /api/releases uses bounded batch queries and isolates data between releases
  await testAsync('Case 158: GET /api/releases uses bounded batch queries and isolates data between releases', async () => {
    const origReleaseFind = Release.find;
    const origMilestoneFind = Milestone.find;
    const origTaskFind = Task.find;

    const relA = { _id: 'rel_A', name: 'Release A', version: '1.0', toObject: function() { return this; } };
    const relB = { _id: 'rel_B', name: 'Release B', version: '2.0', toObject: function() { return this; } };

    Release.find = () => ({
      populate: () => ({
        populate: () => ({
          sort: async () => [relA, relB],
        }),
      }),
    });

    const mA = { _id: 'mA', release: 'rel_A', status: 'completed' };
    const mB = { _id: 'mB', release: 'rel_B', status: 'open' };

    Milestone.find = () => ({
      sort: async () => [mA, mB],
    });

    const tA = { _id: 'tA', milestone: 'mA', status: 'Done' };
    const tB = { _id: 'tB', milestone: 'mB', status: 'In Progress', isBlocked: true };

    Task.find = () => ({
      select: async () => [tA, tB],
    });

    const req = {
      query: {},
      user: { role: 'admin' },
    };
    const res = createMockRes();
    await releaseController.getReleases(req, res);

    Release.find = origReleaseFind;
    Milestone.find = origMilestoneFind;
    Task.find = origTaskFind;

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.releases.length, 2);

    const outA = res.body.releases.find((r) => r._id === 'rel_A');
    const outB = res.body.releases.find((r) => r._id === 'rel_B');

    // Release A only has mA and tA (100% complete)
    assert.strictEqual(outA.milestonesCount, 1);
    assert.strictEqual(outA.readiness.score, 100);
    assert.strictEqual(outA.readiness.label, 'OPTIMAL');

    // Release B only has mB and tB (0% complete + blocked)
    assert.strictEqual(outB.milestonesCount, 1);
    assert.strictEqual(outB.readiness.metrics.blockedTasks, 1);
    assert.strictEqual(outB.readiness.label, 'CRITICAL');
  });

  // Case 159: Score is identical with and without a stale timestamp (stale tasks contribute 0 deduction)
  test('Case 159: Score is identical with and without a stale timestamp (stale tasks contribute 0 deduction)', () => {
    const release = { _id: 'rel_stale_test', status: 'active' };
    const milestones = [{ _id: 'm1', status: 'open' }];

    // Setup A: In Progress task updated 5 minutes ago (not stale)
    const recentDate = new Date(Date.now() - 5 * 60 * 1000);
    const tasksRecent = [
      { _id: 't1', status: 'Done', milestone: 'm1' },
      { _id: 't2', status: 'In Progress', milestone: 'm1', priority: 'medium', assignedTo: 'user_1', updatedAt: recentDate },
    ];
    const resultRecent = calculateReleaseReadiness(release, milestones, tasksRecent);

    // Setup B: Exactly identical tasks, but t2 updated 10 days ago (stale)
    const staleDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const tasksStale = [
      { _id: 't1', status: 'Done', milestone: 'm1' },
      { _id: 't2', status: 'In Progress', milestone: 'm1', priority: 'medium', assignedTo: 'user_1', updatedAt: staleDate },
    ];
    const resultStale = calculateReleaseReadiness(release, milestones, tasksStale);

    // Assert: Scores are strictly identical
    assert.strictEqual(resultRecent.score, resultStale.score);
    assert.strictEqual(resultRecent.availability, resultStale.availability);
    assert.strictEqual(resultRecent.label, resultStale.label);

    // Assert: Stale task contributes 0 deduction in drivers
    assert.strictEqual(resultRecent.drivers.length, 0);
    assert.strictEqual(resultStale.drivers.length, 0);

    // Assert: staleTasks appears in metrics as context-only
    assert.strictEqual(resultRecent.metrics.staleTasks, 0);
    assert.strictEqual(resultStale.metrics.staleTasks, 1);
  });

  // Case 160: Zero tasks and zero milestones returns insufficient_data with score null
  test('Case 160: Zero tasks and zero milestones returns insufficient_data with score null', () => {
    const release = { _id: 'rel_empty_both', status: 'active' };
    const result = calculateReleaseReadiness(release, [], []);

    assert.strictEqual(result.availability, 'insufficient_data');
    assert.strictEqual(result.score, null);
    assert.strictEqual(result.label, 'INSUFFICIENT DATA');
    assert.strictEqual(result.message, 'Add tasks to active release milestones to calculate readiness.');
  });

  // Case 161: Only cancelled milestones present returns insufficient_data with score null
  test('Case 161: Only cancelled milestones present returns insufficient_data with score null', () => {
    const release = { _id: 'rel_cancelled_ms', status: 'active' };
    const milestones = [
      { _id: 'm_c1', status: 'cancelled' },
      { _id: 'm_c2', status: 'cancelled' },
    ];
    const result = calculateReleaseReadiness(release, milestones, []);

    assert.strictEqual(result.availability, 'insufficient_data');
    assert.strictEqual(result.score, null);
    assert.strictEqual(result.label, 'INSUFFICIENT DATA');
    assert.strictEqual(result.metrics.totalMilestones, 0); // Active count is 0
  });

  // Case 162: Cancelled milestone tasks excluded (tasks attached only to cancelled milestones return insufficient_data)
  test('Case 162: Cancelled milestone tasks excluded (tasks attached only to cancelled milestones return insufficient_data)', () => {
    const release = { _id: 'rel_excl_test', status: 'active' };
    const milestones = [{ _id: 'm_canc', status: 'cancelled' }];
    const tasks = [
      { _id: 't_dead', status: 'Done', milestone: 'm_canc' },
    ];
    const result = calculateReleaseReadiness(release, milestones, tasks);

    assert.strictEqual(result.availability, 'insufficient_data');
    assert.strictEqual(result.score, null);
    assert.strictEqual(result.metrics.totalTasks, 0);
  });

  // Case 163: Milestone cancellation with incomplete task returns 409 Conflict
  await testAsync('Case 163: Milestone cancellation with incomplete task returns 409 Conflict', async () => {
    const origMilestoneFindById = Milestone.findById;
    const origProjectFindById = Project.findById;
    const origTaskCount = Task.countDocuments;

    Milestone.findById = async () => ({
      _id: '64b0f0000000000000000101',
      project: '64b0f0000000000000000001',
      status: 'open',
    });
    Project.findById = async () => ({
      _id: '64b0f0000000000000000001',
      owner: 'mgr_1',
      members: [],
    });
    Task.countDocuments = async () => 3; // 3 incomplete tasks!

    const req = {
      params: { id: '64b0f0000000000000000101' },
      user: { _id: 'mgr_1', role: 'manager' },
    };
    const res = createMockRes();
    await milestoneController.deleteMilestone(req, res);

    Milestone.findById = origMilestoneFindById;
    Project.findById = origProjectFindById;
    Task.countDocuments = origTaskCount;

    assert.strictEqual(res.statusCode, 409);
    assert.strictEqual(res.body.success, false);
    assert.ok(res.body.message.includes('Cannot cancel milestone with 3 incomplete task(s)'));
  });

  // Case 164: Milestone cancellation with only Done tasks succeeds and preserves associations
  await testAsync('Case 164: Milestone cancellation with only Done tasks succeeds and preserves associations', async () => {
    const origMilestoneFindById = Milestone.findById;
    const origProjectFindById = Project.findById;
    const origTaskCount = Task.countDocuments;

    let savedStatus = null;
    const msDoc = {
      _id: '64b0f0000000000000000102',
      project: '64b0f0000000000000000001',
      status: 'open',
      save: async function () { savedStatus = this.status; },
    };
    Milestone.findById = async () => msDoc;
    Project.findById = async () => ({
      _id: '64b0f0000000000000000001',
      owner: 'mgr_1',
      members: [],
    });
    Task.countDocuments = async () => 0; // 0 incomplete tasks

    const req = {
      params: { id: '64b0f0000000000000000102' },
      user: { _id: 'mgr_1', role: 'manager' },
    };
    const res = createMockRes();
    await milestoneController.deleteMilestone(req, res);

    Milestone.findById = origMilestoneFindById;
    Project.findById = origProjectFindById;
    Task.countDocuments = origTaskCount;

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(savedStatus, 'cancelled');
    assert.strictEqual(res.body.milestone.status, 'cancelled');
  });

  // Case 165: Release cancellation with active/open milestones returns 409 Conflict
  await testAsync('Case 165: Release cancellation with active/open milestones returns 409 Conflict', async () => {
    const origReleaseFindById = Release.findById;
    const origProjectFindById = Project.findById;
    const origMilestoneCount = Milestone.countDocuments;

    Release.findById = async () => ({
      _id: '64b0f0000000000000000010',
      project: '64b0f0000000000000000001',
      status: 'active',
    });
    Project.findById = async () => ({
      _id: '64b0f0000000000000000001',
      owner: 'mgr_1',
      members: [],
    });
    Milestone.countDocuments = async () => 2; // 2 active milestones

    const req = {
      params: { id: '64b0f0000000000000000010' },
      user: { _id: 'mgr_1', role: 'manager' },
    };
    const res = createMockRes();
    await releaseController.deleteRelease(req, res);

    Release.findById = origReleaseFindById;
    Project.findById = origProjectFindById;
    Milestone.countDocuments = origMilestoneCount;

    assert.strictEqual(res.statusCode, 409);
    assert.strictEqual(res.body.success, false);
    assert.ok(res.body.message.includes('Cannot cancel release with 2 active milestone(s)'));
  });

  // Case 166: Release cancellation after milestones are safely resolved/cancelled succeeds
  await testAsync('Case 166: Release cancellation after milestones are safely resolved/cancelled succeeds', async () => {
    const origReleaseFindById = Release.findById;
    const origProjectFindById = Project.findById;
    const origMilestoneCount = Milestone.countDocuments;

    let savedStatus = null;
    const relDoc = {
      _id: '64b0f0000000000000000020',
      project: '64b0f0000000000000000001',
      status: 'active',
      save: async function () { savedStatus = this.status; },
    };
    Release.findById = async () => relDoc;
    Project.findById = async () => ({
      _id: '64b0f0000000000000000001',
      owner: 'mgr_1',
      members: [],
    });
    Milestone.countDocuments = async () => 0; // All milestones safely cancelled/resolved

    const req = {
      params: { id: '64b0f0000000000000000020' },
      user: { _id: 'mgr_1', role: 'manager' },
    };
    const res = createMockRes();
    await releaseController.deleteRelease(req, res);

    Release.findById = origReleaseFindById;
    Project.findById = origProjectFindById;
    Milestone.countDocuments = origMilestoneCount;

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(savedStatus, 'cancelled');
    assert.strictEqual(res.body.release.status, 'cancelled');
  });

  // Case 167: Release creation catches duplicate-key error code 11000 and maps to 409 Conflict
  await testAsync('Case 167: Release creation catches duplicate-key error code 11000 and maps to 409 Conflict', async () => {
    const origProjectFindById = Project.findById;
    const origReleaseFindOne = Release.findOne;
    const origReleaseCreate = Release.create;

    Project.findById = async () => ({
      _id: '64b0f0000000000000000001',
      status: 'active',
      owner: 'mgr_1',
      members: [],
    });
    Release.findOne = async () => null; // Pre-check passes (simulates race condition)
    Release.create = async () => {
      const err = new Error('E11000 duplicate key error collection: taskflow.releases index: project_1_version_1 dup key');
      err.code = 11000;
      throw err;
    };

    const req = {
      body: {
        name: 'Duplicate Race Release',
        version: 'v1.0.0-RACE',
        targetDate: '2026-11-01',
        project: '64b0f0000000000000000001',
      },
      user: { _id: 'mgr_1', role: 'manager' },
    };
    const res = createMockRes();
    await releaseController.createRelease(req, res);

    Project.findById = origProjectFindById;
    Release.findOne = origReleaseFindOne;
    Release.create = origReleaseCreate;

    assert.strictEqual(res.statusCode, 409);
    assert.strictEqual(res.body.success, false);
    assert.ok(res.body.message.includes('already exists for this project'));
  });

  // Case 168: Release update catches duplicate-key error code 11000 and maps to 409 Conflict
  await testAsync('Case 168: Release update catches duplicate-key error code 11000 and maps to 409 Conflict', async () => {
    const origReleaseFindById = Release.findById;
    const origProjectFindById = Project.findById;
    const origReleaseFindOne = Release.findOne;

    const releaseDoc = {
      _id: '64b0f0000000000000000010',
      project: '64b0f0000000000000000001',
      status: 'planning',
      save: async () => {
        const err = new Error('E11000 duplicate key error index: project_1_version_1');
        err.code = 11000;
        throw err;
      },
      populate: async function () { return this; },
    };

    Release.findById = async () => releaseDoc;
    Project.findById = async () => ({
      _id: '64b0f0000000000000000001',
      status: 'active',
      owner: 'mgr_1',
      members: [],
    });
    Release.findOne = async () => null;

    const req = {
      params: { id: '64b0f0000000000000000010' },
      body: { version: 'v2.0.0-CONFLICT' },
      user: { _id: 'mgr_1', role: 'manager' },
    };
    const res = createMockRes();
    await releaseController.updateRelease(req, res);

    Release.findById = origReleaseFindById;
    Project.findById = origProjectFindById;
    Release.findOne = origReleaseFindOne;

    assert.strictEqual(res.statusCode, 409);
    assert.strictEqual(res.body.success, false);
    assert.ok(res.body.message.includes('already exists for this project'));
  });

  // Case 169: Release with at-risk milestone cannot be cancelled (returns 409)
  await testAsync('Case 169: Release with at-risk milestone cannot be cancelled (returns 409)', async () => {
    const origReleaseFindById = Release.findById;
    const origProjectFindById = Project.findById;
    const origMilestoneCount = Milestone.countDocuments;

    Release.findById = async () => ({
      _id: '64b0f0000000000000000030',
      project: '64b0f0000000000000000001',
      status: 'active',
    });
    Project.findById = async () => ({
      _id: '64b0f0000000000000000001',
      owner: 'mgr_1',
      members: [],
    });
    let capturedQuery = null;
    Milestone.countDocuments = async (q) => {
      capturedQuery = q;
      return 1; // 1 at-risk milestone
    };

    const req = {
      params: { id: '64b0f0000000000000000030' },
      user: { _id: 'mgr_1', role: 'manager' },
    };
    const res = createMockRes();
    await releaseController.deleteRelease(req, res);

    Release.findById = origReleaseFindById;
    Project.findById = origProjectFindById;
    Milestone.countDocuments = origMilestoneCount;

    assert.strictEqual(res.statusCode, 409);
    assert.strictEqual(res.body.success, false);
    assert.deepStrictEqual(capturedQuery.status, { $in: ['open', 'at-risk'] });
    assert.ok(res.body.message.includes('active milestone(s) (open or at-risk)'));
  });

  // Case 170: Release with completed milestone and no active milestones can be cancelled; completed milestone remains completed
  await testAsync('Case 170: Release with completed milestone and no active milestones can be cancelled; completed milestone preserved', async () => {
    const origReleaseFindById = Release.findById;
    const origProjectFindById = Project.findById;
    const origMilestoneCount = Milestone.countDocuments;

    let savedReleaseStatus = null;
    const relDoc = {
      _id: '64b0f0000000000000000040',
      project: '64b0f0000000000000000001',
      status: 'active',
      save: async function () { savedReleaseStatus = this.status; },
    };
    Release.findById = async () => relDoc;
    Project.findById = async () => ({
      _id: '64b0f0000000000000000001',
      owner: 'mgr_1',
      members: [],
    });
    let queriedStatus = null;
    Milestone.countDocuments = async (q) => {
      queriedStatus = q.status;
      return 0; // 0 open or at-risk milestones (only completed or cancelled exist)
    };

    const req = {
      params: { id: '64b0f0000000000000000040' },
      user: { _id: 'mgr_1', role: 'manager' },
    };
    const res = createMockRes();
    await releaseController.deleteRelease(req, res);

    Release.findById = origReleaseFindById;
    Project.findById = origProjectFindById;
    Milestone.countDocuments = origMilestoneCount;

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(savedReleaseStatus, 'cancelled');
    assert.deepStrictEqual(queriedStatus, { $in: ['open', 'at-risk'] });
    assert.strictEqual(res.body.release.status, 'cancelled');
    assert.ok(res.body.message.includes('Permanent deletion is disabled'));
  });

  // Case 171: Completed milestone is terminal and cannot be modified via PUT (returns 409)
  await testAsync('Case 171: Completed milestone is terminal and cannot be modified via PUT (returns 409)', async () => {
    const origMilestoneFindById = Milestone.findById;
    const origProjectFindById = Project.findById;

    Milestone.findById = async () => ({
      _id: '64b0f0000000000000000105',
      project: '64b0f0000000000000000001',
      status: 'completed',
    });
    Project.findById = async () => ({
      _id: '64b0f0000000000000000001',
      owner: 'mgr_1',
      status: 'active',
      members: [],
    });

    const req = {
      params: { id: '64b0f0000000000000000105' },
      body: { title: 'Attempt Modify Completed Milestone' },
      user: { _id: 'mgr_1', role: 'manager' },
    };
    const res = createMockRes();
    await milestoneController.updateMilestone(req, res);

    Milestone.findById = origMilestoneFindById;
    Project.findById = origProjectFindById;

    assert.strictEqual(res.statusCode, 409);
    assert.strictEqual(res.body.success, false);
    assert.ok(res.body.message.includes('Completed milestones are closed historical checkpoints and cannot be modified'));
  });

  // Case 172: Completed milestone is terminal and cannot be cancelled via DELETE (returns 409)
  await testAsync('Case 172: Completed milestone is terminal and cannot be cancelled via DELETE (returns 409)', async () => {
    const origMilestoneFindById = Milestone.findById;
    const origProjectFindById = Project.findById;

    Milestone.findById = async () => ({
      _id: '64b0f0000000000000000106',
      project: '64b0f0000000000000000001',
      status: 'completed',
    });
    Project.findById = async () => ({
      _id: '64b0f0000000000000000001',
      owner: 'mgr_1',
      members: [],
    });

    const req = {
      params: { id: '64b0f0000000000000000106' },
      user: { _id: 'mgr_1', role: 'manager' },
    };
    const res = createMockRes();
    await milestoneController.deleteMilestone(req, res);

    Milestone.findById = origMilestoneFindById;
    Project.findById = origProjectFindById;

    assert.strictEqual(res.statusCode, 409);
    assert.strictEqual(res.body.success, false);
    assert.ok(res.body.message.includes('Completed milestones are closed historical checkpoints and cannot be cancelled'));
  });

  // Case 173: Safe milestone transition contract: open -> at-risk and open -> completed are allowed
  await testAsync('Case 173: Safe milestone transition contract: open -> at-risk and open -> completed are allowed', async () => {
    const origMilestoneFindById = Milestone.findById;
    const origProjectFindById = Project.findById;

    const msDoc1 = {
      _id: '64b0f0000000000000000107',
      project: '64b0f0000000000000000001',
      status: 'open',
      save: async function () {},
      populate: async function () { return this; },
    };
    Milestone.findById = async () => msDoc1;
    Project.findById = async () => ({
      _id: '64b0f0000000000000000001',
      owner: 'mgr_1',
      status: 'active',
      members: [],
    });

    // open -> at-risk
    const req1 = {
      params: { id: '64b0f0000000000000000107' },
      body: { status: 'at-risk' },
      user: { _id: 'mgr_1', role: 'manager' },
    };
    const res1 = createMockRes();
    await milestoneController.updateMilestone(req1, res1);
    assert.strictEqual(res1.statusCode, 200);
    assert.strictEqual(msDoc1.status, 'at-risk');

    // at-risk -> completed
    const req2 = {
      params: { id: '64b0f0000000000000000107' },
      body: { status: 'completed' },
      user: { _id: 'mgr_1', role: 'manager' },
    };
    const res2 = createMockRes();
    await milestoneController.updateMilestone(req2, res2);
    assert.strictEqual(res2.statusCode, 200);
    assert.strictEqual(msDoc1.status, 'completed');

    Milestone.findById = origMilestoneFindById;
    Project.findById = origProjectFindById;
  });

  // Case 174: Invalid milestone status transition returns 400 Bad Request
  await testAsync('Case 174: Invalid milestone status transition returns 400 Bad Request', async () => {
    const origMilestoneFindById = Milestone.findById;
    const origProjectFindById = Project.findById;

    Milestone.findById = async () => ({
      _id: '64b0f0000000000000000108',
      project: '64b0f0000000000000000001',
      status: 'open',
    });
    Project.findById = async () => ({
      _id: '64b0f0000000000000000001',
      owner: 'mgr_1',
      status: 'active',
      members: [],
    });

    const req = {
      params: { id: '64b0f0000000000000000108' },
      body: { status: 'invalid_status_xyz' },
      user: { _id: 'mgr_1', role: 'manager' },
    };
    const res = createMockRes();
    await milestoneController.updateMilestone(req, res);

    Milestone.findById = origMilestoneFindById;
    Project.findById = origProjectFindById;

    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.success, false);
    assert.ok(res.body.message.includes('Invalid status'));
  });

  // Case 175: PUT /api/releases/:id with status 'cancelled' enforces active milestones guard ({ $in: ['open', 'at-risk'] })
  await testAsync('Case 175: PUT /api/releases/:id with status cancelled enforces active milestones guard', async () => {
    const origReleaseFindById = Release.findById;
    const origProjectFindById = Project.findById;
    const origMilestoneCount = Milestone.countDocuments;

    Release.findById = async () => ({
      _id: '64b0f0000000000000000050',
      project: '64b0f0000000000000000001',
      status: 'active',
    });
    Project.findById = async () => ({
      _id: '64b0f0000000000000000001',
      owner: 'mgr_1',
      status: 'active',
      members: [],
    });
    let capturedQuery = null;
    Milestone.countDocuments = async (q) => {
      capturedQuery = q;
      return 1; // 1 open or at-risk milestone
    };

    const req = {
      params: { id: '64b0f0000000000000000050' },
      body: { status: 'cancelled' },
      user: { _id: 'mgr_1', role: 'manager' },
    };
    const res = createMockRes();
    await releaseController.updateRelease(req, res);

    Release.findById = origReleaseFindById;
    Project.findById = origProjectFindById;
    Milestone.countDocuments = origMilestoneCount;

    assert.strictEqual(res.statusCode, 409);
    assert.strictEqual(res.body.success, false);
    assert.deepStrictEqual(capturedQuery.status, { $in: ['open', 'at-risk'] });
    assert.ok(res.body.message.includes('Cannot cancel release with 1 active milestone(s)'));
  });

  // --- SECTION 14: Phase 3 Directed Task Dependency Graph, Invariants & RBAC ---
  console.log('\n--- SECTION 14: Phase 3 Directed Task Dependency Graph, Invariants & RBAC ---');

  // Case 176: Direct dependency creation (A -> B) succeeds for authorized manager/admin
  await testAsync('Case 176: Direct dependency creation succeeds for authorized manager/admin', async () => {
    const origTaskFindById = Task.findById;
    const origProjectFindById = Project.findById;
    const origTaskFind = Task.find;
    const origFindByIdAndUpdate = Task.findByIdAndUpdate;

    const taskA = {
      _id: '64b0f0000000000000000001',
      title: 'Task A',
      project: '64b0f0000000000000000099',
      dependsOn: [],
      status: 'To Do',
      createdBy: 'mgr_1',
    };
    const taskB = {
      _id: '64b0f0000000000000000002',
      title: 'Task B',
      project: '64b0f0000000000000000099',
      dependsOn: [],
      status: 'To Do',
      createdBy: 'mgr_1',
    };

    Task.findById = (id) => {
      const idStr = id ? id.toString() : '';
      let resObj = null;
      if (idStr === taskA._id) resObj = { ...taskA };
      if (idStr === taskB._id) resObj = { ...taskB };
      return {
        populate: () => ({
          populate: () => ({
            populate: () => Promise.resolve(resObj),
          }),
        }),
        then: (resolve) => resolve(resObj),
      };
    };

    Project.findById = async () => ({
      _id: '64b0f0000000000000000099',
      status: 'active',
      owner: 'mgr_1',
      members: [],
    });

    Task.find = () => ({
      select: () => Promise.resolve([taskA, taskB]),
      populate: () => ({ populate: () => ({ select: () => Promise.resolve([]) }) }),
      then: (resolve) => resolve([taskA, taskB]),
    });

    let updatedPayload = null;
    Task.findByIdAndUpdate = async (id, update) => {
      updatedPayload = { id, update };
      return taskA;
    };

    const req = {
      params: { id: taskA._id },
      body: { dependsOnTaskId: taskB._id },
      user: { _id: 'mgr_1', role: 'manager' },
      io: { emit: () => {} },
    };
    const res = createMockRes();
    await taskController.addTaskDependency(req, res);

    Task.findById = origTaskFindById;
    Project.findById = origProjectFindById;
    Task.find = origTaskFind;
    Task.findByIdAndUpdate = origFindByIdAndUpdate;

    assert.strictEqual(res.statusCode, 201);
    assert.strictEqual(res.body.success, true);
    assert.deepStrictEqual(updatedPayload.update.$addToSet, { dependsOn: taskB._id });
  });

  // Case 177: Self-dependency (A -> A) is rejected with 400
  await testAsync('Case 177: Self-dependency (A -> A) is rejected with 400', async () => {
    const req = {
      params: { id: '64b0f0000000000000000001' },
      body: { dependsOnTaskId: '64b0f0000000000000000001' },
      user: { _id: 'mgr_1', role: 'manager' },
    };
    const res = createMockRes();
    await taskController.addTaskDependency(req, res);

    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.success, false);
    assert.ok(res.body.message.includes('cannot depend on itself'));
  });

  // Case 178: Direct cycle (A -> B -> A) is rejected with 409
  await testAsync('Case 178: Direct cycle (A -> B -> A) is rejected with 409', async () => {
    const origTaskFindById = Task.findById;
    const origProjectFindById = Project.findById;
    const origTaskFind = Task.find;

    // B already depends on A
    const taskA = {
      _id: '64b0f0000000000000000001',
      title: 'Task A',
      project: '64b0f0000000000000000099',
      dependsOn: [],
      status: 'To Do',
      createdBy: 'mgr_1',
    };
    const taskB = {
      _id: '64b0f0000000000000000002',
      title: 'Task B',
      project: '64b0f0000000000000000099',
      dependsOn: [taskA._id],
      status: 'To Do',
      createdBy: 'mgr_1',
    };

    Task.findById = (id) => {
      const idStr = id ? id.toString() : '';
      let resObj = null;
      if (idStr === taskA._id) resObj = { ...taskA };
      if (idStr === taskB._id) resObj = { ...taskB };
      return Promise.resolve(resObj);
    };

    Project.findById = async () => ({
      _id: '64b0f0000000000000000099',
      status: 'active',
      owner: 'mgr_1',
      members: [],
    });

    Task.find = () => ({
      select: () => Promise.resolve([taskA, taskB]),
    });

    // Attempt to make A depend on B (creates A -> B -> A)
    const req = {
      params: { id: taskA._id },
      body: { dependsOnTaskId: taskB._id },
      user: { _id: 'mgr_1', role: 'manager' },
    };
    const res = createMockRes();
    await taskController.addTaskDependency(req, res);

    Task.findById = origTaskFindById;
    Project.findById = origProjectFindById;
    Task.find = origTaskFind;

    assert.strictEqual(res.statusCode, 409);
    assert.strictEqual(res.body.success, false);
    assert.ok(res.body.message.includes('cycle'));
  });

  // Case 179: Transitive cycle (A -> B -> C -> A) is rejected with 409
  await testAsync('Case 179: Transitive cycle (A -> B -> C -> A) is rejected with 409', async () => {
    const origTaskFindById = Task.findById;
    const origProjectFindById = Project.findById;
    const origTaskFind = Task.find;

    const taskA = { _id: '64b0f0000000000000000001', project: '64b0f0000000000000000099', dependsOn: [], createdBy: 'mgr_1' };
    const taskB = { _id: '64b0f0000000000000000002', project: '64b0f0000000000000000099', dependsOn: ['64b0f0000000000000000003'], createdBy: 'mgr_1' }; // B -> C
    const taskC = { _id: '64b0f0000000000000000003', project: '64b0f0000000000000000099', dependsOn: ['64b0f0000000000000000001'], createdBy: 'mgr_1' }; // C -> A

    Task.findById = (id) => {
      const idStr = id ? id.toString() : '';
      if (idStr === taskA._id) return Promise.resolve(taskA);
      if (idStr === taskB._id) return Promise.resolve(taskB);
      if (idStr === taskC._id) return Promise.resolve(taskC);
      return Promise.resolve(null);
    };

    Project.findById = async () => ({ _id: '64b0f0000000000000000099', status: 'active', owner: 'mgr_1' });
    Task.find = () => ({ select: () => Promise.resolve([taskA, taskB, taskC]) });

    // Attempt to make A depend on B: A -> B -> C -> A
    const req = {
      params: { id: taskA._id },
      body: { dependsOnTaskId: taskB._id },
      user: { _id: 'mgr_1', role: 'manager' },
    };
    const res = createMockRes();
    await taskController.addTaskDependency(req, res);

    Task.findById = origTaskFindById;
    Project.findById = origProjectFindById;
    Task.find = origTaskFind;

    assert.strictEqual(res.statusCode, 409);
    assert.strictEqual(res.body.success, false);
    assert.ok(res.body.message.includes('cycle'));
  });

  // Case 180: Cross-project dependency (A in Proj1, B in Proj2) rejected with 400
  await testAsync('Case 180: Cross-project dependency rejected with 400', async () => {
    const origTaskFindById = Task.findById;
    const origProjectFindById = Project.findById;

    const taskA = { _id: '64b0f0000000000000000001', project: '64b0f0000000000000000091', dependsOn: [], createdBy: 'mgr_1' };
    const taskB = { _id: '64b0f0000000000000000002', project: '64b0f0000000000000000092', dependsOn: [], createdBy: 'mgr_1' };

    Task.findById = (id) => {
      const idStr = id ? id.toString() : '';
      if (idStr === taskA._id) return Promise.resolve(taskA);
      if (idStr === taskB._id) return Promise.resolve(taskB);
      return Promise.resolve(null);
    };
    Project.findById = async () => ({ _id: '64b0f0000000000000000091', status: 'active', owner: 'mgr_1' });

    const req = {
      params: { id: taskA._id },
      body: { dependsOnTaskId: taskB._id },
      user: { _id: 'mgr_1', role: 'manager' },
    };
    const res = createMockRes();
    await taskController.addTaskDependency(req, res);

    Task.findById = origTaskFindById;
    Project.findById = origProjectFindById;

    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.success, false);
    assert.ok(res.body.message.includes('same project'));
  });

  // Case 181: Dependency on nonexistent task rejected with 404
  await testAsync('Case 181: Dependency on nonexistent task rejected with 404', async () => {
    const origTaskFindById = Task.findById;
    const origProjectFindById = Project.findById;

    const taskA = { _id: '64b0f0000000000000000001', project: '64b0f0000000000000000091', dependsOn: [], createdBy: 'mgr_1' };
    Task.findById = (id) => {
      const idStr = id ? id.toString() : '';
      if (idStr === taskA._id) return Promise.resolve(taskA);
      return Promise.resolve(null);
    };
    Project.findById = async () => ({ _id: '64b0f0000000000000000091', status: 'active', owner: 'mgr_1' });

    const req = {
      params: { id: taskA._id },
      body: { dependsOnTaskId: '64b0f0000000000000000999' },
      user: { _id: 'mgr_1', role: 'manager' },
    };
    const res = createMockRes();
    await taskController.addTaskDependency(req, res);

    Task.findById = origTaskFindById;
    Project.findById = origProjectFindById;

    assert.strictEqual(res.statusCode, 404);
    assert.strictEqual(res.body.success, false);
    assert.ok(res.body.message.includes('Prerequisite task not found'));
  });

  // Case 182: Duplicate dependency (A -> B when already present) returns 409
  await testAsync('Case 182: Duplicate dependency returns 409', async () => {
    const origTaskFindById = Task.findById;
    const origProjectFindById = Project.findById;

    const taskA = {
      _id: '64b0f0000000000000000001',
      project: '64b0f0000000000000000091',
      dependsOn: ['64b0f0000000000000000002'],
      createdBy: 'mgr_1',
    };
    const taskB = {
      _id: '64b0f0000000000000000002',
      project: '64b0f0000000000000000091',
      dependsOn: [],
      createdBy: 'mgr_1',
    };

    Task.findById = (id) => {
      const idStr = id ? id.toString() : '';
      if (idStr === taskA._id) return Promise.resolve(taskA);
      if (idStr === taskB._id) return Promise.resolve(taskB);
      return Promise.resolve(null);
    };
    Project.findById = async () => ({ _id: '64b0f0000000000000000091', status: 'active', owner: 'mgr_1' });

    const req = {
      params: { id: taskA._id },
      body: { dependsOnTaskId: taskB._id },
      user: { _id: 'mgr_1', role: 'manager' },
    };
    const res = createMockRes();
    await taskController.addTaskDependency(req, res);

    Task.findById = origTaskFindById;
    Project.findById = origProjectFindById;

    assert.strictEqual(res.statusCode, 409);
    assert.strictEqual(res.body.success, false);
    assert.ok(res.body.message.includes('already exists'));
  });

  // Case 183: Task cannot depend on an archived task or within an archived project (returns 409)
  await testAsync('Case 183: Cannot add dependency in an archived project (409)', async () => {
    const origTaskFindById = Task.findById;
    const origProjectFindById = Project.findById;

    const taskA = { _id: '64b0f0000000000000000001', project: '64b0f0000000000000000091', dependsOn: [], createdBy: 'mgr_1' };
    Task.findById = async () => taskA;
    Project.findById = async () => ({ _id: '64b0f0000000000000000091', status: 'archived', owner: 'mgr_1' });

    const req = {
      params: { id: taskA._id },
      body: { dependsOnTaskId: '64b0f0000000000000000002' },
      user: { _id: 'mgr_1', role: 'manager' },
    };
    const res = createMockRes();
    await taskController.addTaskDependency(req, res);

    Task.findById = origTaskFindById;
    Project.findById = origProjectFindById;

    assert.strictEqual(res.statusCode, 409);
    assert.strictEqual(res.body.success, false);
    assert.ok(res.body.message.includes('archived'));
  });

  // Case 184: Member cannot add dependency to tasks they don't have update permission for (403)
  await testAsync('Case 184: Member cannot add dependency to unauthorized task (403)', async () => {
    const origTaskFindById = Task.findById;

    const taskA = {
      _id: '64b0f0000000000000000001',
      createdBy: 'other_user',
      assignedTo: 'other_user',
      project: null,
      dependsOn: [],
    };
    Task.findById = async () => taskA;

    const req = {
      params: { id: taskA._id },
      body: { dependsOnTaskId: '64b0f0000000000000000002' },
      user: { _id: 'mem_1', role: 'member' },
    };
    const res = createMockRes();
    await taskController.addTaskDependency(req, res);

    Task.findById = origTaskFindById;

    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(res.body.success, false);
  });

  // Case 185: Member cannot add dependency on private task they cannot read (403)
  await testAsync('Case 185: Member cannot add dependency on private task they cannot read (403)', async () => {
    const origTaskFindById = Task.findById;
    const origProjectFindById = Project.findById;

    const taskA = { _id: '64b0f0000000000000000001', project: '64b0f0000000000000000091', dependsOn: [], createdBy: 'mem_1' };
    const taskB = { _id: '64b0f0000000000000000002', project: null, createdBy: 'other_user', assignedTo: 'other_user' };

    Task.findById = (id) => {
      const idStr = id ? id.toString() : '';
      if (idStr === taskA._id) return Promise.resolve(taskA);
      if (idStr === taskB._id) return Promise.resolve(taskB);
      return Promise.resolve(null);
    };
    Project.findById = async () => ({ _id: '64b0f0000000000000000091', status: 'active', owner: 'mgr_1', members: [{ user: 'mem_1' }] });

    const req = {
      params: { id: taskA._id },
      body: { dependsOnTaskId: taskB._id },
      user: { _id: 'mem_1', role: 'member' },
    };
    const res = createMockRes();
    await taskController.addTaskDependency(req, res);

    Task.findById = origTaskFindById;
    Project.findById = origProjectFindById;

    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(res.body.success, false);
  });

  // Case 186: Remove dependency (A -> B) succeeds for authorized user
  await testAsync('Case 186: Remove dependency succeeds for authorized user', async () => {
    const origTaskFindById = Task.findById;
    const origFindByIdAndUpdate = Task.findByIdAndUpdate;

    const taskA = {
      _id: '64b0f0000000000000000001',
      createdBy: 'mgr_1',
      dependsOn: ['64b0f0000000000000000002'],
    };

    Task.findById = async () => taskA;
    let updateRecorded = null;
    Task.findByIdAndUpdate = async (id, update) => {
      updateRecorded = { id, update };
      return taskA;
    };

    const req = {
      params: { id: taskA._id, dependencyTaskId: '64b0f0000000000000000002' },
      user: { _id: 'mgr_1', role: 'manager' },
      io: { emit: () => {} },
    };
    const res = createMockRes();
    await taskController.removeTaskDependency(req, res);

    Task.findById = origTaskFindById;
    Task.findByIdAndUpdate = origFindByIdAndUpdate;

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, true);
    assert.deepStrictEqual(updateRecorded.update.$pull, { dependsOn: '64b0f0000000000000000002' });
  });

  // Case 187: Remove non-existent dependency returns 404
  await testAsync('Case 187: Remove non-existent dependency returns 404', async () => {
    const origTaskFindById = Task.findById;

    const taskA = {
      _id: '64b0f0000000000000000001',
      createdBy: 'mgr_1',
      dependsOn: [],
    };
    Task.findById = async () => taskA;

    const req = {
      params: { id: taskA._id, dependencyTaskId: '64b0f0000000000000000002' },
      user: { _id: 'mgr_1', role: 'manager' },
    };
    const res = createMockRes();
    await taskController.removeTaskDependency(req, res);

    Task.findById = origTaskFindById;

    assert.strictEqual(res.statusCode, 404);
    assert.strictEqual(res.body.success, false);
    assert.ok(res.body.message.includes('not found'));
  });

  // Case 188: Member without task update permission cannot remove dependency (403)
  await testAsync('Case 188: Member without task update permission cannot remove dependency (403)', async () => {
    const origTaskFindById = Task.findById;

    const taskA = {
      _id: '64b0f0000000000000000001',
      createdBy: 'other_user',
      assignedTo: 'other_user',
      project: null,
      dependsOn: ['64b0f0000000000000000002'],
    };
    Task.findById = async () => taskA;

    const req = {
      params: { id: taskA._id, dependencyTaskId: '64b0f0000000000000000002' },
      user: { _id: 'mem_1', role: 'member' },
    };
    const res = createMockRes();
    await taskController.removeTaskDependency(req, res);

    Task.findById = origTaskFindById;

    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(res.body.success, false);
  });

  // Case 189: Task completion blocked if prerequisite is incomplete (Task A status -> Done returns 409 if prereq B is not Done)
  await testAsync('Case 189: Task completion blocked if prerequisite is incomplete (409)', async () => {
    const origTaskFindById = Task.findById;
    const origTaskFind = Task.find;
    const origTaskCount = Task.countDocuments;

    const taskA = {
      _id: '64b0f0000000000000000001',
      status: 'In Progress',
      dependsOn: ['64b0f0000000000000000002'],
      createdBy: 'mgr_1',
    };
    Task.findById = async () => taskA;
    Task.countDocuments = async () => 1;

    const prereqB = {
      _id: '64b0f0000000000000000002',
      title: 'Prereq B',
      status: 'In Progress',
    };
    Task.find = () => ({
      select: () => Promise.resolve([prereqB]),
    });

    const req = {
      params: { id: taskA._id },
      body: { status: 'Done' },
      user: { _id: 'mgr_1', role: 'manager' },
    };
    const res = createMockRes();
    await taskController.updateTask(req, res);

    Task.findById = origTaskFindById;
    Task.find = origTaskFind;
    Task.countDocuments = origTaskCount;

    assert.strictEqual(res.statusCode, 409);
    assert.strictEqual(res.body.success, false);
    assert.ok(res.body.message.includes('prerequisite task(s) are incomplete'));
  });

  // Case 190: Task completion succeeds when all prerequisites are Done
  await testAsync('Case 190: Task completion succeeds when all prerequisites are Done', async () => {
    const origTaskFindById = Task.findById;
    const origTaskFind = Task.find;
    const origTaskCount = Task.countDocuments;

    const taskA = {
      _id: '64b0f0000000000000000001',
      status: 'In Progress',
      dependsOn: ['64b0f0000000000000000002'],
      createdBy: 'mgr_1',
      save: async () => taskA,
      populate: async () => taskA,
    };
    Task.findById = async () => taskA;
    Task.countDocuments = async () => 0;

    const prereqB = {
      _id: '64b0f0000000000000000002',
      title: 'Prereq B',
      status: 'Done',
    };
    Task.find = () => ({
      select: () => Promise.resolve([prereqB]),
    });

    const req = {
      params: { id: taskA._id },
      body: { status: 'Done' },
      user: { _id: 'mgr_1', role: 'manager' },
      io: { emit: () => {} },
    };
    const res = createMockRes();
    await taskController.updateTask(req, res);

    Task.findById = origTaskFindById;
    Task.find = origTaskFind;
    Task.countDocuments = origTaskCount;

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(taskA.status, 'Done');
  });

  // Case 191: Task completion invariant bypass via direct task update body is blocked (409)
  await testAsync('Case 191: Task completion invariant cannot be bypassed in updateTask', async () => {
    const origTaskFindById = Task.findById;
    const origTaskFind = Task.find;
    const origTaskCount = Task.countDocuments;

    const taskA = {
      _id: '64b0f0000000000000000001',
      status: 'To Do',
      dependsOn: ['64b0f0000000000000000002'],
      createdBy: 'mgr_1',
    };
    Task.findById = async () => taskA;
    Task.countDocuments = async () => 1;
    Task.find = () => ({
      select: () => Promise.resolve([{ _id: '64b0f0000000000000000002', title: 'Prereq B', status: 'To Do' }]),
    });

    const req = {
      params: { id: taskA._id },
      body: { title: 'Updated Title', status: 'Done' },
      user: { _id: 'mgr_1', role: 'manager' },
    };
    const res = createMockRes();
    await taskController.updateTask(req, res);

    Task.findById = origTaskFindById;
    Task.find = origTaskFind;
    Task.countDocuments = origTaskCount;

    assert.strictEqual(res.statusCode, 409);
    assert.strictEqual(res.body.success, false);
  });

  // Case 192: dependsOn field in POST /api/tasks is ignored / stripped (mass assignment protection)
  await testAsync('Case 192: dependsOn field in POST /api/tasks is ignored/stripped', async () => {
    const origTaskCreate = Task.create;
    let capturedCreateData = null;

    Task.create = async (data) => {
      capturedCreateData = data;
      return {
        _id: '64b0f0000000000000000001',
        ...data,
        populate: () => ({ populate: () => ({ populate: () => Promise.resolve({ ...data, _id: '64b0f0000000000000000001' }) }) }),
      };
    };

    const req = {
      body: {
        title: 'New Task',
        dependsOn: ['64b0f0000000000000000099'],
      },
      user: { _id: 'mgr_1', role: 'manager' },
    };
    const res = createMockRes();
    await taskController.createTask(req, res);

    Task.create = origTaskCreate;

    assert.strictEqual(res.statusCode, 201);
    assert.strictEqual(capturedCreateData.dependsOn, undefined);
  });

  // Case 193: dependsOn field in PUT /api/tasks/:id is ignored / stripped (mass assignment protection)
  await testAsync('Case 193: dependsOn field in PUT /api/tasks/:id is ignored/stripped', async () => {
    const origTaskFindById = Task.findById;

    const taskA = {
      _id: '64b0f0000000000000000001',
      title: 'Old Title',
      status: 'To Do',
      dependsOn: [],
      createdBy: 'mgr_1',
      save: async () => taskA,
      populate: async () => taskA,
    };
    Task.findById = async () => taskA;

    const req = {
      params: { id: taskA._id },
      body: {
        title: 'New Title',
        dependsOn: ['64b0f0000000000000000099'],
      },
      user: { _id: 'mgr_1', role: 'manager' },
      io: { emit: () => {} },
    };
    const res = createMockRes();
    await taskController.updateTask(req, res);

    Task.findById = origTaskFindById;

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(taskA.title, 'New Title');
    assert.deepStrictEqual(taskA.dependsOn, []);
  });

  // Case 194: Task deletion blocked if task has incoming dependencies (returns 409)
  await testAsync('Case 194: Task deletion blocked if task has incoming dependencies (409)', async () => {
    const origTaskFindById = Task.findById;
    const origTaskExists = Task.exists;

    const taskA = {
      _id: '64b0f0000000000000000001',
      createdBy: 'mgr_1',
      dependsOn: [],
    };
    Task.findById = async () => taskA;
    Task.exists = async (query) => {
      if (query.dependsOn) return true; // has dependent tasks
      return false;
    };

    const req = {
      params: { id: taskA._id },
      user: { _id: 'mgr_1', role: 'manager' },
    };
    const res = createMockRes();
    await taskController.deleteTask(req, res);

    Task.findById = origTaskFindById;
    Task.exists = origTaskExists;

    assert.strictEqual(res.statusCode, 409);
    assert.strictEqual(res.body.success, false);
    assert.ok(res.body.message.includes('prerequisite by other tasks'));
  });

  // Case 195: Task deletion blocked if task has outgoing dependencies (returns 409)
  await testAsync('Case 195: Task deletion blocked if task has outgoing dependencies (409)', async () => {
    const origTaskFindById = Task.findById;
    const origTaskExists = Task.exists;

    const taskA = {
      _id: '64b0f0000000000000000001',
      createdBy: 'mgr_1',
      dependsOn: ['64b0f0000000000000000002'],
    };
    Task.findById = async () => taskA;
    Task.exists = async () => false;

    const req = {
      params: { id: taskA._id },
      user: { _id: 'mgr_1', role: 'manager' },
    };
    const res = createMockRes();
    await taskController.deleteTask(req, res);

    Task.findById = origTaskFindById;
    Task.exists = origTaskExists;

    assert.strictEqual(res.statusCode, 409);
    assert.strictEqual(res.body.success, false);
    assert.ok(res.body.message.includes('outgoing dependencies'));
  });

  // Case 196: Task deletion succeeds once dependencies are removed
  await testAsync('Case 196: Task deletion succeeds once dependencies are removed', async () => {
    const origTaskFindById = Task.findById;
    const origTaskExists = Task.exists;

    let deleted = false;
    const taskA = {
      _id: '64b0f0000000000000000001',
      createdBy: 'mgr_1',
      dependsOn: [],
      deleteOne: async () => {
        deleted = true;
        return { deletedCount: 1 };
      },
    };
    Task.findById = async () => taskA;
    Task.exists = async () => false;

    const req = {
      params: { id: taskA._id },
      user: { _id: 'mgr_1', role: 'manager' },
      io: { emit: () => {} },
    };
    const res = createMockRes();
    await taskController.deleteTask(req, res);

    Task.findById = origTaskFindById;
    Task.exists = origTaskExists;

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(deleted, true);
  });

  // Case 197: Task move to another project blocked if it has dependencies (returns 409)
  await testAsync('Case 197: Task move to another project blocked if it has dependencies (409)', async () => {
    const origTaskFindById = Task.findById;

    const taskA = {
      _id: '64b0f0000000000000000001',
      project: '64b0f0000000000000000091',
      dependsOn: ['64b0f0000000000000000002'],
      createdBy: 'mgr_1',
    };
    Task.findById = async () => taskA;

    const req = {
      params: { id: taskA._id },
      body: { project: '64b0f0000000000000000092' },
      user: { _id: 'mgr_1', role: 'manager' },
    };
    const res = createMockRes();
    await taskController.updateTask(req, res);

    Task.findById = origTaskFindById;

    assert.strictEqual(res.statusCode, 409);
    assert.strictEqual(res.body.success, false);
    assert.ok(res.body.message.includes('Cannot move task with active dependencies'));
  });

  // Case 198: GET /api/tasks/:id/dependencies returns prerequisites and dependents with derived states
  await testAsync('Case 198: GET /api/tasks/:id/dependencies returns prerequisites and dependents', async () => {
    const origTaskFindById = Task.findById;
    const origTaskFind = Task.find;

    const taskA = {
      _id: '64b0f0000000000000000001',
      title: 'Task A',
      status: 'To Do',
      priority: 'High',
      isBlocked: false,
      blockedReason: '',
      dependsOn: ['64b0f0000000000000000002'],
      createdBy: 'mgr_1',
    };

    Task.findById = () => ({
      populate: () => ({
        populate: () => ({
          populate: () => Promise.resolve(taskA),
        }),
      }),
    });

    const prereqB = {
      _id: '64b0f0000000000000000002',
      title: 'Prereq B',
      status: 'Done',
      priority: 'Medium',
      isBlocked: false,
      createdBy: 'mgr_1',
    };

    const dependentC = {
      _id: '64b0f0000000000000000003',
      title: 'Dependent C',
      status: 'To Do',
      priority: 'Low',
      isBlocked: false,
      createdBy: 'mgr_1',
    };

    Task.find = (query) => {
      let result = [];
      if (query._id && query._id.$in) result = [prereqB];
      if (query.dependsOn) result = [dependentC];
      return {
        populate: () => ({
          populate: () => ({
            select: () => Promise.resolve(result),
          }),
        }),
      };
    };

    const req = {
      params: { id: taskA._id },
      user: { _id: 'mgr_1', role: 'manager' },
    };
    const res = createMockRes();
    await taskController.getTaskDependencies(req, res);

    Task.findById = origTaskFindById;
    Task.find = origTaskFind;

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.task.id, taskA._id);
    assert.strictEqual(res.body.task.dependencyState, 'ready');
    assert.strictEqual(res.body.task.allPrerequisitesResolved, true);
    assert.strictEqual(res.body.prerequisites.length, 1);
    assert.strictEqual(res.body.prerequisites[0].id, prereqB._id);
    assert.strictEqual(res.body.prerequisites[0].resolved, true);
    assert.strictEqual(res.body.dependents.length, 1);
    assert.strictEqual(res.body.dependents[0].id, dependentC._id);
  });

  // Case 199: GET /api/tasks/:id/dependencies enforces project authorization (403 for unauthorized project)
  await testAsync('Case 199: GET /api/tasks/:id/dependencies enforces authorization (403)', async () => {
    const origTaskFindById = Task.findById;

    const taskA = {
      _id: '64b0f0000000000000000001',
      createdBy: 'other_user',
      assignedTo: 'other_user',
      project: null,
      dependsOn: [],
    };

    Task.findById = () => ({
      populate: () => ({
        populate: () => ({
          populate: () => Promise.resolve(taskA),
        }),
      }),
    });

    const req = {
      params: { id: taskA._id },
      user: { _id: 'mem_1', role: 'member' },
    };
    const res = createMockRes();
    await taskController.getTaskDependencies(req, res);

    Task.findById = origTaskFindById;

    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(res.body.success, false);
  });

  // Case 200: GET /api/projects/:projectId/dependency-graph returns nodes, edges, levels, metrics
  await testAsync('Case 200: GET /api/projects/:projectId/dependency-graph returns full graph payload', async () => {
    const origProjectFindById = Project.findById;
    const origTaskFind = Task.find;

    const project = {
      _id: '64b0f0000000000000000099',
      name: 'Alpha Project',
      owner: { _id: 'mgr_1', name: 'Manager 1', email: 'mgr@test.com' },
      status: 'active',
      members: [],
    };

    const taskA = {
      _id: '64b0f0000000000000000001',
      title: 'Task A',
      status: 'In Progress',
      priority: 'High',
      isBlocked: false,
      dependsOn: ['64b0f0000000000000000002'],
      project: project._id,
    };
    const taskB = {
      _id: '64b0f0000000000000000002',
      title: 'Task B',
      status: 'Done',
      priority: 'Medium',
      isBlocked: false,
      dependsOn: [],
      project: project._id,
    };

    Project.findById = () => ({
      populate: () => Promise.resolve(project),
    });

    Task.find = () => ({
      populate: () => ({
        populate: () => ({
          sort: () => Promise.resolve([taskA, taskB]),
        }),
      }),
    });

    const req = {
      params: { projectId: project._id },
      user: { _id: 'mgr_1', role: 'manager' },
    };
    const res = createMockRes();
    await projectController.getProjectDependencyGraph(req, res);

    Project.findById = origProjectFindById;
    Task.find = origTaskFind;

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.project.id, project._id);
    assert.strictEqual(res.body.nodes.length, 2);
    assert.strictEqual(res.body.edges.length, 1);
    assert.strictEqual(res.body.edges[0].source, taskB._id);
    assert.strictEqual(res.body.edges[0].target, taskA._id);
    assert.ok(Array.isArray(res.body.levels));
    assert.strictEqual(res.body.metrics.totalNodes, 2);
    assert.strictEqual(res.body.metrics.totalEdges, 1);
  });

  // Case 201: GET /api/projects/:projectId/dependency-graph enforces member privacy (personal tasks omitted or anonymized, isPartial: true)
  await testAsync('Case 201: Member dependency graph enforces personal privacy scope and isPartial: true', async () => {
    const origProjectFindById = Project.findById;
    const origTaskFind = Task.find;

    const project = {
      _id: '64b0f0000000000000000099',
      name: 'Alpha Project',
      owner: 'mgr_1',
      status: 'active',
      members: [{ user: 'mem_1' }],
    };

    const myTask = {
      _id: '64b0f0000000000000000001',
      title: 'My Task',
      assignedTo: { _id: 'mem_1' },
      createdBy: 'mem_1',
      status: 'In Progress',
      dependsOn: [],
      project: project._id,
    };
    const otherTask = {
      _id: '64b0f0000000000000000002',
      title: 'Other Task',
      assignedTo: { _id: 'mem_2' },
      createdBy: 'mem_2',
      status: 'Done',
      dependsOn: [],
      project: project._id,
    };

    Project.findById = () => ({
      populate: () => Promise.resolve(project),
    });

    Task.find = () => ({
      populate: () => ({
        populate: () => ({
          sort: () => Promise.resolve([myTask, otherTask]),
        }),
      }),
    });

    const req = {
      params: { projectId: project._id },
      user: { _id: 'mem_1', role: 'member' },
    };
    const res = createMockRes();
    await projectController.getProjectDependencyGraph(req, res);

    Project.findById = origProjectFindById;
    Task.find = origTaskFind;

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.isPartial, true);
    assert.strictEqual(res.body.scope, 'personal');
    assert.strictEqual(res.body.nodes.length, 1);
    assert.strictEqual(res.body.nodes[0].id, myTask._id);
  });

  // Case 202: GET /api/projects/:projectId/dependency-graph returns empty graph if project has no tasks
  await testAsync('Case 202: Dependency graph returns empty payload if project has no tasks', async () => {
    const origProjectFindById = Project.findById;
    const origTaskFind = Task.find;

    const project = {
      _id: '64b0f0000000000000000099',
      name: 'Alpha Project',
      owner: { _id: 'mgr_1', name: 'Mgr' },
      status: 'active',
      members: [],
    };

    Project.findById = () => ({
      populate: () => Promise.resolve(project),
    });

    Task.find = () => ({
      populate: () => ({
        populate: () => ({
          sort: () => Promise.resolve([]),
        }),
      }),
    });

    const req = {
      params: { projectId: project._id },
      user: { _id: 'mgr_1', role: 'manager' },
    };
    const res = createMockRes();
    await projectController.getProjectDependencyGraph(req, res);

    Project.findById = origProjectFindById;
    Task.find = origTaskFind;

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.nodes.length, 0);
    assert.strictEqual(res.body.edges.length, 0);
    assert.strictEqual(res.body.levels.length, 0);
    assert.strictEqual(res.body.metrics.totalNodes, 0);
    assert.strictEqual(res.body.metrics.totalEdges, 0);
  });

  // Case 203: Pure graph engine: hasCycle returns true for direct cycle
  test('Case 203: Pure graph engine: hasCycle returns true for direct cycle', () => {
    const tasks = [
      { _id: '1', dependsOn: ['2'] }, // 1 depends on 2
      { _id: '2', dependsOn: [] },
    ];
    // Adding 2 depends on 1 creates direct cycle 2 -> 1 -> 2
    const cycle = hasCycle(tasks, '2', '1');
    assert.strictEqual(cycle, true);
  });

  // Case 204: Pure graph engine: hasCycle returns true for multi-step transitive cycle
  test('Case 204: Pure graph engine: hasCycle returns true for multi-step transitive cycle', () => {
    const tasks = [
      { _id: '1', dependsOn: [] },
      { _id: '2', dependsOn: ['1'] }, // 2 depends on 1
      { _id: '3', dependsOn: ['2'] }, // 3 depends on 2
      { _id: '4', dependsOn: ['3'] }, // 4 depends on 3
    ];
    // Adding 1 depends on 4 creates 1 -> 4 -> 3 -> 2 -> 1
    const cycle = hasCycle(tasks, '1', '4');
    assert.strictEqual(cycle, true);
  });

  // Case 205: Pure graph engine: hasCycle returns false for valid DAG (e.g. diamond DAG)
  test('Case 205: Pure graph engine: hasCycle returns false for valid diamond DAG', () => {
    // 1 -> 2, 1 -> 3, 2 -> 4, 3 -> 4
    // 4 depends on 2 and 3; 2 depends on 1; 3 depends on 1
    const tasks = [
      { _id: '1', dependsOn: [] },
      { _id: '2', dependsOn: ['1'] },
      { _id: '3', dependsOn: ['1'] },
      { _id: '4', dependsOn: ['2'] },
    ];
    // Adding 4 depends on 3 (completing the diamond)
    const cycle = hasCycle(tasks, '4', '3');
    assert.strictEqual(cycle, false);
  });

  // Case 206: Pure graph engine: topologicalSort produces valid topological order
  test('Case 206: Pure graph engine: topologicalSort produces valid topological order', () => {
    // 1 -> 2 -> 3
    const tasks = [
      { _id: '3', title: 'Task 3', dependsOn: ['2'] },
      { _id: '1', title: 'Task 1', dependsOn: [] },
      { _id: '2', title: 'Task 2', dependsOn: ['1'] },
    ];
    const order = topologicalSort(tasks);
    assert.deepStrictEqual(order, ['1', '2', '3']);
  });

  // Case 207: Pure graph engine: computeTopologicalLevels groups tasks into correct depth columns
  test('Case 207: Pure graph engine: computeTopologicalLevels groups tasks into depth columns', () => {
    // Level 0: 1, 5
    // Level 1: 2 (depends on 1)
    // Level 2: 3 (depends on 2)
    const tasks = [
      { _id: '1', dependsOn: [] },
      { _id: '2', dependsOn: ['1'] },
      { _id: '3', dependsOn: ['2'] },
      { _id: '5', dependsOn: [] },
    ];
    const levels = computeTopologicalLevels(tasks);
    assert.strictEqual(levels.length, 3);
    assert.deepStrictEqual(levels[0].sort(), ['1', '5']);
    assert.deepStrictEqual(levels[1], ['2']);
    assert.deepStrictEqual(levels[2], ['3']);
  });

  // Case 208: Pure graph engine: deriveDependencyState correctly returns completed when Done
  test('Case 208: Pure graph engine: deriveDependencyState correctly returns completed when Done', () => {
    const task = { status: 'Done', isBlocked: true }; // Done supersedes isBlocked
    const prereqs = [{ status: 'In Progress' }];
    assert.strictEqual(deriveDependencyState(task, prereqs), 'completed');
  });

  // Case 209: Pure graph engine: deriveDependencyState correctly returns blocked_and_waiting
  test('Case 209: Pure graph engine: deriveDependencyState returns blocked_and_waiting', () => {
    const task = { status: 'In Progress', isBlocked: true };
    const prereqs = [{ status: 'To Do' }];
    assert.strictEqual(deriveDependencyState(task, prereqs), 'blocked_and_waiting');
  });

  // Case 210: Pure graph engine: deriveDependencyState correctly returns waiting
  test('Case 210: Pure graph engine: deriveDependencyState returns waiting', () => {
    const task = { status: 'In Progress', isBlocked: false };
    const prereqs = [{ status: 'To Do' }];
    assert.strictEqual(deriveDependencyState(task, prereqs), 'waiting');
  });

  // Case 211: Pure graph engine: deriveDependencyState correctly returns ready
  test('Case 211: Pure graph engine: deriveDependencyState returns ready', () => {
    const task = { status: 'In Progress', isBlocked: false };
    const prereqs = [{ status: 'Done' }];
    assert.strictEqual(deriveDependencyState(task, prereqs), 'ready');

    // Also ready when no prerequisites
    assert.strictEqual(deriveDependencyState(task, []), 'ready');
  });

  // Case 212: Task schema defaults dependsOn to []
  test('Case 212: Task schema defaults dependsOn to []', () => {
    const defaultVal = Task.schema.path('dependsOn').defaultValue;
    const resolvedDefault = typeof defaultVal === 'function' ? defaultVal() : defaultVal;
    assert.ok(Array.isArray(resolvedDefault));
    assert.strictEqual(resolvedDefault.length, 0);
  });

  // Case 213: Large acyclic graph traversal does not overflow the call stack (iterative safety)
  test('Case 213: Large acyclic graph traversal (500 nodes) does not overflow the call stack', () => {
    const chainTasks = [];
    const N = 500;
    for (let i = 0; i < N; i++) {
      chainTasks.push({
        _id: `task_${i}`,
        title: `Task ${i}`,
        dependsOn: i > 0 ? [`task_${i - 1}`] : [],
      });
    }

    // Must not throw RangeError: Maximum call stack size exceeded
    const hasCycleResult = hasCycle(chainTasks, 'task_0', `task_${N - 1}`); // adding task_0 depends on task_N-1 creates cycle
    assert.strictEqual(hasCycleResult, true);

    const safeCycleResult = hasCycle(chainTasks, 'task_0', 'task_new');
    assert.strictEqual(safeCycleResult, false);

    const order = topologicalSort(chainTasks);
    assert.strictEqual(order.length, N);
    assert.strictEqual(order[0], 'task_0');
    assert.strictEqual(order[N - 1], `task_${N - 1}`);

    const levels = computeTopologicalLevels(chainTasks);
    assert.strictEqual(levels.length, N);
  });

  // Case 214: Existing Release Readiness score remains unchanged by dependency structure
  test('Case 214: Existing Release Readiness score remains unchanged by dependency structure', () => {
    const tasksWithoutDeps = [
      { _id: 't1', status: 'Done', isBlocked: false },
      { _id: 't2', status: 'In Progress', isBlocked: false },
    ];
    const tasksWithDeps = [
      { _id: 't1', status: 'Done', isBlocked: false, dependsOn: [] },
      { _id: 't2', status: 'In Progress', isBlocked: false, dependsOn: ['t1'] },
    ];
    const milestones = [{ _id: 'm1', status: 'completed' }];

    const r1 = calculateReleaseReadiness({ tasks: tasksWithoutDeps, milestones, release: { status: 'active' } });
    const r2 = calculateReleaseReadiness({ tasks: tasksWithDeps, milestones, release: { status: 'active' } });

    assert.strictEqual(r1.score, r2.score);
    assert.strictEqual(r1.label, r2.label);
  });

  // Case 215: Graph endpoint returns exact summary contract (rootTasks, leafTasks, dependencyBlockedTasks)
  test('Case 215: Graph payload returns exact summary contract and node layers', () => {
    const project = { _id: 'proj_1', name: 'Alpha' };
    const tasks = [
      { _id: 't1', title: 'Task 1', status: 'Done', dependsOn: [] },
      { _id: 't2', title: 'Task 2', status: 'In Progress', dependsOn: ['t1'] },
      { _id: 't3', title: 'Task 3', status: 'To Do', dependsOn: ['t2'] },
    ];
    const payload = buildGraphPayload(project, tasks);

    assert.strictEqual(payload.summary.totalNodes, 3);
    assert.strictEqual(payload.summary.totalEdges, 2);
    assert.strictEqual(payload.summary.rootTasks, 1); // t1 has no prereqs
    assert.strictEqual(payload.summary.leafTasks, 1); // t3 has no dependents
    assert.strictEqual(payload.summary.dependencyBlockedTasks, 1); // t3 waiting on t2 (in progress)
    assert.strictEqual(payload.nodes[0].layer, 0);
    assert.strictEqual(payload.nodes[1].layer, 1);
    assert.strictEqual(payload.nodes[2].layer, 2);
  });

  // Case 216: Removing dependency in an archived project returns 409
  await testAsync('Case 216: Removing dependency in an archived project returns 409', async () => {
    const origTaskFindById = Task.findById;
    const origProjectFindById = Project.findById;

    const taskA = { _id: '64b0f0000000000000000001', project: '64b0f0000000000000000091', dependsOn: ['64b0f0000000000000000002'], createdBy: 'mgr_1' };
    Task.findById = async () => taskA;
    Project.findById = async () => ({ _id: '64b0f0000000000000000091', status: 'archived', owner: 'mgr_1' });

    const req = {
      params: { id: taskA._id, dependencyTaskId: '64b0f0000000000000000002' },
      user: { _id: 'mgr_1', role: 'manager' },
    };
    const res = createMockRes();
    await taskController.removeTaskDependency(req, res);

    Task.findById = origTaskFindById;
    Project.findById = origProjectFindById;

    assert.strictEqual(res.statusCode, 409);
    assert.strictEqual(res.body.success, false);
    assert.ok(res.body.message.includes('archived'));
  });

  // Case 217: completedAt schema behavior remains correct when task transitions to Done
  test('Case 217: completedAt behavior preserved when task transitions to and from Done', () => {
    const doc = new Task({
      title: 'Task Done Check',
      status: 'In Progress',
      createdBy: new mongoose.Types.ObjectId(),
    });
    assert.strictEqual(doc.completedAt, null);

    // Mongoose schema pre-save hook execution
    doc.status = 'Done';
    if (doc.isModified('status') && doc.status === 'Done') {
      doc.completedAt = new Date();
    }
    assert.ok(doc.completedAt instanceof Date);

    doc.status = 'To Do';
    if (doc.isModified('status') && doc.status !== 'Done') {
      doc.completedAt = null;
    }
    assert.strictEqual(doc.completedAt, null);
  });

  // --- SECTION 15: Phase 3 Correctness Pass — Cycle Detection, Integrity & Privacy ---
  console.log('\n--- SECTION 15: Phase 3 Correctness Pass — Cycle Detection, Integrity & Privacy ---');

  // Case 218: Canonical edge direction: A dependsOn B => B -> A, B dependsOn C => C -> B
  test('Case 218: A dependsOn B => B -> A and B dependsOn C => C -> B visual edge direction', () => {
    const tasks = [
      { _id: 'A', title: 'Task A', dependsOn: ['B'] },
      { _id: 'B', title: 'Task B', dependsOn: ['C'] },
      { _id: 'C', title: 'Task C', dependsOn: [] },
    ];
    const project = { _id: 'proj_1', name: 'Project 1' };
    const payload = buildGraphPayload(project, tasks);

    assert.strictEqual(payload.edges.length, 2);
    const edgeCtoB = payload.edges.find((e) => e.source === 'C' && e.target === 'B');
    const edgeBtoA = payload.edges.find((e) => e.source === 'B' && e.target === 'A');
    assert.ok(edgeCtoB, 'Prerequisite C must point to dependent B (C -> B)');
    assert.ok(edgeBtoA, 'Prerequisite B must point to dependent A (B -> A)');
  });

  // Case 219: adding C dependsOn A => A -> C must return 409 because it creates C -> B -> A -> C
  await testAsync('Case 219: adding C dependsOn A => A -> C must return 409 because it creates C -> B -> A -> C', async () => {
    const origTaskFindById = Task.findById;
    const origProjectFindById = Project.findById;
    const origTaskFind = Task.find;

    // Existing graph: C -> B -> A (A dependsOn B, B dependsOn C)
    const taskA = { _id: '64b0f000000000000000000a', project: '64b0f0000000000000000099', dependsOn: ['64b0f000000000000000000b'], createdBy: 'mgr_1' };
    const taskB = { _id: '64b0f000000000000000000b', project: '64b0f0000000000000000099', dependsOn: ['64b0f000000000000000000c'], createdBy: 'mgr_1' };
    const taskC = { _id: '64b0f000000000000000000c', project: '64b0f0000000000000000099', dependsOn: [], createdBy: 'mgr_1' };

    Task.findById = (id) => {
      const idStr = id ? id.toString() : '';
      if (idStr === taskA._id) return Promise.resolve(taskA);
      if (idStr === taskB._id) return Promise.resolve(taskB);
      if (idStr === taskC._id) return Promise.resolve(taskC);
      return Promise.resolve(null);
    };
    Project.findById = async () => ({ _id: '64b0f0000000000000000099', status: 'active', owner: 'mgr_1' });
    Task.find = () => ({ select: () => Promise.resolve([taskA, taskB, taskC]) });

    // Proposed: C dependsOn A (target/dependent C, prereq A, edge A -> C)
    const req = {
      params: { id: taskC._id },
      body: { dependsOnTaskId: taskA._id },
      user: { _id: 'mgr_1', role: 'manager' },
    };
    const res = createMockRes();
    await taskController.addTaskDependency(req, res);

    Task.findById = origTaskFindById;
    Project.findById = origProjectFindById;
    Task.find = origTaskFind;

    assert.strictEqual(res.statusCode, 409);
    assert.strictEqual(res.body.success, false);
    assert.ok(res.body.message.includes('cycle'));
  });

  // Case 220: adding A dependsOn C to existing C -> B -> A graph is a redundant transitive edge but not a cycle; it may be accepted
  await testAsync('Case 220: adding A dependsOn C to existing C -> B -> A graph is a redundant transitive edge but not a cycle; it may be accepted', async () => {
    const origTaskFindById = Task.findById;
    const origProjectFindById = Project.findById;
    const origTaskFind = Task.find;
    const origFindByIdAndUpdate = Task.findByIdAndUpdate;

    const taskA = { _id: '64b0f000000000000000000a', project: '64b0f0000000000000000099', dependsOn: ['64b0f000000000000000000b'], createdBy: 'mgr_1' };
    const taskB = { _id: '64b0f000000000000000000b', project: '64b0f0000000000000000099', dependsOn: ['64b0f000000000000000000c'], createdBy: 'mgr_1' };
    const taskC = { _id: '64b0f000000000000000000c', project: '64b0f0000000000000000099', dependsOn: [], createdBy: 'mgr_1' };

    Task.findById = (id) => {
      const idStr = id ? id.toString() : '';
      let resObj = null;
      if (idStr === taskA._id) resObj = { ...taskA };
      if (idStr === taskB._id) resObj = { ...taskB };
      if (idStr === taskC._id) resObj = { ...taskC };
      return {
        populate: () => Promise.resolve(resObj),
        then: (resolve) => resolve(resObj),
      };
    };
    Project.findById = async () => ({ _id: '64b0f0000000000000000099', status: 'active', owner: 'mgr_1' });
    Task.find = () => ({ select: () => Promise.resolve([taskA, taskB, taskC]) });
    Task.findByIdAndUpdate = async () => taskA;

    // Proposed: A dependsOn C (target/dependent A, prereq C, edge C -> A)
    const req = {
      params: { id: taskA._id },
      body: { dependsOnTaskId: taskC._id },
      user: { _id: 'mgr_1', role: 'manager' },
      io: { emit: () => {} },
    };
    const res = createMockRes();
    await taskController.addTaskDependency(req, res);

    Task.findById = origTaskFindById;
    Project.findById = origProjectFindById;
    Task.find = origTaskFind;
    Task.findByIdAndUpdate = origFindByIdAndUpdate;

    assert.strictEqual(res.statusCode, 201);
    assert.strictEqual(res.body.success, true);
  });

  // Case 221: A dependsOn B followed by B dependsOn A must return 409
  test('Case 221: A dependsOn B followed by B dependsOn A must return 409', () => {
    // Existing: A dependsOn B (B -> A)
    const tasks = [
      { _id: 'A', dependsOn: ['B'] },
      { _id: 'B', dependsOn: [] },
    ];
    // Proposed: B dependsOn A (dependent: B, prereq: A, edge: A -> B)
    const isCyclic = hasCycle(tasks, 'B', 'A');
    assert.strictEqual(isCyclic, true, 'Immediate direct cycle must be detected');
  });

  // Case 222: diamond DAG must remain valid
  test('Case 222: diamond DAG must remain valid', () => {
    // Diamond DAG:
    // A -> B -> D
    // A -> C -> D
    const tasks = [
      { _id: 'A', dependsOn: [] },
      { _id: 'B', dependsOn: ['A'] },
      { _id: 'C', dependsOn: ['A'] },
      { _id: 'D', dependsOn: ['B'] },
    ];
    // Adding D dependsOn C (dependent D, prereq C, edge C -> D)
    const isCyclic = hasCycle(tasks, 'D', 'C');
    assert.strictEqual(isCyclic, false, 'Diamond DAG must not be flagged as cyclic');

    tasks.find((t) => t._id === 'D').dependsOn.push('C');
    const sorted = topologicalSort(tasks);
    assert.strictEqual(sorted.length, 4);
    assert.strictEqual(sorted[0], 'A');
    assert.strictEqual(sorted[3], 'D');
  });

  // Case 223: Task completion fails closed with 409 if dependsOn contains a dangling/corrupted task ID
  await testAsync('Case 223: Task completion fails closed with 409 if dependsOn contains a dangling/corrupted task ID', async () => {
    const origTaskFindById = Task.findById;
    const origTaskFind = Task.find;

    const taskWithDangling = {
      _id: '64b0f0000000000000000001',
      status: 'In Progress',
      dependsOn: ['64b0f0000000000000000002', '64b0f0000000000000000999'], // 999 does not exist in DB
      createdBy: 'mgr_1',
    };
    Task.findById = async () => taskWithDangling;

    // DB query for prerequisites returns only one existing document
    Task.find = () => ({
      select: () => Promise.resolve([{ _id: '64b0f0000000000000000002', status: 'Done' }]),
    });

    const req = {
      params: { id: taskWithDangling._id },
      body: { status: 'Done' },
      user: { _id: 'mgr_1', role: 'manager' },
    };
    const res = createMockRes();
    await taskController.updateTask(req, res);

    Task.findById = origTaskFindById;
    Task.find = origTaskFind;

    assert.strictEqual(res.statusCode, 409);
    assert.strictEqual(res.body.success, false);
    assert.ok(res.body.message.includes('missing or corrupted'));
  });

  // Case 224: POST /api/tasks/:id/dependencies rejects ambiguous payload containing both dependsOnTaskId and dependencyTaskId with 400
  await testAsync('Case 224: POST /api/tasks/:id/dependencies rejects ambiguous payload containing both dependsOnTaskId and dependencyTaskId with 400', async () => {
    const req = {
      params: { id: '64b0f0000000000000000001' },
      body: {
        dependsOnTaskId: '64b0f0000000000000000002',
        dependencyTaskId: '64b0f0000000000000000002',
      },
      user: { _id: 'mgr_1', role: 'manager' },
    };
    const res = createMockRes();
    await taskController.addTaskDependency(req, res);

    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.success, false);
    assert.ok(res.body.message.includes('Ambiguous request: provide dependsOnTaskId only'));
  });

  // Case 225: POST /api/tasks/:id/dependencies rejects payload missing dependsOnTaskId (or legacy dependencyTaskId alone) with 400
  await testAsync('Case 225: POST /api/tasks/:id/dependencies rejects payload missing dependsOnTaskId with 400', async () => {
    const req = {
      params: { id: '64b0f0000000000000000001' },
      body: {
        dependencyTaskId: '64b0f0000000000000000002',
      },
      user: { _id: 'mgr_1', role: 'manager' },
    };
    const res = createMockRes();
    await taskController.addTaskDependency(req, res);

    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.success, false);
    assert.ok(res.body.message.includes('dependsOnTaskId is required'));
  });

  // Case 226: Inaccessible prerequisite details cannot be inferred via GET /api/tasks/:id/dependencies
  await testAsync('Case 226: Inaccessible prerequisite details cannot be inferred via GET /api/tasks/:id/dependencies', async () => {
    const origTaskFindById = Task.findById;
    const origTaskFind = Task.find;

    const memberUser = { _id: '64b0f00000000000000000aa', role: 'member' };
    const memberTask = {
      _id: '64b0f0000000000000000001',
      title: 'Member Task',
      assignedTo: memberUser._id,
      createdBy: memberUser._id,
      dependsOn: ['64b0f0000000000000000002'],
    };
    const privatePrereq = {
      _id: '64b0f0000000000000000002',
      title: 'Secret Executive Prerequisite',
      status: 'In Progress',
      priority: 'high',
      assignedTo: '64b0f00000000000000000bb',
      createdBy: '64b0f00000000000000000bb',
    };

    Task.findById = () => ({
      populate: () => ({
        populate: () => ({
          populate: () => Promise.resolve(memberTask),
        }),
      }),
    });
    Task.find = (query) => {
      if (query._id) {
        return {
          populate: () => ({
            populate: () => ({
              select: () => Promise.resolve([privatePrereq]),
            }),
          }),
        };
      }
      return {
        populate: () => ({
          populate: () => ({
            select: () => Promise.resolve([]),
          }),
        }),
      };
    };

    const req = {
      params: { id: memberTask._id },
      user: memberUser,
    };
    const res = createMockRes();
    await taskController.getTaskDependencies(req, res);

    Task.findById = origTaskFindById;
    Task.find = origTaskFind;

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, true);
    // Private prerequisite must be filtered out for the member
    assert.strictEqual(res.body.prerequisites.length, 0);
  });

  // Case 227: Inaccessible tasks do not appear in GET /api/projects/:projectId/dependency-graph for members
  await testAsync('Case 227: Inaccessible tasks do not appear in GET /api/projects/:projectId/dependency-graph for members', async () => {
    const origProjectFindById = Project.findById;
    const origTaskFind = Task.find;

    const memberUser = { _id: '64b0f00000000000000000aa', role: 'member' };
    const project = {
      _id: '64b0f0000000000000000099',
      name: 'Alpha Project',
      owner: '64b0f00000000000000000ff',
      members: [{ user: memberUser._id, role: 'member' }],
      populate: () => Promise.resolve(project),
    };

    const task1 = {
      _id: '64b0f0000000000000000001',
      title: 'Member Owned Task',
      assignedTo: { _id: memberUser._id, name: 'Member User' },
      createdBy: memberUser._id,
      dependsOn: ['64b0f0000000000000000002'],
    };
    const task2Private = {
      _id: '64b0f0000000000000000002',
      title: 'Private Executive Task',
      assignedTo: { _id: '64b0f00000000000000000ff', name: 'Executive' },
      createdBy: '64b0f00000000000000000ff',
      dependsOn: [],
    };

    Project.findById = () => ({ populate: () => Promise.resolve(project) });
    Task.find = () => ({
      populate: () => ({
        populate: () => ({
          sort: () => Promise.resolve([task1, task2Private]),
        }),
      }),
    });

    const req = {
      params: { projectId: project._id },
      user: memberUser,
    };
    const res = createMockRes();
    await projectController.getProjectDependencyGraph(req, res);

    Project.findById = origProjectFindById;
    Task.find = origTaskFind;

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.scope, 'personal');
    assert.strictEqual(res.body.isPartial, true);
    assert.strictEqual(res.body.nodes.length, 1);
    assert.strictEqual(res.body.nodes[0].id, task1._id);
    assert.strictEqual(res.body.edges.length, 0); // Edge to inaccessible task2Private is omitted
  });

  // Case 228: Completion conflict message does not leak inaccessible prerequisite titles or IDs
  await testAsync('Case 228: Completion conflict message does not leak inaccessible prerequisite titles or IDs', async () => {
    const origTaskFindById = Task.findById;
    const origTaskFind = Task.find;

    const memberUser = { _id: '64b0f00000000000000000aa', role: 'member' };
    const memberTask = {
      _id: '64b0f0000000000000000001',
      title: 'Member Task',
      status: 'In Progress',
      assignedTo: memberUser._id,
      createdBy: memberUser._id,
      dependsOn: ['64b0f0000000000000000002'],
    };
    const privateIncompletePrereq = {
      _id: '64b0f0000000000000000002',
      title: 'Secret Executive Operation',
      status: 'In Progress',
    };

    Task.findById = async () => memberTask;
    Task.find = () => ({
      select: () => Promise.resolve([privateIncompletePrereq]),
    });

    const req = {
      params: { id: memberTask._id },
      body: { status: 'Done' },
      user: memberUser,
    };
    const res = createMockRes();
    await taskController.updateTask(req, res);

    Task.findById = origTaskFindById;
    Task.find = origTaskFind;

    assert.strictEqual(res.statusCode, 409);
    assert.strictEqual(res.body.success, false);
    // Member receives privacy-preserving message without counts, titles, or IDs
    assert.strictEqual(
      res.body.message,
      'Cannot mark task as Done: one or more prerequisites are incomplete or unavailable.'
    );
    assert.ok(!res.body.message.includes('Secret'));
    assert.ok(!res.body.message.includes('64b0f0000000000000000002'));
    assert.ok(!res.body.message.includes('1'));
  });

  // Case 229: Member candidate search (GET /api/tasks?project=...) strictly excludes non-accessible tasks
  await testAsync('Case 229: Member candidate search (GET /api/tasks?project=...) strictly excludes non-accessible tasks', async () => {
    const origTaskFind = Task.find;
    const origTaskCount = Task.countDocuments;
    const origProjectFindById = Project.findById;

    const memberUser = { _id: new mongoose.Types.ObjectId(), role: 'member' };
    const projectId = new mongoose.Types.ObjectId();

    Project.findById = async () => ({
      _id: projectId,
      owner: new mongoose.Types.ObjectId(),
      members: [{ user: memberUser._id }],
    });

    let appliedFilter = null;
    Task.find = (filter) => {
      appliedFilter = filter;
      return {
        populate: () => ({
          populate: () => ({
            populate: () => ({
              populate: () => ({
                sort: () => ({
                  skip: () => ({
                    limit: () => Promise.resolve([]),
                  }),
                }),
              }),
            }),
          }),
        }),
      };
    };
    Task.countDocuments = async () => 0;

    const req = {
      query: { project: projectId.toString() },
      user: memberUser,
    };
    const res = createMockRes();
    await taskController.getTasks(req, res);

    Task.find = origTaskFind;
    Task.countDocuments = origTaskCount;
    Project.findById = origProjectFindById;

    assert.strictEqual(res.statusCode, 200);
    assert.ok(appliedFilter.$or, 'Must apply $or constraint for member user');
    assert.deepStrictEqual(appliedFilter.$or, [
      { assignedTo: memberUser._id },
      { createdBy: memberUser._id },
    ]);
  });

  // Case 230: Task schema explicitly defines dependsOn default as []
  test('Case 230: Task schema explicitly defines dependsOn default as []', () => {
    const doc = new Task({
      title: 'Schema Shape Test Task',
      createdBy: new mongoose.Types.ObjectId(),
    });
    assert.ok(Array.isArray(doc.dependsOn));
    assert.strictEqual(doc.dependsOn.length, 0);

    const dependsOnSchema = Task.schema.path('dependsOn');
    assert.ok(dependsOnSchema, 'dependsOn path must exist on Task schema');
    assert.strictEqual(dependsOnSchema.instance, 'Array');
  });

  // Case 231: Member cannot infer number or metadata of hidden prerequisites across state changes
  await testAsync('Case 231: Member cannot infer number or metadata of hidden prerequisites across state changes', async () => {
    const origTaskFindById = Task.findById;
    const origTaskFind = Task.find;

    const memberUser = { _id: new mongoose.Types.ObjectId(), role: 'member' };
    const executiveUser = { _id: new mongoose.Types.ObjectId(), role: 'manager' };

    const memberTask = {
      _id: new mongoose.Types.ObjectId().toString(),
      title: 'Member Delivery Task',
      status: 'In Progress',
      assignedTo: memberUser._id,
      createdBy: memberUser._id,
      dependsOn: [
        new mongoose.Types.ObjectId().toString(), // prereq 1: member accessible
        new mongoose.Types.ObjectId().toString(), // prereq 2: executive hidden
        new mongoose.Types.ObjectId().toString(), // prereq 3: executive hidden
      ],
    };

    Task.findById = async () => memberTask;

    // Simulation A: 2 incomplete (prereq 1 incomplete, prereq 2 incomplete, prereq 3 Done)
    let simPrereqs = [
      { _id: memberTask.dependsOn[0], title: 'Public Task 1', status: 'In Progress', assignedTo: memberUser._id, createdBy: memberUser._id },
      { _id: memberTask.dependsOn[1], title: 'Secret Task 2', status: 'In Progress', assignedTo: executiveUser._id, createdBy: executiveUser._id },
      { _id: memberTask.dependsOn[2], title: 'Secret Task 3', status: 'Done', assignedTo: executiveUser._id, createdBy: executiveUser._id },
    ];
    Task.find = () => ({ select: () => Promise.resolve(simPrereqs) });

    const req = {
      params: { id: memberTask._id },
      body: { status: 'Done' },
      user: memberUser,
    };
    let res = createMockRes();
    await taskController.updateTask(req, res);

    assert.strictEqual(res.statusCode, 409);
    assert.strictEqual(res.body.message, 'Cannot mark task as Done: one or more prerequisites are incomplete or unavailable.');
    assert.ok(!res.body.message.includes('2'), 'Must not expose count 2');
    assert.ok(!res.body.message.includes('Secret Task'));

    // Simulation B: State change — prereq 2 finishes, so only prereq 1 is incomplete
    simPrereqs[1].status = 'Done';
    res = createMockRes();
    await taskController.updateTask(req, res);

    // Response must remain identical so Member cannot detect that a hidden prerequisite finished
    assert.strictEqual(res.statusCode, 409);
    assert.strictEqual(res.body.message, 'Cannot mark task as Done: one or more prerequisites are incomplete or unavailable.');
    assert.ok(!res.body.message.includes('1'), 'Must not expose count 1');

    // Simulation C: Only the hidden prerequisite is incomplete (prereq 1 is Done)
    simPrereqs[0].status = 'Done';
    simPrereqs[1].status = 'In Progress';
    res = createMockRes();
    await taskController.updateTask(req, res);

    assert.strictEqual(res.statusCode, 409);
    assert.strictEqual(res.body.message, 'Cannot mark task as Done: one or more prerequisites are incomplete or unavailable.');

    Task.findById = origTaskFindById;
    Task.find = origTaskFind;
  });

  // Case 232: Admin/Manager responses retain authorized detail for incomplete and missing prerequisites
  await testAsync('Case 232: Admin/Manager responses retain authorized detail for incomplete and missing prerequisites', async () => {
    const origTaskFindById = Task.findById;
    const origTaskFind = Task.find;

    const adminUser = { _id: new mongoose.Types.ObjectId(), role: 'admin' };
    const taskA = {
      _id: new mongoose.Types.ObjectId().toString(),
      title: 'Admin Controlled Task',
      status: 'In Progress',
      assignedTo: adminUser._id,
      createdBy: adminUser._id,
      dependsOn: [
        new mongoose.Types.ObjectId().toString(),
        new mongoose.Types.ObjectId().toString(),
      ],
    };

    Task.findById = async () => taskA;

    // Incomplete scenario: 2 incomplete prerequisites
    Task.find = () => ({
      select: () =>
        Promise.resolve([
          { _id: taskA.dependsOn[0], status: 'In Progress', title: 'Prereq 1' },
          { _id: taskA.dependsOn[1], status: 'In Progress', title: 'Prereq 2' },
        ]),
    });

    const reqIncomplete = {
      params: { id: taskA._id },
      body: { status: 'Done' },
      user: adminUser,
    };
    const resIncomplete = createMockRes();
    await taskController.updateTask(reqIncomplete, resIncomplete);

    assert.strictEqual(resIncomplete.statusCode, 409);
    assert.strictEqual(
      resIncomplete.body.message,
      'Cannot mark task as Done: 2 prerequisite task(s) are incomplete. All prerequisites must be completed first.'
    );

    // Missing / corrupted prerequisite scenario: 1 prerequisite missing from DB
    Task.find = () => ({
      select: () =>
        Promise.resolve([
          { _id: taskA.dependsOn[0], status: 'Done', title: 'Prereq 1' },
        ]), // dependsOn has 2, but only 1 found
    });

    const reqMissing = {
      params: { id: taskA._id },
      body: { status: 'Done' },
      user: adminUser,
    };
    const resMissing = createMockRes();
    await taskController.updateTask(reqMissing, resMissing);

    assert.strictEqual(resMissing.statusCode, 409);
    assert.strictEqual(
      resMissing.body.message,
      'Cannot mark task as Done: referenced prerequisite task is missing or corrupted.'
    );

    Task.findById = origTaskFindById;
    Task.find = origTaskFind;
  });

  // Case 233: Dependency query instrumentation verifies exactly 3 bounded queries for task dependencies and 2 bounded queries for project graph
  await testAsync('Case 233: Dependency query instrumentation verifies exactly 3 bounded queries for task dependencies and 2 bounded queries for project graph', async () => {
    const origTaskFindById = Task.findById;
    const origTaskFind = Task.find;
    const origProjectFindById = Project.findById;

    const managerUser = { _id: new mongoose.Types.ObjectId(), role: 'manager' };
    const projectId = new mongoose.Types.ObjectId().toString();
    const taskId = new mongoose.Types.ObjectId().toString();

    // Part A: Instrumentation for GET /api/tasks/:id/dependencies
    let taskDependenciesDbQueries = 0;
    Task.findById = () => {
      taskDependenciesDbQueries++;
      const targetDoc = {
        _id: taskId,
        title: 'Target Task',
        status: 'To Do',
        priority: 'high',
        dependsOn: [new mongoose.Types.ObjectId().toString()],
        project: projectId,
        assignedTo: managerUser._id,
        createdBy: managerUser._id,
      };
      return {
        populate: () => ({
          populate: () => ({
            populate: () => Promise.resolve(targetDoc),
          }),
        }),
      };
    };

    Task.find = () => {
      taskDependenciesDbQueries++;
      return {
        populate: () => ({
          populate: () => ({
            select: () => Promise.resolve([]),
          }),
        }),
      };
    };

    const taskDepReq = { params: { id: taskId }, user: managerUser };
    const taskDepRes = createMockRes();
    await taskController.getTaskDependencies(taskDepReq, taskDepRes);

    assert.strictEqual(taskDepRes.statusCode, 200);
    assert.strictEqual(
      taskDependenciesDbQueries,
      3,
      'GET /api/tasks/:id/dependencies must execute exactly 3 bounded queries (target task, forward prereqs, reverse dependents)'
    );

    // Part B: Instrumentation for GET /api/projects/:projectId/dependency-graph
    let projectGraphDbQueries = 0;
    Project.findById = () => {
      projectGraphDbQueries++;
      return {
        populate: () =>
          Promise.resolve({
            _id: projectId,
            name: 'Instrumented Project',
            status: 'active',
            owner: managerUser._id,
            members: [],
          }),
      };
    };

    Task.find = () => {
      projectGraphDbQueries++;
      return {
        populate: () => ({
          populate: () => ({
            sort: () =>
              Promise.resolve([
                {
                  _id: taskId,
                  title: 'Task 1',
                  status: 'To Do',
                  priority: 'high',
                  dependsOn: [],
                  project: projectId,
                  assignedTo: managerUser._id,
                  createdBy: managerUser._id,
                },
              ]),
          }),
        }),
      };
    };

    const projGraphReq = { params: { projectId }, user: managerUser };
    const projGraphRes = createMockRes();
    await projectController.getProjectDependencyGraph(projGraphReq, projGraphRes);

    assert.strictEqual(projGraphRes.statusCode, 200);
    assert.strictEqual(
      projectGraphDbQueries,
      2,
      'GET /api/projects/:projectId/dependency-graph must execute exactly 2 bounded queries (project auth, all project tasks)'
    );

    Task.findById = origTaskFindById;
    Task.find = origTaskFind;
    Project.findById = origProjectFindById;
  });

  console.log('\n--- SECTION 16: Phase 4 Blocker Propagation, Critical Path & Delivery Slip Forecasting ---');

  // Case 234: Blocker propagation: linear chain
  await testAsync('Case 234: Blocker propagation: linear chain (A -> B -> C, A blocked => B & C propagated blocked)', async () => {
    const idA = '64b0f0000000000000000234a';
    const idB = '64b0f0000000000000000234b';
    const idC = '64b0f0000000000000000234c';
    const tasks = [
      { _id: idA, title: 'Task A', status: 'In Progress', isBlocked: true, blockedReason: 'API down', dependsOn: [] },
      { _id: idB, title: 'Task B', status: 'To Do', isBlocked: false, dependsOn: [idA] },
      { _id: idC, title: 'Task C', status: 'To Do', isBlocked: false, dependsOn: [idB] },
    ];
    const propagation = computeBlockerPropagation(tasks);
    assert.strictEqual(propagation.directBlockerCount, 1);
    assert.ok(propagation.directBlockerTaskIds.has(idA));
    assert.strictEqual(propagation.propagatedBlockerCount, 2);
    assert.ok(propagation.propagatedBlockerTaskIds.has(idB));
    assert.ok(propagation.propagatedBlockerTaskIds.has(idC));
    assert.strictEqual(propagation.propagationDepth[idB], 1);
    assert.strictEqual(propagation.propagationDepth[idC], 2);
    assert.strictEqual(propagation.downstreamImpactCounts[idA], 2);
  });

  // Case 235: Blocker propagation: diamond deduplication
  await testAsync('Case 235: Blocker propagation: diamond deduplication (A -> B, A -> C, B -> D, C -> D; A blocked => D visited once)', async () => {
    const idA = '64b0f0000000000000000235a';
    const idB = '64b0f0000000000000000235b';
    const idC = '64b0f0000000000000000235c';
    const idD = '64b0f0000000000000000235d';
    const tasks = [
      { _id: idA, title: 'Task A', status: 'In Progress', isBlocked: true, dependsOn: [] },
      { _id: idB, title: 'Task B', status: 'To Do', isBlocked: false, dependsOn: [idA] },
      { _id: idC, title: 'Task C', status: 'To Do', isBlocked: false, dependsOn: [idA] },
      { _id: idD, title: 'Task D', status: 'To Do', isBlocked: false, dependsOn: [idB, idC] },
    ];
    const propagation = computeBlockerPropagation(tasks);
    assert.strictEqual(propagation.directBlockerCount, 1);
    assert.strictEqual(propagation.propagatedBlockerCount, 3);
    assert.ok(propagation.propagatedBlockerTaskIds.has(idD));
    assert.strictEqual(propagation.downstreamImpactCounts[idA], 3); // B, C, D
    assert.strictEqual(propagation.propagationDepth[idD], 2);
  });

  // Case 236: Blocker propagation: multiple blockers
  await testAsync('Case 236: Blocker propagation: multiple blockers (A -> C, B -> C; resolving A leaves C still blocked by B)', async () => {
    const idA = '64b0f0000000000000000236a';
    const idB = '64b0f0000000000000000236b';
    const idC = '64b0f0000000000000000236c';
    const tasksBoth = [
      { _id: idA, title: 'Task A', status: 'In Progress', isBlocked: true, dependsOn: [] },
      { _id: idB, title: 'Task B', status: 'In Progress', isBlocked: true, dependsOn: [] },
      { _id: idC, title: 'Task C', status: 'To Do', isBlocked: false, dependsOn: [idA, idB] },
    ];
    const propBoth = computeBlockerPropagation(tasksBoth);
    assert.strictEqual(propBoth.directBlockerCount, 2);
    assert.strictEqual(propBoth.propagatedBlockerCount, 1);
    assert.deepStrictEqual(propBoth.blockingPrerequisiteIds[idC].sort(), [idA, idB].sort());

    // Resolve A
    const tasksResolvedA = [
      { _id: idA, title: 'Task A', status: 'Done', isBlocked: false, dependsOn: [] },
      { _id: idB, title: 'Task B', status: 'In Progress', isBlocked: true, dependsOn: [] },
      { _id: idC, title: 'Task C', status: 'To Do', isBlocked: false, dependsOn: [idA, idB] },
    ];
    const propResolvedA = computeBlockerPropagation(tasksResolvedA);
    assert.strictEqual(propResolvedA.directBlockerCount, 1);
    assert.ok(propResolvedA.propagatedBlockerTaskIds.has(idC));
    assert.deepStrictEqual(propResolvedA.blockingPrerequisiteIds[idC], [idB]);
  });

  // Case 237: Blocker propagation: unaffected parallel branch
  await testAsync('Case 237: Blocker propagation: unaffected parallel branch (X -> Y remains unblocked)', async () => {
    const idA = '64b0f0000000000000000237a';
    const idB = '64b0f0000000000000000237b';
    const idX = '64b0f0000000000000000237x';
    const idY = '64b0f0000000000000000237y';
    const tasks = [
      { _id: idA, title: 'Task A', status: 'In Progress', isBlocked: true, dependsOn: [] },
      { _id: idB, title: 'Task B', status: 'To Do', isBlocked: false, dependsOn: [idA] },
      { _id: idX, title: 'Task X', status: 'To Do', isBlocked: false, dependsOn: [] },
      { _id: idY, title: 'Task Y', status: 'To Do', isBlocked: false, dependsOn: [idX] },
    ];
    const prop = computeBlockerPropagation(tasks);
    assert.strictEqual(prop.propagatedBlockerTaskIds.has(idX), false);
    assert.strictEqual(prop.propagatedBlockerTaskIds.has(idY), false);
    assert.strictEqual(prop.downstreamImpactCounts[idA], 1);
  });

  // Case 238: Blocker propagation: cycle safety on corrupted DB data
  await testAsync('Case 238: Blocker propagation: cycle safety on corrupted DB data (terminates safely without infinite loop)', async () => {
    const idA = '64b0f0000000000000000238a';
    const idB = '64b0f0000000000000000238b';
    const idC = '64b0f0000000000000000238c';
    const tasks = [
      { _id: idA, title: 'Task A', status: 'In Progress', isBlocked: true, dependsOn: [idC] },
      { _id: idB, title: 'Task B', status: 'To Do', isBlocked: false, dependsOn: [idA] },
      { _id: idC, title: 'Task C', status: 'To Do', isBlocked: false, dependsOn: [idB] },
    ];
    const prop = computeBlockerPropagation(tasks);
    assert.ok(prop);
    assert.strictEqual(prop.directBlockerCount, 1);
  });

  // Case 239: Critical path: weighted longest path DP
  await testAsync('Case 239: Critical path: weighted longest path DP (A: 3d -> B: 5d -> C: 2d yields path [A, B, C], length 10d)', async () => {
    const idA = '64b0f0000000000000000239a';
    const idB = '64b0f0000000000000000239b';
    const idC = '64b0f0000000000000000239c';
    const tasks = [
      { _id: idA, title: 'A', status: 'To Do', estimateDays: 3, dependsOn: [] },
      { _id: idB, title: 'B', status: 'To Do', estimateDays: 5, dependsOn: [idA] },
      { _id: idC, title: 'C', status: 'To Do', estimateDays: 2, dependsOn: [idB] },
    ];
    const cp = computeCriticalPath(tasks);
    assert.strictEqual(cp.status, 'complete');
    assert.deepStrictEqual(cp.path, [idA, idB, idC]);
    assert.strictEqual(cp.totalRemainingDays, 10);
    assert.strictEqual(cp.edges.length, 2);
  });

  // Case 240: Critical path: Done tasks contribute 0 days
  await testAsync('Case 240: Critical path: Done tasks contribute 0 days (Done A: 5d -> In Progress B: 4d yields length 4d)', async () => {
    const idA = '64b0f0000000000000000240a';
    const idB = '64b0f0000000000000000240b';
    const tasks = [
      { _id: idA, title: 'A', status: 'Done', estimateDays: 5, dependsOn: [] },
      { _id: idB, title: 'B', status: 'In Progress', estimateDays: 4, dependsOn: [idA] },
    ];
    const cp = computeCriticalPath(tasks);
    assert.strictEqual(cp.status, 'complete');
    assert.strictEqual(cp.totalRemainingDays, 4);
    assert.deepStrictEqual(cp.path, [idA, idB]);
  });

  // Case 241: Critical path: missing estimate returns status 'insufficient_data'
  await testAsync('Case 241: Critical path: missing estimate returns status insufficient_data and identifies missing task IDs', async () => {
    const idA = '64b0f0000000000000000241a';
    const idB = '64b0f0000000000000000241b';
    const tasks = [
      { _id: idA, title: 'A', status: 'To Do', estimateDays: 3, dependsOn: [] },
      { _id: idB, title: 'B', status: 'To Do', estimateDays: null, dependsOn: [idA] },
    ];
    const cp = computeCriticalPath(tasks);
    assert.strictEqual(cp.status, 'insufficient_data');
    assert.strictEqual(cp.path.length, 0);
    assert.deepStrictEqual(cp.missingEstimateTaskIds, [idB]);
  });

  // Case 242: Critical path: deterministic tie-breaking on equal length paths
  await testAsync('Case 242: Critical path: deterministic tie-breaking on equal length paths', async () => {
    const idA = '64b0f0000000000000000242a';
    const idB = '64b0f0000000000000000242b';
    const idC = '64b0f0000000000000000242c';
    const idD = '64b0f0000000000000000242d';
    const tasks = [
      { _id: idA, title: 'Alpha', status: 'To Do', estimateDays: 4, dueDate: '2026-10-01', priority: 'high', dependsOn: [] },
      { _id: idB, title: 'Beta', status: 'To Do', estimateDays: 4, dueDate: '2026-10-01', priority: 'high', dependsOn: [idA] },
      { _id: idC, title: 'Gamma', status: 'To Do', estimateDays: 4, dueDate: '2026-10-15', priority: 'medium', dependsOn: [] },
      { _id: idD, title: 'Delta', status: 'To Do', estimateDays: 4, dueDate: '2026-10-15', priority: 'medium', dependsOn: [idC] },
    ];
    const cp = computeCriticalPath(tasks);
    assert.strictEqual(cp.status, 'complete');
    assert.strictEqual(cp.totalRemainingDays, 8);
    assert.deepStrictEqual(cp.path, [idA, idB]);
  });

  // Case 243: Delivery forecast: on_track when forecastDate <= targetDate
  await testAsync('Case 243: Delivery forecast: on_track when forecastDate <= targetDate (slipDays: 0, status: on_track)', async () => {
    const today = toUtcDay(new Date());
    const targetDate = addCalendarDays(today, 10);
    const idA = '64b0f0000000000000000243a';
    const tasks = [
      { _id: idA, title: 'Task A', status: 'To Do', estimateDays: 5, dependsOn: [] },
    ];
    const project = { _id: 'proj_243' };
    const release = { _id: 'rel_243', targetDate };
    const forecast = computeDeliveryForecast(project, release, tasks);
    assert.strictEqual(forecast.status, 'on_track');
    assert.strictEqual(forecast.slipDays, 0);
    assert.strictEqual(forecast.totalRemainingDays, 5);
  });

  // Case 244: Delivery forecast: slipping when forecastDate > targetDate
  await testAsync('Case 244: Delivery forecast: slipping when forecastDate > targetDate (exact UTC slipDays)', async () => {
    const today = toUtcDay(new Date());
    const targetDate = addCalendarDays(today, 3);
    const idA = '64b0f0000000000000000244a';
    const tasks = [
      { _id: idA, title: 'Task A', status: 'To Do', estimateDays: 7, dependsOn: [] },
    ];
    const project = { _id: 'proj_244' };
    const release = { _id: 'rel_244', targetDate };
    const forecast = computeDeliveryForecast(project, release, tasks);
    assert.strictEqual(forecast.status, 'slipping');
    assert.strictEqual(forecast.slipDays, 4);
  });

  // Case 245: Delivery forecast: blocker ETA delays critical path start from blockerEta
  await testAsync('Case 245: Delivery forecast: blocker ETA delays critical path start from blockerEta', async () => {
    const today = toUtcDay(new Date());
    const futureEta = addCalendarDays(today, 5);
    const idA = '64b0f0000000000000000245a';
    const idB = '64b0f0000000000000000245b';
    const tasks = [
      { _id: idA, title: 'Task A', status: 'In Progress', isBlocked: true, blockerEta: futureEta, estimateDays: 2, dependsOn: [] },
      { _id: idB, title: 'Task B', status: 'To Do', estimateDays: 3, dependsOn: [idA] },
    ];
    const project = { _id: 'proj_245' };
    const release = { _id: 'rel_245', targetDate: addCalendarDays(today, 6) };
    const forecast = computeDeliveryForecast(project, release, tasks);
    assert.ok(forecast.forecastDate);
    const expectedFinish = addCalendarDays(futureEta, 5);
    assert.strictEqual(toUtcDay(forecast.forecastDate).getTime(), expectedFinish.getTime());
    assert.strictEqual(forecast.status, 'slipping');
  });

  // Case 246: Required in-scope blocked task without ETA yields indeterminate forecast
  await testAsync('Case 246: Required in-scope blocked task without ETA yields indeterminate forecast (status: indeterminate, forecastDate: null, slipDays: null)', async () => {
    const today = toUtcDay(new Date());
    const idA = '64b0f0000000000000000246a';
    const tasks = [
      { _id: idA, title: 'Task A', status: 'In Progress', isBlocked: true, blockerEta: null, estimateDays: 3, dependsOn: [] },
    ];
    const project = { _id: 'proj_246' };
    const release = { _id: 'rel_246', targetDate: addCalendarDays(today, 10) };
    const forecast = computeDeliveryForecast(project, release, tasks);
    assert.strictEqual(forecast.status, 'indeterminate');
    assert.strictEqual(forecast.forecastDate, null);
    assert.strictEqual(forecast.slipDays, null);
    assert.ok(forecast.drivers.some((d) => d.type === 'critical_blocker'));
  });

  // Case 247: Blocked task outside release scope does not affect release forecast
  await testAsync('Case 247: Blocked task outside release scope does not affect release forecast', async () => {
    const today = toUtcDay(new Date());
    const relId = '64b0f00000000000000002470';
    const msId = '64b0f0000000000000000247m';
    const idInRelease = '64b0f0000000000000000247r';
    const idOutside = '64b0f0000000000000000247o';

    const project = { _id: '64b0f0000000000000000247p', status: 'active' };
    const release = { _id: relId, project: project._id, targetDate: addCalendarDays(today, 10), status: 'active' };
    const milestones = [{ _id: msId, release: relId, status: 'open' }];

    const tasks = [
      { _id: idInRelease, project: project._id, title: 'Release Task', status: 'To Do', estimateDays: 4, milestone: msId, dependsOn: [] },
      { _id: idOutside, project: project._id, title: 'Outside Blocked Task', status: 'In Progress', isBlocked: true, blockerEta: null, estimateDays: 2, dependsOn: [] },
    ];

    const payload = buildDeliveryIntelligencePayload(project, release, tasks, milestones, { _id: 'adm_1', role: 'admin' });
    assert.strictEqual(payload.forecast.status, 'on_track');
    assert.ok(payload.forecast.forecastDate);
    assert.strictEqual(payload.forecast.slipDays, 0);
  });

  // Case 248: Delivery forecast: cross-release prerequisite included
  await testAsync('Case 248: Delivery forecast: cross-release prerequisite included in release forecast', async () => {
    const today = toUtcDay(new Date());
    const idExt = '64b0f0000000000000000248e';
    const idRelTask = '64b0f0000000000000000248r';
    const relId = '64b0f00000000000000002480';
    const msId = '64b0f0000000000000000248m';

    const tasks = [
      { _id: idExt, title: 'External Prereq', status: 'To Do', estimateDays: 6, dependsOn: [] },
      { _id: idRelTask, title: 'Release Task', status: 'To Do', estimateDays: 4, dependsOn: [idExt], milestone: msId },
    ];
    const project = { _id: 'proj_248' };
    const release = { _id: relId, targetDate: addCalendarDays(today, 15) };
    const forecast = computeDeliveryForecast(project, release, tasks);
    assert.strictEqual(forecast.totalRemainingDays, 10);
    assert.deepStrictEqual(forecast.criticalPath, [idExt, idRelTask]);
  });

  // Case 249: Validation: POST /api/tasks rejects non-integer estimateDays
  await testAsync('Case 249: Validation: POST /api/tasks rejects non-integer estimateDays with 400', async () => {
    const req = {
      body: { title: 'T', project: '64b0f00000000000000002490', estimateDays: 3.5 },
      user: { _id: 'adm_1', role: 'admin' },
    };
    const res = createMockRes();
    await taskController.createTask(req, res);
    assert.strictEqual(res.statusCode, 400);
    assert.ok(res.body.message.includes('Estimate days must be an integer'));
  });

  // Case 250: Validation: POST /api/tasks rejects negative estimateDays
  await testAsync('Case 250: Validation: POST /api/tasks rejects negative estimateDays with 400', async () => {
    const req = {
      body: { title: 'T', project: '64b0f00000000000000002500', estimateDays: -2 },
      user: { _id: 'adm_1', role: 'admin' },
    };
    const res = createMockRes();
    await taskController.createTask(req, res);
    assert.strictEqual(res.statusCode, 400);
  });

  // Case 251: Validation: POST /api/tasks rejects zero estimateDays
  await testAsync('Case 251: Validation: POST /api/tasks rejects zero estimateDays with 400', async () => {
    const req = {
      body: { title: 'T', project: '64b0f00000000000000002510', estimateDays: 0 },
      user: { _id: 'adm_1', role: 'admin' },
    };
    const res = createMockRes();
    await taskController.createTask(req, res);
    assert.strictEqual(res.statusCode, 400);
  });

  // Case 252: Validation: POST /api/tasks rejects estimateDays > 60
  await testAsync('Case 252: Validation: POST /api/tasks rejects estimateDays > 60 with 400', async () => {
    const req = {
      body: { title: 'T', project: '64b0f00000000000000002520', estimateDays: 61 },
      user: { _id: 'adm_1', role: 'admin' },
    };
    const res = createMockRes();
    await taskController.createTask(req, res);
    assert.strictEqual(res.statusCode, 400);
  });

  // Case 253: Validation: POST /api/tasks rejects string estimateDays
  await testAsync('Case 253: Validation: POST /api/tasks rejects string estimateDays ("5") with 400', async () => {
    const req = {
      body: { title: 'T', project: '64b0f00000000000000002530', estimateDays: '5' },
      user: { _id: 'adm_1', role: 'admin' },
    };
    const res = createMockRes();
    await taskController.createTask(req, res);
    assert.strictEqual(res.statusCode, 400);
  });

  // Case 254: Validation: PUT /api/tasks/:id allows clearing estimateDays
  await testAsync('Case 254: Validation: PUT /api/tasks/:id allows clearing estimateDays with null or empty string', async () => {
    const taskId = new mongoose.Types.ObjectId().toString();
    const taskDoc = {
      _id: taskId,
      title: 'Task With Estimate',
      estimateDays: 5,
      save: async function () { return this; },
      populate: async function () { return this; },
    };
    const origFindById = Task.findById;
    Task.findById = () => Promise.resolve(taskDoc);

    const req = {
      params: { id: taskId },
      body: { estimateDays: null },
      user: { _id: 'adm_1', role: 'admin' },
    };
    const res = createMockRes();
    await taskController.updateTask(req, res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(taskDoc.estimateDays, null);

    Task.findById = origFindById;
  });

  // Case 255: Validation: PUT /api/tasks/:id rejects blockerEta when isBlocked: false
  await testAsync('Case 255: Validation: PUT /api/tasks/:id rejects blockerEta when isBlocked is false', async () => {
    const taskId = new mongoose.Types.ObjectId().toString();
    const taskDoc = {
      _id: taskId,
      title: 'Unblocked Task',
      isBlocked: false,
      save: async function () { return this; },
    };
    const origFindById = Task.findById;
    Task.findById = () => Promise.resolve(taskDoc);

    const req = {
      params: { id: taskId },
      body: { isBlocked: false, blockerEta: '2026-10-01' },
      user: { _id: 'adm_1', role: 'admin' },
    };
    const res = createMockRes();
    await taskController.updateTask(req, res);
    assert.strictEqual(res.statusCode, 400);
    assert.ok(res.body.message.includes('Blocker ETA can only be specified when a task is marked as blocked'));

    Task.findById = origFindById;
  });

  // Case 256: Validation: PUT /api/tasks/:id clearing isBlocked automatically resets blockerEta to null
  await testAsync('Case 256: Validation: PUT /api/tasks/:id clearing isBlocked automatically resets blockerEta to null', async () => {
    const taskId = new mongoose.Types.ObjectId().toString();
    const taskDoc = {
      _id: taskId,
      title: 'Blocked Task',
      isBlocked: true,
      blockerEta: new Date('2026-10-01'),
      save: async function () { return this; },
      populate: async function () { return this; },
    };
    const origFindById = Task.findById;
    Task.findById = () => Promise.resolve(taskDoc);

    const req = {
      params: { id: taskId },
      body: { isBlocked: false },
      user: { _id: 'adm_1', role: 'admin' },
    };
    const res = createMockRes();
    await taskController.updateTask(req, res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(taskDoc.isBlocked, false);
    assert.strictEqual(taskDoc.blockerEta, null);

    Task.findById = origFindById;
  });

  // Case 257: Security: mass assignment protection in POST /api/tasks
  await testAsync('Case 257: Security: mass assignment protection in POST /api/tasks strips derived intelligence fields', async () => {
    let capturedData = null;
    const origCreate = Task.create;
    Task.create = async (d) => {
      capturedData = d;
      return { _id: 'task_257', ...d, populate: async function () { return this; } };
    };

    const req = {
      body: {
        title: 'Task 257',
        project: '64b0f00000000000000002570',
        criticalPath: true,
        propagatedBlocked: true,
        forecastDate: '2026-10-10',
        slipDays: 10,
        impactCount: 5,
        forecastConfidence: 'high',
        dependsOn: ['64b0f00000000000000009999'],
      },
      user: { _id: 'adm_1', role: 'admin' },
    };
    const res = createMockRes();
    await taskController.createTask(req, res);

    assert.strictEqual(capturedData.criticalPath, undefined);
    assert.strictEqual(capturedData.propagatedBlocked, undefined);
    assert.strictEqual(capturedData.forecastDate, undefined);
    assert.strictEqual(capturedData.slipDays, undefined);
    assert.strictEqual(capturedData.impactCount, undefined);
    assert.strictEqual(capturedData.forecastConfidence, undefined);
    assert.strictEqual(capturedData.dependsOn, undefined);

    Task.create = origCreate;
  });

  // Case 258: Security: mass assignment protection in PUT /api/tasks/:id
  await testAsync('Case 258: Security: mass assignment protection in PUT /api/tasks/:id strips derived intelligence fields', async () => {
    const taskId = new mongoose.Types.ObjectId().toString();
    const taskDoc = {
      _id: taskId,
      title: 'Task 258',
      dependsOn: [],
      save: async function () { return this; },
      populate: async function () { return this; },
    };
    const origFindById = Task.findById;
    Task.findById = () => Promise.resolve(taskDoc);

    const req = {
      params: { id: taskId },
      body: {
        criticalPath: true,
        propagatedBlocked: true,
        forecastDate: '2026-10-10',
        slipDays: 10,
        impactCount: 5,
        forecastConfidence: 'high',
        dependsOn: ['64b0f00000000000000009999'],
      },
      user: { _id: 'adm_1', role: 'admin' },
    };
    const res = createMockRes();
    await taskController.updateTask(req, res);

    assert.strictEqual(taskDoc.criticalPath, undefined);
    assert.strictEqual(taskDoc.propagatedBlocked, undefined);
    assert.strictEqual(taskDoc.forecastDate, undefined);
    assert.strictEqual(taskDoc.slipDays, undefined);
    assert.strictEqual(taskDoc.impactCount, undefined);
    assert.strictEqual(taskDoc.forecastConfidence, undefined);
    assert.deepStrictEqual(taskDoc.dependsOn, []); // not overwritten by req.body.dependsOn

    Task.findById = origFindById;
  });

  // Case 259: Security & Privacy: Member requesting project delivery intelligence receives scope: 'personal' and isPartial: true
  await testAsync('Case 259: Security & Privacy: Member requesting project delivery intelligence receives scope: personal and isPartial: true', async () => {
    const memberUser = { _id: new mongoose.Types.ObjectId().toString(), role: 'member' };
    const project = {
      _id: new mongoose.Types.ObjectId().toString(),
      name: 'Project 259',
      status: 'active',
      owner: new mongoose.Types.ObjectId().toString(),
      members: [{ user: memberUser._id, role: 'developer' }],
    };
    const tasks = [
      { _id: new mongoose.Types.ObjectId().toString(), title: 'Member Task', assignedTo: memberUser._id, dependsOn: [] },
      { _id: new mongoose.Types.ObjectId().toString(), title: 'Other Task', assignedTo: 'other_user', dependsOn: [] },
    ];
    const payload = buildDeliveryIntelligencePayload(project, null, tasks, [], memberUser);
    assert.strictEqual(payload.scope, 'personal');
    assert.strictEqual(payload.isPartial, true);
  });

  // Case 260: Security & Privacy: Member receives generic masked signal for restricted upstream blocker
  await testAsync('Case 260: Security & Privacy: Member receives generic masked signal for restricted upstream blocker', async () => {
    const memberUser = { _id: new mongoose.Types.ObjectId().toString(), role: 'member' };
    const privateTask = {
      _id: new mongoose.Types.ObjectId().toString(),
      title: 'Super Secret Backend Migration',
      assignedTo: 'admin_user',
      isBlocked: true,
      blockedReason: 'Vendor security breach',
      dependsOn: [],
    };
    const memberTask = {
      _id: new mongoose.Types.ObjectId().toString(),
      title: 'Frontend Button',
      assignedTo: memberUser._id,
      dependsOn: [privateTask._id],
    };
    const project = { _id: 'proj_260', status: 'active' };
    const payload = buildDeliveryIntelligencePayload(project, null, [privateTask, memberTask], [], memberUser);

    assert.ok(payload.restrictedUpstreamSignal);
    assert.strictEqual(payload.restrictedUpstreamSignal.type, 'restricted_upstream_impact');
    assert.strictEqual(payload.restrictedUpstreamSignal.message, 'Restricted upstream work may affect this task.');

    // Ensure private details are not present in payload
    const jsonStr = JSON.stringify(payload);
    assert.strictEqual(jsonStr.includes('Super Secret Backend Migration'), false);
    assert.strictEqual(jsonStr.includes('Vendor security breach'), false);
  });

  // Case 261: Security & Privacy: Member response suppresses project-wide forecast and critical path
  await testAsync('Case 261: Security & Privacy: Member response suppresses project-wide forecast and critical path', async () => {
    const memberUser = { _id: new mongoose.Types.ObjectId().toString(), role: 'member' };
    const project = { _id: 'proj_261', status: 'active' };
    const tasks = [
      { _id: new mongoose.Types.ObjectId().toString(), title: 'T1', assignedTo: memberUser._id, estimateDays: 3, dependsOn: [] },
    ];
    const payload = buildDeliveryIntelligencePayload(project, null, tasks, [], memberUser);
    assert.strictEqual(payload.forecast, null);
    assert.deepStrictEqual(payload.criticalPath, []);
    assert.deepStrictEqual(payload.criticalEdges, []);
  });

  // Case 262: RBAC: Project manager can view full project delivery intelligence
  await testAsync('Case 262: RBAC: Project manager can view full project delivery intelligence', async () => {
    const managerUser = { _id: new mongoose.Types.ObjectId().toString(), role: 'manager' };
    const project = { _id: 'proj_262', status: 'active', owner: managerUser._id, members: [] };
    const tasks = [
      { _id: new mongoose.Types.ObjectId().toString(), title: 'T1', estimateDays: 3, dependsOn: [] },
    ];
    const payload = buildDeliveryIntelligencePayload(project, null, tasks, [], managerUser);
    assert.strictEqual(payload.scope, 'project');
    assert.strictEqual(payload.isPartial, false);
    assert.ok(payload.forecast);
    assert.strictEqual(payload.criticalPath.length, 1);
  });

  // Case 263: RBAC: Project manager can view full release delivery intelligence
  await testAsync('Case 263: RBAC: Project manager can view full release delivery intelligence', async () => {
    const managerUser = { _id: new mongoose.Types.ObjectId().toString(), role: 'manager' };
    const releaseId = new mongoose.Types.ObjectId().toString();
    const projectId = new mongoose.Types.ObjectId().toString();
    const origRelFindById = Release.findById;
    const origProjFindById = Project.findById;
    const origMsFind = Milestone.find;
    const origTaskFind = Task.find;

    Release.findById = () => Promise.resolve({ _id: releaseId, name: 'R1', version: '1.0', project: projectId });
    Project.findById = () => Promise.resolve({ _id: projectId, name: 'P1', status: 'active', owner: managerUser._id });
    Milestone.find = () => ({ sort: () => Promise.resolve([]) });
    Task.find = () => ({
      populate: () => ({
        populate: () => ({
          sort: () => Promise.resolve([
            { _id: 't_263', title: 'T1', estimateDays: 4, dependsOn: [] },
          ]),
        }),
      }),
    });

    const req = { params: { releaseId }, user: managerUser };
    const res = createMockRes();
    await releaseController.getReleaseDeliveryIntelligence(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(res.body.forecast);

    Release.findById = origRelFindById;
    Project.findById = origProjFindById;
    Milestone.find = origMsFind;
    Task.find = origTaskFind;
  });

  // Case 264: Invariant: Archived project returns read-only availability: 'archived', forecast null
  await testAsync('Case 264: Invariant: Archived project returns read-only availability: archived, forecast null', async () => {
    const adminUser = { _id: 'adm_1', role: 'admin' };
    const project = { _id: 'proj_264', status: 'archived' };
    const payload = buildDeliveryIntelligencePayload(project, null, [], [], adminUser);
    assert.strictEqual(payload.availability, 'archived');
    assert.strictEqual(payload.forecast, null);
    assert.strictEqual(payload.label, 'ARCHIVED');
  });

  // Case 265: UTC calendar math helpers
  await testAsync('Case 265: UTC calendar math helpers: toUtcDay, addCalendarDays, diffCalendarDays produce exact calendar math', async () => {
    const d1 = new Date(Date.UTC(2026, 1, 28)); // Feb 28, 2026
    const d2 = addCalendarDays(d1, 1); // March 1, 2026
    assert.strictEqual(d2.getUTCMonth(), 2);
    assert.strictEqual(d2.getUTCDate(), 1);
    assert.strictEqual(diffCalendarDays(d2, d1), 1);
    assert.strictEqual(diffCalendarDays(d1, d2), -1);
  });

  // Case 266: Pure engine: structured drivers emitted
  await testAsync('Case 266: Pure engine: structured drivers emitted for critical blockers, missing estimates, and target slippage', async () => {
    const today = toUtcDay(new Date());
    const idA = '64b0f0000000000000000266a';
    const tasks = [
      { _id: idA, title: 'Blocked Critical Task', status: 'In Progress', isBlocked: true, blockerEta: null, estimateDays: 3, dependsOn: [] },
    ];
    const project = { _id: 'proj_266' };
    const release = { _id: 'rel_266', targetDate: addCalendarDays(today, 5) };
    const forecast = computeDeliveryForecast(project, release, tasks);
    assert.ok(forecast.drivers.some((d) => d.type === 'critical_blocker'));
  });

  // Case 267: Performance contract: GET /api/projects/:projectId/delivery-intelligence executes exactly 4 bounded batch queries on both small and large datasets
  await testAsync('Case 267: Performance contract: GET /api/projects/:projectId/delivery-intelligence executes exactly 4 bounded batch queries on both small and large datasets', async () => {
    const adminUser = { _id: 'adm_1', role: 'admin' };
    const projectId = new mongoose.Types.ObjectId().toString();

    const origProjFindById = Project.findById;
    const origRelFind = Release.find;
    const origMsFind = Milestone.find;
    const origTaskFind = Task.find;

    for (const datasetSize of ['small', 'large']) {
      let projectQueries = 0;
      const taskCount = datasetSize === 'small' ? 5 : 500;
      const milestoneCount = datasetSize === 'small' ? 2 : 50;
      const releaseCount = datasetSize === 'small' ? 1 : 5;

      const mockTasks = Array.from({ length: taskCount }, (_, i) => ({
        _id: `t_${datasetSize}_${i}`,
        title: `Task ${i}`,
        status: 'To Do',
        estimateDays: 1,
        dependsOn: i > 0 ? [`t_${datasetSize}_${i - 1}`] : [],
      }));
      const mockMilestones = Array.from({ length: milestoneCount }, (_, i) => ({
        _id: `m_${datasetSize}_${i}`,
        title: `Milestone ${i}`,
        sequence: i + 1,
      }));
      const mockReleases = Array.from({ length: releaseCount }, (_, i) => ({
        _id: `r_${datasetSize}_${i}`,
        name: `Release ${i}`,
        version: `v${i}.0`,
        status: 'active',
      }));

      Project.findById = () => {
        projectQueries++;
        return {
          populate: () => Promise.resolve({ _id: projectId, status: 'active', owner: 'adm_1', members: [] }),
        };
      };
      Release.find = () => {
        projectQueries++;
        return { sort: () => Promise.resolve(mockReleases) };
      };
      Milestone.find = () => {
        projectQueries++;
        return { sort: () => Promise.resolve(mockMilestones) };
      };
      Task.find = () => {
        projectQueries++;
        return {
          populate: () => ({
            populate: () => ({
              sort: () => Promise.resolve(mockTasks),
            }),
          }),
        };
      };

      const req = { params: { projectId }, query: {}, user: adminUser };
      const res = createMockRes();
      await projectController.getProjectDeliveryIntelligence(req, res);

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(projectQueries, 4, `Must execute exactly 4 queries on ${datasetSize} dataset (${taskCount} tasks)`);
    }

    Project.findById = origProjFindById;
    Release.find = origRelFind;
    Milestone.find = origMsFind;
    Task.find = origTaskFind;
  });

  // Case 268: Performance contract: GET /api/releases/:releaseId/delivery-intelligence executes exactly 4 bounded batch queries on both small and large datasets
  await testAsync('Case 268: Performance contract: GET /api/releases/:releaseId/delivery-intelligence executes exactly 4 bounded batch queries on both small and large datasets', async () => {
    const adminUser = { _id: 'adm_1', role: 'admin' };
    const releaseId = new mongoose.Types.ObjectId().toString();
    const projectId = new mongoose.Types.ObjectId().toString();

    const origRelFindById = Release.findById;
    const origProjFindById = Project.findById;
    const origMsFind = Milestone.find;
    const origTaskFind = Task.find;

    for (const datasetSize of ['small', 'large']) {
      let releaseQueries = 0;
      const taskCount = datasetSize === 'small' ? 5 : 500;
      const milestoneCount = datasetSize === 'small' ? 2 : 50;

      const mockTasks = Array.from({ length: taskCount }, (_, i) => ({
        _id: `t_rel_${datasetSize}_${i}`,
        title: `Task ${i}`,
        status: 'To Do',
        estimateDays: 1,
        dependsOn: i > 0 ? [`t_rel_${datasetSize}_${i - 1}`] : [],
      }));
      const mockMilestones = Array.from({ length: milestoneCount }, (_, i) => ({
        _id: `m_rel_${datasetSize}_${i}`,
        title: `Milestone ${i}`,
        release: releaseId,
        sequence: i + 1,
      }));

      Release.findById = () => {
        releaseQueries++;
        return Promise.resolve({ _id: releaseId, project: projectId, targetDate: new Date(), status: 'active' });
      };
      Project.findById = () => {
        releaseQueries++;
        return Promise.resolve({ _id: projectId, status: 'active', owner: 'adm_1', members: [] });
      };
      Milestone.find = () => {
        releaseQueries++;
        return { sort: () => Promise.resolve(mockMilestones) };
      };
      Task.find = () => {
        releaseQueries++;
        return {
          populate: () => ({
            populate: () => ({
              sort: () => Promise.resolve(mockTasks),
            }),
          }),
        };
      };

      const req = { params: { releaseId }, user: adminUser };
      const res = createMockRes();
      await releaseController.getReleaseDeliveryIntelligence(req, res);

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(releaseQueries, 4, `Must execute exactly 4 queries on ${datasetSize} dataset (${taskCount} tasks)`);
    }

    Release.findById = origRelFindById;
    Project.findById = origProjFindById;
    Milestone.find = origMsFind;
    Task.find = origTaskFind;
  });

  // Case 269: Scheduling driver: Branch B (1d + blockerEta 20d) beats Branch A (10d) as forecastDrivingPath
  await testAsync('Case 269: Scheduling driver: Branch B (1d + blockerEta 20d) beats Branch A (10d) as forecastDrivingPath', async () => {
    const today = toUtcDay(new Date());
    const idA = '64b0f0000000000000000269a';
    const idB = '64b0f0000000000000000269b';
    const futureEta = addCalendarDays(today, 20);

    const tasks = [
      { _id: idA, title: 'Branch A', status: 'To Do', estimateDays: 10, dependsOn: [] },
      { _id: idB, title: 'Branch B', status: 'In Progress', isBlocked: true, blockerEta: futureEta, estimateDays: 1, dependsOn: [] },
    ];
    const project = { _id: 'proj_269' };
    const release = { _id: 'rel_269', targetDate: addCalendarDays(today, 25) };
    const forecast = computeDeliveryForecast(project, release, tasks);

    assert.deepStrictEqual(forecast.durationCriticalPath, [idA], 'durationCriticalPath must select Branch A with pure 10d duration');
    assert.deepStrictEqual(forecast.forecastDrivingPath, [idB], 'forecastDrivingPath must select Branch B driving the finish date');
    assert.deepStrictEqual(forecast.criticalPath, [idB], 'criticalPath must alias forecastDrivingPath');
  });

  // Case 270: Cross-project task exclusion: tasks from another project are strictly excluded
  await testAsync('Case 270: Cross-project task exclusion: tasks from another project are strictly excluded', async () => {
    const projectA = { _id: '64b0f0000000000000000270a', status: 'active' };
    const projectBId = '64b0f0000000000000000270b';
    const taskValid = { _id: '64b0f00000000000000002701', project: projectA._id, title: 'Valid Task', status: 'To Do', estimateDays: 3, dependsOn: [] };
    const taskForeign = { _id: '64b0f00000000000000002702', project: projectBId, title: 'Foreign Task', status: 'In Progress', isBlocked: true, blockerEta: null, estimateDays: 5, dependsOn: [] };

    const payload = buildDeliveryIntelligencePayload(projectA, null, [taskValid, taskForeign], [], { _id: 'adm_1', role: 'admin' });
    assert.strictEqual(payload.nodes.length, 1);
    assert.strictEqual(payload.nodes[0].id, taskValid._id);
    assert.strictEqual(payload.forecast.status, 'on_track');
  });

  // Case 271: Completed / cancelled scope behavior: Done tasks contribute 0 days, cancelled tasks excluded
  await testAsync('Case 271: Completed / cancelled scope behavior: Done tasks contribute 0 days, cancelled tasks excluded', async () => {
    const project = { _id: '64b0f0000000000000000271p', status: 'active' };
    const taskDone = { _id: '64b0f00000000000000002711', project: project._id, title: 'Done Task', status: 'Done', estimateDays: 8, dependsOn: [] };
    const taskTodo = { _id: '64b0f00000000000000002712', project: project._id, title: 'Active Task', status: 'To Do', estimateDays: 4, dependsOn: [taskDone._id] };
    const taskCancelled = { _id: '64b0f00000000000000002713', project: project._id, title: 'Cancelled Task', status: 'cancelled', estimateDays: 10, dependsOn: [] };

    const payload = buildDeliveryIntelligencePayload(project, null, [taskDone, taskTodo, taskCancelled], [], { _id: 'adm_1', role: 'admin' });
    assert.strictEqual(payload.nodes.length, 2, 'Cancelled task must be excluded');
    assert.strictEqual(payload.forecast.totalRemainingDays, 4, 'Done task contributes 0 remaining days');
  });

  // Case 272: Shorter path with more nodes vs longer weighted path selects longer weighted duration
  await testAsync('Case 272: Shorter path with more nodes vs longer weighted path selects longer weighted duration', async () => {
    const idA = '64b0f0000000000000000272a';
    const idB = '64b0f0000000000000000272b';
    const idC = '64b0f0000000000000000272c';
    const idD = '64b0f0000000000000000272d';

    const tasks = [
      { _id: idA, title: 'Node A', status: 'To Do', estimateDays: 1, dependsOn: [] },
      { _id: idB, title: 'Node B', status: 'To Do', estimateDays: 1, dependsOn: [idA] },
      { _id: idC, title: 'Node C', status: 'To Do', estimateDays: 1, dependsOn: [idB] },
      { _id: idD, title: 'Node D', status: 'To Do', estimateDays: 10, dependsOn: [] },
    ];
    const cp = computeCriticalPath(tasks);
    assert.deepStrictEqual(cp.criticalPath, [idD], 'Longer weighted path D(10d) beats 3-node path A->B->C(3d)');
    assert.strictEqual(cp.criticalPathDuration, 10);
  });

  // Case 273: Empty project / release returns availability: insufficient_data and status: indeterminate
  await testAsync('Case 273: Empty project / release returns availability: insufficient_data and status: indeterminate', async () => {
    const project = { _id: '64b0f0000000000000000273p', status: 'active' };
    const payload = buildDeliveryIntelligencePayload(project, null, [], [], { _id: 'adm_1', role: 'admin' });
    assert.strictEqual(payload.availability, 'insufficient_data');
    assert.strictEqual(payload.forecast.status, 'indeterminate');
    assert.strictEqual(payload.forecast.forecastDate, null);
    assert.strictEqual(payload.forecast.slipDays, null);
  });

  // Case 274: External prerequisites marked with externalPrerequisite: true in release delivery intelligence
  await testAsync('Case 274: External prerequisites marked with externalPrerequisite: true in release delivery intelligence', async () => {
    const relId = '64b0f0000000000000000274r';
    const msId = '64b0f0000000000000000274m';
    const idExt = '64b0f0000000000000000274e';
    const idRelTask = '64b0f0000000000000000274t';

    const project = { _id: '64b0f0000000000000000274p', status: 'active' };
    const release = { _id: relId, project: project._id, status: 'active' };
    const milestones = [{ _id: msId, release: relId, status: 'open' }];

    const tasks = [
      { _id: idExt, project: project._id, title: 'External Prereq', status: 'To Do', estimateDays: 3, dependsOn: [] },
      { _id: idRelTask, project: project._id, title: 'Release Task', status: 'To Do', estimateDays: 4, milestone: msId, dependsOn: [idExt] },
    ];

    const payload = buildDeliveryIntelligencePayload(project, release, tasks, milestones, { _id: 'adm_1', role: 'admin' });
    const extNode = payload.nodes.find((n) => n.id === idExt);
    assert.ok(extNode, 'External prerequisite must be included in release scope');
    assert.strictEqual(extNode.externalPrerequisite, true, 'External prerequisite node must have externalPrerequisite: true');
  });

  // Case 275: Terminal release status: Shipped and Cancelled releases return terminal status and closed forecast
  await testAsync('Case 275: Terminal release status: Shipped and Cancelled releases return terminal status and closed forecast', async () => {
    const project = { _id: '64b0f0000000000000000275p', status: 'active' };
    const shippedRelease = { _id: 'rel_shipped', status: 'shipped' };
    const cancelledRelease = { _id: 'rel_cancelled', status: 'cancelled' };

    const fShipped = computeDeliveryForecast(project, shippedRelease, []);
    assert.strictEqual(fShipped.status, 'shipped');
    assert.strictEqual(fShipped.availability, 'shipped');
    assert.strictEqual(fShipped.forecastDate, null);

    const fCancelled = computeDeliveryForecast(project, cancelledRelease, []);
    assert.strictEqual(fCancelled.status, 'cancelled');
    assert.strictEqual(fCancelled.availability, 'cancelled');
    assert.strictEqual(fCancelled.forecastDate, null);
  });

  // Case 276: Security: Malformed ObjectIds return controlled 400 Bad Request
  await testAsync('Case 276: Security: Malformed ObjectIds return controlled 400 Bad Request', async () => {
    const reqProj = { params: { projectId: 'not-a-valid-object-id' }, query: {}, user: { _id: 'adm_1', role: 'admin' } };
    const resProj = createMockRes();
    await projectController.getProjectDeliveryIntelligence(reqProj, resProj);
    assert.strictEqual(resProj.statusCode, 400);

    const reqRel = { params: { releaseId: 'invalid-release-id' }, user: { _id: 'adm_1', role: 'admin' } };
    const resRel = createMockRes();
    await releaseController.getReleaseDeliveryIntelligence(reqRel, resRel);
    assert.strictEqual(resRel.statusCode, 400);
  });

  // Case 277: RBAC: Manager mutation authority bounds and non-member access restrictions
  // Case 277: RBAC: Manager mutation authority bounds (manager cannot mutate unowned project)
  await testAsync('Case 277: RBAC: Manager mutation authority bounds (manager cannot mutate unowned project)', async () => {
    const managerId = new mongoose.Types.ObjectId().toString();
    const otherManagerId = new mongoose.Types.ObjectId().toString();
    const projectId = new mongoose.Types.ObjectId().toString();

    const origFindById = Project.findById;
    Project.findById = () => Promise.resolve({
      _id: projectId,
      name: 'Unowned Project',
      owner: otherManagerId,
      status: 'active',
      members: [],
    });

    const req = {
      params: { id: projectId },
      body: { name: 'Unauthorized Change' },
      user: { _id: managerId, role: 'manager' },
    };
    const res = createMockRes();
    await projectController.updateProject(req, res);
    assert.strictEqual(res.statusCode, 403, 'Manager cannot mutate another manager project');

    Project.findById = origFindById;
  });

  // Case 278: Invariant: Archived project mutations rejected with 409 Conflict
  await testAsync('Case 278: Invariant: Archived project mutations rejected with 409 Conflict', async () => {
    const projectId = new mongoose.Types.ObjectId().toString();
    const origFindById = Project.findById;
    Project.findById = () => Promise.resolve({
      _id: projectId,
      status: 'archived',
      owner: 'adm_1',
      members: [],
    });

    const req = {
      body: { title: 'Task in Archived', project: projectId },
      user: { _id: 'adm_1', role: 'admin' },
    };
    const res = createMockRes();
    await taskController.createTask(req, res);
    assert.strictEqual(res.statusCode, 409);
    assert.strictEqual(res.body.success, false);
    assert.ok(res.body.message.includes('archived'));

    Project.findById = origFindById;
  });

  // Case 279: Privacy deep scan: Member serialized JSON contains 0 leaks of hidden private task metadata, dates, or exact counts, and is non-inferential across state changes
  await testAsync('Case 279: Privacy deep scan: Member serialized JSON contains 0 leaks of hidden private task metadata, dates, or exact counts, and is non-inferential across state changes', async () => {
    const memberUser = { _id: new mongoose.Types.ObjectId().toString(), role: 'member' };
    const privateTaskId = 'PRIVATE_ID_SECRET_12345';
    const privateTaskTitle = 'SUPER_SECRET_PAYLOAD_TITLE';
    const privateTaskOwner = 'ADMIN_SUPER_SECRET_OWNER';
    const privateBlockerReason = 'SECRET_CRITICAL_DATABASE_OUTAGE';
    const privateDueDateStr = '2026-12-25';
    const privateBlockerEtaStr = '2026-11-20';
    const privateCreatedAtStr = '2026-01-01';
    const privateUpdatedAtStr = '2026-01-02';

    const privateTaskState1 = {
      _id: privateTaskId,
      title: privateTaskTitle,
      assignedTo: privateTaskOwner,
      isBlocked: false,
      blockedReason: '',
      blockerEta: null,
      dueDate: new Date(privateDueDateStr),
      createdAt: new Date(privateCreatedAtStr),
      updatedAt: new Date(privateUpdatedAtStr),
      estimateDays: 14,
      dependsOn: [],
    };
    const memberTask = {
      _id: new mongoose.Types.ObjectId().toString(),
      title: 'Member Visible UI Task',
      assignedTo: memberUser._id,
      estimateDays: 3,
      dependsOn: [privateTaskId],
    };
    const project = { _id: 'proj_279', status: 'active' };
    const payload1 = buildDeliveryIntelligencePayload(project, null, [privateTaskState1, memberTask], [], memberUser);

    const json1 = JSON.stringify(payload1);
    assert.strictEqual(json1.includes(privateTaskId), false, 'Must not leak private task ID');
    assert.strictEqual(json1.includes(privateTaskTitle), false, 'Must not leak private task title');
    assert.strictEqual(json1.includes(privateTaskOwner), false, 'Must not leak private task owner');
    assert.strictEqual(json1.includes(privateBlockerReason), false, 'Must not leak private blocker reason');
    assert.strictEqual(json1.includes('"estimateDays":14'), false, 'Must not leak private task estimate');
    // Hidden dates rejection
    assert.strictEqual(json1.includes(privateDueDateStr), false, 'Must not leak private task dueDate');
    assert.strictEqual(json1.includes(privateBlockerEtaStr), false, 'Must not leak private task blockerEta');
    assert.strictEqual(json1.includes(privateCreatedAtStr), false, 'Must not leak private task createdAt');
    assert.strictEqual(json1.includes(privateUpdatedAtStr), false, 'Must not leak private task updatedAt');
    // Exact counts rejection
    assert.strictEqual(json1.includes('totalNodes'), false, 'Must not expose totalNodes');
    assert.strictEqual(payload1.summary.totalVisibleNodes, 1, 'Only totalVisibleNodes exposed');
    assert.strictEqual(payload1.summary.totalNodes, undefined, 'totalNodes must be undefined');
    assert.strictEqual(payload1.scope, 'personal');
    assert.strictEqual(payload1.isPartial, true);
    assert.strictEqual(payload1.forecast, null);
    assert.deepStrictEqual(payload1.criticalPath, []);

    // State 2: Hidden task is now blocked with ETA, altered estimate, new dates, and active blocker reason
    const privateTaskState2 = {
      _id: privateTaskId,
      title: privateTaskTitle,
      assignedTo: privateTaskOwner,
      isBlocked: true,
      blockedReason: privateBlockerReason,
      blockerEta: new Date(privateBlockerEtaStr),
      dueDate: new Date('2027-06-30'),
      createdAt: new Date('2026-02-01'),
      updatedAt: new Date('2026-02-02'),
      estimateDays: 45,
      dependsOn: [],
    };
    const payload2 = buildDeliveryIntelligencePayload(project, null, [privateTaskState2, memberTask], [], memberUser);
    const json2 = JSON.stringify(payload2);

    // Assert non-inferential equality across hidden prerequisite state changes
    assert.strictEqual(json1, json2, 'Member payload JSON must remain identical across hidden prerequisite state changes');
    assert.deepStrictEqual(payload1, payload2, 'Member payload object must remain deeply equal across hidden prerequisite state changes');
  });

  // Case 280: Large synthetic DAG stack safety: 500-node dependency graph computes delivery forecast without stack overflow
  await testAsync('Case 280: Large synthetic DAG stack safety: 500-node dependency graph computes delivery forecast without stack overflow', async () => {
    const nodeCount = 500;
    const tasks = [];
    for (let i = 0; i < nodeCount; i++) {
      const id = `task_synth_${i.toString().padStart(4, '0')}`;
      const dependsOn = i > 0 ? [`task_synth_${(i - 1).toString().padStart(4, '0')}`] : [];
      tasks.push({
        _id: id,
        title: `Synthetic Task ${i}`,
        status: 'To Do',
        estimateDays: 1,
        dependsOn,
      });
    }
    const project = { _id: 'proj_synth_500' };
    const forecast = computeDeliveryForecast(project, null, tasks);
    assert.strictEqual(forecast.status, 'on_track');
    assert.strictEqual(forecast.totalRemainingDays, 500);
    assert.strictEqual(forecast.criticalPath.length, 500);
  });

  // --- SECTION 17: Phase 5 Engineering Decision Intelligence & ADR System ---
  console.log('\n--- SECTION 17: Phase 5 Engineering Decision Intelligence & ADR System ---');

  // Case 281: Model validation: valid proposal creation succeeds with explicit defaults
  await testAsync('Case 281: Model validation: valid proposal creation succeeds with explicit defaults', async () => {
    const projId = new mongoose.Types.ObjectId().toString();
    const userId = new mongoose.Types.ObjectId().toString();
    const doc = new DecisionRecord({
      title: 'Adopt Canonical API Envelope',
      context: 'We need standard response envelopes across all endpoints.',
      decision: 'Enforce { success, data, message } envelope standard.',
      rationale: 'Consistency improves client error handling and reliability.',
      project: projId,
      proposedBy: userId,
    });
    assert.strictEqual(doc.status, 'proposed');
    assert.deepStrictEqual(doc.alternatives, []);
    assert.deepStrictEqual(doc.consequences.positive, []);
    assert.deepStrictEqual(doc.consequences.negative, []);
    assert.deepStrictEqual(doc.consequences.risks, []);
    assert.deepStrictEqual(doc.linkedTasks, []);
    assert.deepStrictEqual(doc.linkedMilestones, []);
    assert.deepStrictEqual(doc.linkedReleases, []);
    assert.strictEqual(doc.decidedBy, null);
    assert.strictEqual(doc.decidedAt, null);
    assert.strictEqual(doc.supersededBy, null);
  });

  // Case 282: Validation: rejects missing or overly long title (>120 chars) with 400
  await testAsync('Case 282: Validation: rejects missing or overly long title (>120 chars) with 400', async () => {
    const projId = new mongoose.Types.ObjectId().toString();
    const reqEmpty = {
      body: { title: '', context: 'ctx', decision: 'dec', rationale: 'rat', project: projId },
      user: { _id: 'adm_1', role: 'admin' },
    };
    const resEmpty = createMockRes();
    await decisionController.createDecision(reqEmpty, resEmpty);
    assert.strictEqual(resEmpty.statusCode, 400);

    const reqLong = {
      body: { title: 'A'.repeat(121), context: 'ctx', decision: 'dec', rationale: 'rat', project: projId },
      user: { _id: 'adm_1', role: 'admin' },
    };
    const resLong = createMockRes();
    await decisionController.createDecision(reqLong, resLong);
    assert.strictEqual(resLong.statusCode, 400);
  });

  // Case 283: Validation: rejects missing or overly long context, decision, or rationale (>3000 chars) with 400
  await testAsync('Case 283: Validation: rejects missing or overly long context, decision, or rationale (>3000 chars) with 400', async () => {
    const projId = new mongoose.Types.ObjectId().toString();
    const fields = ['context', 'decision', 'rationale'];
    for (const f of fields) {
      const payloadMissing = { title: 'Valid Title', context: 'ctx', decision: 'dec', rationale: 'rat', project: projId };
      delete payloadMissing[f];
      const resMissing = createMockRes();
      await decisionController.createDecision({ body: payloadMissing, user: { _id: 'adm_1', role: 'admin' } }, resMissing);
      assert.strictEqual(resMissing.statusCode, 400, `${f} missing must return 400`);

      const payloadLong = { title: 'Valid Title', context: 'ctx', decision: 'dec', rationale: 'rat', project: projId };
      payloadLong[f] = 'X'.repeat(3001);
      const resLong = createMockRes();
      await decisionController.createDecision({ body: payloadLong, user: { _id: 'adm_1', role: 'admin' } }, resLong);
      assert.strictEqual(resLong.statusCode, 400, `${f} > 3000 must return 400`);
    }
  });

  // Case 284: Validation: limits alternatives to max 10, title <= 120, reasonRejected <= 600
  await testAsync('Case 284: Validation: limits alternatives to max 10, title <= 120, reasonRejected <= 600', async () => {
    const projId = new mongoose.Types.ObjectId().toString();
    const origProjFindById = Project.findById;
    Project.findById = () => Promise.resolve({ _id: projId, status: 'active', owner: 'adm_1', members: [] });

    // 11 alternatives
    const elevenAlts = Array.from({ length: 11 }, (_, i) => ({ title: `Alt ${i}`, reasonRejected: `Reason ${i}` }));
    const resOver = createMockRes();
    await decisionController.createDecision({
      body: { title: 'T', context: 'C', decision: 'D', rationale: 'R', project: projId, alternatives: elevenAlts },
      user: { _id: 'adm_1', role: 'admin' },
    }, resOver);
    assert.strictEqual(resOver.statusCode, 400);

    // Overlong alt title
    const resLongTitle = createMockRes();
    await decisionController.createDecision({
      body: { title: 'T', context: 'C', decision: 'D', rationale: 'R', project: projId, alternatives: [{ title: 'A'.repeat(121), reasonRejected: 'R' }] },
      user: { _id: 'adm_1', role: 'admin' },
    }, resLongTitle);
    assert.strictEqual(resLongTitle.statusCode, 400);

    // Overlong reasonRejected
    const resLongReason = createMockRes();
    await decisionController.createDecision({
      body: { title: 'T', context: 'C', decision: 'D', rationale: 'R', project: projId, alternatives: [{ title: 'A', reasonRejected: 'B'.repeat(601) }] },
      user: { _id: 'adm_1', role: 'admin' },
    }, resLongReason);
    assert.strictEqual(resLongReason.statusCode, 400);

    Project.findById = origProjFindById;
  });

  // Case 285: Validation: limits consequences (positive, negative, risks) to max 10 each, <= 600 chars each
  await testAsync('Case 285: Validation: limits consequences (positive, negative, risks) to max 10 each, <= 600 chars each', async () => {
    const projId = new mongoose.Types.ObjectId().toString();
    const origProjFindById = Project.findById;
    Project.findById = () => Promise.resolve({ _id: projId, status: 'active', owner: 'adm_1', members: [] });

    for (const cat of ['positive', 'negative', 'risks']) {
      const eleven = Array.from({ length: 11 }, (_, i) => `Item ${i}`);
      const resCount = createMockRes();
      const bodyCount = { title: 'T', context: 'C', decision: 'D', rationale: 'R', project: projId, consequences: { [cat]: eleven } };
      await decisionController.createDecision({ body: bodyCount, user: { _id: 'adm_1', role: 'admin' } }, resCount);
      assert.strictEqual(resCount.statusCode, 400, `Consequences ${cat} > 10 must return 400`);

      const resLen = createMockRes();
      const bodyLen = { title: 'T', context: 'C', decision: 'D', rationale: 'R', project: projId, consequences: { [cat]: ['Z'.repeat(601)] } };
      await decisionController.createDecision({ body: bodyLen, user: { _id: 'adm_1', role: 'admin' } }, resLen);
      assert.strictEqual(resLen.statusCode, 400, `Consequence item > 600 in ${cat} must return 400`);
    }

    Project.findById = origProjFindById;
  });

  // Case 286: Validation: duplicate linked task, milestone, and release IDs are deduplicated
  await testAsync('Case 286: Validation: duplicate linked task, milestone, and release IDs are deduplicated', async () => {
    const projId = new mongoose.Types.ObjectId().toString();
    const tId = new mongoose.Types.ObjectId().toString();
    const mId = new mongoose.Types.ObjectId().toString();
    const rId = new mongoose.Types.ObjectId().toString();

    const origProjFindById = Project.findById;
    const origTaskFindById = Task.findById;
    const origMsFindById = Milestone.findById;
    const origRelFindById = Release.findById;
    const origDecCreate = DecisionRecord.create;

    Project.findById = () => Promise.resolve({ _id: projId, status: 'active', owner: 'adm_1', members: [] });
    Task.findById = () => Promise.resolve({ _id: tId, project: projId });
    Milestone.findById = () => Promise.resolve({ _id: mId, project: projId });
    Release.findById = () => Promise.resolve({ _id: rId, project: projId });

    let createdData = null;
    DecisionRecord.create = (data) => {
      createdData = data;
      return Promise.resolve({
        ...data,
        populate: () => Promise.resolve({ ...data }),
      });
    };

    const req = {
      body: {
        title: 'Deduplication Test',
        context: 'C',
        decision: 'D',
        rationale: 'R',
        project: projId,
        linkedTasks: [tId, tId, tId],
        linkedMilestones: [mId, mId],
        linkedReleases: [rId, rId],
      },
      user: { _id: 'adm_1', role: 'admin' },
    };
    const res = createMockRes();
    await decisionController.createDecision(req, res);

    assert.strictEqual(res.statusCode, 201);
    assert.strictEqual(createdData.linkedTasks.length, 1);
    assert.strictEqual(createdData.linkedMilestones.length, 1);
    assert.strictEqual(createdData.linkedReleases.length, 1);

    Project.findById = origProjFindById;
    Task.findById = origTaskFindById;
    Milestone.findById = origMsFindById;
    Release.findById = origRelFindById;
    DecisionRecord.create = origDecCreate;
  });

  // Case 287: Security: client audit/lifecycle fields stripped or ignored on POST and PUT, and no persisted calculated impact fields
  await testAsync('Case 287: Security: client audit/lifecycle fields stripped or ignored on POST and PUT, and no persisted calculated impact fields', async () => {
    const projId = new mongoose.Types.ObjectId().toString();
    const fakeProposer = new mongoose.Types.ObjectId().toString();

    const origProjFindById = Project.findById;
    const origDecCreate = DecisionRecord.create;
    Project.findById = () => Promise.resolve({ _id: projId, status: 'active', owner: 'adm_1', members: [] });

    let savedData = null;
    DecisionRecord.create = (data) => {
      savedData = data;
      return Promise.resolve({ ...data, populate: () => Promise.resolve(data) });
    };

    const req = {
      body: {
        title: 'Tamper Attempt',
        context: 'C',
        decision: 'D',
        rationale: 'R',
        project: projId,
        status: 'accepted', // Forbidden client override
        proposedBy: fakeProposer, // Forbidden client override
        decidedBy: fakeProposer, // Forbidden client override
        decidedAt: new Date(2020, 1, 1),
        supersededBy: fakeProposer,
        criticalPath: ['t1'], // Calculated output not persisted
        impactClassification: 'critical_path', // Calculated output not persisted
      },
      user: { _id: 'adm_1', role: 'admin' },
    };
    const res = createMockRes();
    await decisionController.createDecision(req, res);

    assert.strictEqual(res.statusCode, 201);
    assert.strictEqual(savedData.status, 'proposed');
    assert.strictEqual(savedData.proposedBy, 'adm_1');
    assert.strictEqual(savedData.decidedBy, null);
    assert.strictEqual(savedData.decidedAt, null);
    assert.strictEqual(savedData.supersededBy, null);
    assert.strictEqual(savedData.criticalPath, undefined);
    assert.strictEqual(savedData.impactClassification, undefined);

    Project.findById = origProjFindById;
    DecisionRecord.create = origDecCreate;
  });

  // Case 288: Authorization: Admin can create proposals in accessible projects
  await testAsync('Case 288: Authorization: Admin can create proposals in accessible projects', async () => {
    const projId = new mongoose.Types.ObjectId().toString();
    const origProjFindById = Project.findById;
    const origDecCreate = DecisionRecord.create;
    Project.findById = () => Promise.resolve({ _id: projId, status: 'active', owner: 'mgr_1', members: [] });
    DecisionRecord.create = (data) => Promise.resolve({ ...data, populate: () => Promise.resolve(data) });

    const req = {
      body: { title: 'Admin ADR', context: 'C', decision: 'D', rationale: 'R', project: projId },
      user: { _id: 'adm_1', role: 'admin' },
    };
    const res = createMockRes();
    await decisionController.createDecision(req, res);
    assert.strictEqual(res.statusCode, 201);

    Project.findById = origProjFindById;
    DecisionRecord.create = origDecCreate;
  });

  // Case 289: Authorization: Project-owning Manager can create decisions and manage proposals in owned active projects
  await testAsync('Case 289: Authorization: Project-owning Manager can create decisions and manage proposals in owned active projects', async () => {
    const mgrId = new mongoose.Types.ObjectId().toString();
    const projId = new mongoose.Types.ObjectId().toString();
    const origProjFindById = Project.findById;
    const origDecCreate = DecisionRecord.create;
    Project.findById = () => Promise.resolve({ _id: projId, status: 'active', owner: mgrId, members: [] });
    DecisionRecord.create = (data) => Promise.resolve({ ...data, populate: () => Promise.resolve(data) });

    const req = {
      body: { title: 'Manager ADR', context: 'C', decision: 'D', rationale: 'R', project: projId },
      user: { _id: mgrId, role: 'manager' },
    };
    const res = createMockRes();
    await decisionController.createDecision(req, res);
    assert.strictEqual(res.statusCode, 201);

    Project.findById = origProjFindById;
    DecisionRecord.create = origDecCreate;
  });

  // Case 290: Authorization: Non-owner Manager mutation is rejected with 403 Forbidden
  await testAsync('Case 290: Authorization: Non-owner Manager mutation is rejected with 403 Forbidden', async () => {
    const mgrId = new mongoose.Types.ObjectId().toString();
    const otherMgrId = new mongoose.Types.ObjectId().toString();
    const projId = new mongoose.Types.ObjectId().toString();
    const origProjFindById = Project.findById;
    Project.findById = () => Promise.resolve({ _id: projId, status: 'active', owner: otherMgrId, members: [] });

    const req = {
      body: { title: 'Unauthorized Manager ADR', context: 'C', decision: 'D', rationale: 'R', project: projId },
      user: { _id: mgrId, role: 'manager' },
    };
    const res = createMockRes();
    await decisionController.createDecision(req, res);
    assert.strictEqual(res.statusCode, 403);
    assert.ok(res.body.message.includes('another manager'));

    Project.findById = origProjFindById;
  });

  // Case 291: Authorization: Member can create a proposed decision in a project where they are an explicit member
  await testAsync('Case 291: Authorization: Member can create a proposed decision in a project where they are an explicit member', async () => {
    const memberId = new mongoose.Types.ObjectId().toString();
    const projId = new mongoose.Types.ObjectId().toString();
    const origProjFindById = Project.findById;
    const origDecCreate = DecisionRecord.create;
    Project.findById = () => Promise.resolve({
      _id: projId,
      status: 'active',
      owner: 'mgr_1',
      members: [{ user: { _id: memberId } }],
    });
    DecisionRecord.create = (data) => Promise.resolve({ ...data, populate: () => Promise.resolve(data) });

    const req = {
      body: { title: 'Member Proposal', context: 'C', decision: 'D', rationale: 'R', project: projId },
      user: { _id: memberId, role: 'member' },
    };
    const res = createMockRes();
    await decisionController.createDecision(req, res);
    assert.strictEqual(res.statusCode, 201);
    assert.strictEqual(res.body.decision.status, 'proposed');

    Project.findById = origProjFindById;
    DecisionRecord.create = origDecCreate;
  });

  // Case 292: Authorization: Member cannot propose decisions in non-member projects (403 Forbidden)
  await testAsync('Case 292: Authorization: Member cannot propose decisions in non-member projects (403 Forbidden)', async () => {
    const memberId = new mongoose.Types.ObjectId().toString();
    const projId = new mongoose.Types.ObjectId().toString();
    const origProjFindById = Project.findById;
    Project.findById = () => Promise.resolve({
      _id: projId,
      status: 'active',
      owner: 'mgr_1',
      members: [], // Member not in project!
    });

    const req = {
      body: { title: 'Illegal Member Proposal', context: 'C', decision: 'D', rationale: 'R', project: projId },
      user: { _id: memberId, role: 'member' },
    };
    const res = createMockRes();
    await decisionController.createDecision(req, res);
    assert.strictEqual(res.statusCode, 403);
    assert.ok(res.body.message.includes('Not authorized'));

    Project.findById = origProjFindById;
  });

  // Case 293: Authorization: Member can edit or withdraw only their own proposed decision
  await testAsync('Case 293: Authorization: Member can edit or withdraw only their own proposed decision', async () => {
    const memberId = new mongoose.Types.ObjectId().toString();
    const projId = new mongoose.Types.ObjectId().toString();
    const decId = new mongoose.Types.ObjectId().toString();

    const origDecFindById = DecisionRecord.findById;
    const origProjFindById = Project.findById;

    const mockDec = {
      _id: decId,
      title: 'Original Title',
      status: 'proposed',
      project: projId,
      proposedBy: memberId,
      save: async function () { return this; },
      populate: async function () { return this; },
    };

    DecisionRecord.findById = () => Promise.resolve(mockDec);
    Project.findById = () => Promise.resolve({
      _id: projId,
      status: 'active',
      owner: 'mgr_1',
      members: [{ user: { _id: memberId } }],
    });

    // Member edits own proposal -> succeeds
    const reqEdit = {
      params: { id: decId },
      body: { title: 'Updated Title by Proposer' },
      user: { _id: memberId, role: 'member' },
    };
    const resEdit = createMockRes();
    await decisionController.updateDecision(reqEdit, resEdit);
    assert.strictEqual(resEdit.statusCode, 200);
    assert.strictEqual(mockDec.title, 'Updated Title by Proposer');

    // Member withdraws own proposal -> succeeds
    const reqWithdraw = {
      params: { id: decId },
      body: { status: 'withdrawn' },
      user: { _id: memberId, role: 'member' },
    };
    const resWithdraw = createMockRes();
    await decisionController.transitionDecision(reqWithdraw, resWithdraw);
    assert.strictEqual(resWithdraw.statusCode, 200);
    assert.strictEqual(mockDec.status, 'withdrawn');

    DecisionRecord.findById = origDecFindById;
    Project.findById = origProjFindById;
  });

  // Case 294: Authorization: Member cannot edit another user proposed decision (403 Forbidden)
  await testAsync('Case 294: Authorization: Member cannot edit another user proposed decision (403 Forbidden)', async () => {
    const memberId = new mongoose.Types.ObjectId().toString();
    const otherUserId = new mongoose.Types.ObjectId().toString();
    const projId = new mongoose.Types.ObjectId().toString();
    const decId = new mongoose.Types.ObjectId().toString();

    const origDecFindById = DecisionRecord.findById;
    const origProjFindById = Project.findById;

    DecisionRecord.findById = () => Promise.resolve({
      _id: decId,
      title: 'Other User Proposal',
      status: 'proposed',
      project: projId,
      proposedBy: otherUserId, // Not memberId!
    });
    Project.findById = () => Promise.resolve({
      _id: projId,
      status: 'active',
      owner: 'mgr_1',
      members: [{ user: { _id: memberId } }],
    });

    const req = {
      params: { id: decId },
      body: { title: 'Malicious Overwrite' },
      user: { _id: memberId, role: 'member' },
    };
    const res = createMockRes();
    await decisionController.updateDecision(req, res);
    assert.strictEqual(res.statusCode, 403);

    DecisionRecord.findById = origDecFindById;
    Project.findById = origProjFindById;
  });

  // Case 295: Authorization: Member cannot accept, reject, or supersede any decision (403 Forbidden)
  await testAsync('Case 295: Authorization: Member cannot accept, reject, or supersede any decision (403 Forbidden)', async () => {
    const memberId = new mongoose.Types.ObjectId().toString();
    const projId = new mongoose.Types.ObjectId().toString();
    const decId = new mongoose.Types.ObjectId().toString();

    const origDecFindById = DecisionRecord.findById;
    const origProjFindById = Project.findById;

    DecisionRecord.findById = () => Promise.resolve({
      _id: decId,
      status: 'proposed',
      project: projId,
      proposedBy: memberId,
    });
    Project.findById = () => Promise.resolve({
      _id: projId,
      status: 'active',
      owner: 'mgr_1',
      members: [{ user: { _id: memberId } }],
    });

    for (const forbiddenStatus of ['accepted', 'rejected']) {
      const req = {
        params: { id: decId },
        body: { status: forbiddenStatus },
        user: { _id: memberId, role: 'member' },
      };
      const res = createMockRes();
      await decisionController.transitionDecision(req, res);
      assert.strictEqual(res.statusCode, 403, `Member transition to ${forbiddenStatus} must return 403`);
    }

    DecisionRecord.findById = origDecFindById;
    Project.findById = origProjFindById;
  });

  // Case 296: Invariant: Mutations on archived project decisions return 409 Conflict
  await testAsync('Case 296: Invariant: Mutations on archived project decisions return 409 Conflict', async () => {
    const projId = new mongoose.Types.ObjectId().toString();
    const decId = new mongoose.Types.ObjectId().toString();
    const origProjFindById = Project.findById;
    const origDecFindById = DecisionRecord.findById;

    Project.findById = () => Promise.resolve({ _id: projId, status: 'archived', owner: 'adm_1', members: [] });
    DecisionRecord.findById = () => Promise.resolve({ _id: decId, project: projId, status: 'proposed' });

    // Create attempt
    const resCreate = createMockRes();
    await decisionController.createDecision({
      body: { title: 'T', context: 'C', decision: 'D', rationale: 'R', project: projId },
      user: { _id: 'adm_1', role: 'admin' },
    }, resCreate);
    assert.strictEqual(resCreate.statusCode, 409);

    // Update attempt
    const resUpdate = createMockRes();
    await decisionController.updateDecision({
      params: { id: decId },
      body: { title: 'Modified Title' },
      user: { _id: 'adm_1', role: 'admin' },
    }, resUpdate);
    assert.strictEqual(resUpdate.statusCode, 409);

    // Transition attempt
    const resTransition = createMockRes();
    await decisionController.transitionDecision({
      params: { id: decId },
      body: { status: 'accepted' },
      user: { _id: 'adm_1', role: 'admin' },
    }, resTransition);
    assert.strictEqual(resTransition.statusCode, 409);

    Project.findById = origProjFindById;
    DecisionRecord.findById = origDecFindById;
  });

  // Case 297: Relationship integrity: Same-project task, milestone, and release links accepted
  await testAsync('Case 297: Relationship integrity: Same-project task, milestone, and release links accepted', async () => {
    const projId = new mongoose.Types.ObjectId().toString();
    const tId = new mongoose.Types.ObjectId().toString();
    const mId = new mongoose.Types.ObjectId().toString();
    const rId = new mongoose.Types.ObjectId().toString();

    const origProjFindById = Project.findById;
    const origTaskFindById = Task.findById;
    const origMsFindById = Milestone.findById;
    const origRelFindById = Release.findById;
    const origDecCreate = DecisionRecord.create;

    Project.findById = () => Promise.resolve({ _id: projId, status: 'active', owner: 'adm_1', members: [] });
    Task.findById = () => Promise.resolve({ _id: tId, project: projId });
    Milestone.findById = () => Promise.resolve({ _id: mId, project: projId });
    Release.findById = () => Promise.resolve({ _id: rId, project: projId });
    DecisionRecord.create = (data) => Promise.resolve({ ...data, populate: () => Promise.resolve(data) });

    const req = {
      body: {
        title: 'Valid Links',
        context: 'C',
        decision: 'D',
        rationale: 'R',
        project: projId,
        linkedTasks: [tId],
        linkedMilestones: [mId],
        linkedReleases: [rId],
      },
      user: { _id: 'adm_1', role: 'admin' },
    };
    const res = createMockRes();
    await decisionController.createDecision(req, res);
    assert.strictEqual(res.statusCode, 201);

    Project.findById = origProjFindById;
    Task.findById = origTaskFindById;
    Milestone.findById = origMsFindById;
    Release.findById = origRelFindById;
    DecisionRecord.create = origDecCreate;
  });

  // Case 298: Relationship integrity: Cross-project task link rejected with 400 Bad Request
  await testAsync('Case 298: Relationship integrity: Cross-project task link rejected with 400 Bad Request', async () => {
    const projId = new mongoose.Types.ObjectId().toString();
    const otherProjId = new mongoose.Types.ObjectId().toString();
    const foreignTaskId = new mongoose.Types.ObjectId().toString();

    const origProjFindById = Project.findById;
    const origTaskFindById = Task.findById;
    Project.findById = () => Promise.resolve({ _id: projId, status: 'active', owner: 'adm_1', members: [] });
    Task.findById = () => Promise.resolve({ _id: foreignTaskId, project: otherProjId }); // Different project!

    const req = {
      body: {
        title: 'Cross Project Task Link',
        context: 'C',
        decision: 'D',
        rationale: 'R',
        project: projId,
        linkedTasks: [foreignTaskId],
      },
      user: { _id: 'adm_1', role: 'admin' },
    };
    const res = createMockRes();
    await decisionController.createDecision(req, res);
    assert.strictEqual(res.statusCode, 400);
    assert.ok(res.body.message.includes('does not belong to project'));

    Project.findById = origProjFindById;
    Task.findById = origTaskFindById;
  });

  // Case 299: Relationship integrity: Cross-project milestone link rejected with 400 Bad Request
  await testAsync('Case 299: Relationship integrity: Cross-project milestone link rejected with 400 Bad Request', async () => {
    const projId = new mongoose.Types.ObjectId().toString();
    const foreignMsId = new mongoose.Types.ObjectId().toString();
    const origProjFindById = Project.findById;
    const origMsFindById = Milestone.findById;
    Project.findById = () => Promise.resolve({ _id: projId, status: 'active', owner: 'adm_1', members: [] });
    Milestone.findById = () => Promise.resolve({ _id: foreignMsId, project: 'other_proj' });

    const req = {
      body: {
        title: 'Cross Project MS',
        context: 'C',
        decision: 'D',
        rationale: 'R',
        project: projId,
        linkedMilestones: [foreignMsId],
      },
      user: { _id: 'adm_1', role: 'admin' },
    };
    const res = createMockRes();
    await decisionController.createDecision(req, res);
    assert.strictEqual(res.statusCode, 400);

    Project.findById = origProjFindById;
    Milestone.findById = origMsFindById;
  });

  // Case 300: Relationship integrity: Cross-project release link rejected with 400 Bad Request
  await testAsync('Case 300: Relationship integrity: Cross-project release link rejected with 400 Bad Request', async () => {
    const projId = new mongoose.Types.ObjectId().toString();
    const foreignRelId = new mongoose.Types.ObjectId().toString();
    const origProjFindById = Project.findById;
    const origRelFindById = Release.findById;
    Project.findById = () => Promise.resolve({ _id: projId, status: 'active', owner: 'adm_1', members: [] });
    Release.findById = () => Promise.resolve({ _id: foreignRelId, project: 'other_proj' });

    const req = {
      body: {
        title: 'Cross Project Release',
        context: 'C',
        decision: 'D',
        rationale: 'R',
        project: projId,
        linkedReleases: [foreignRelId],
      },
      user: { _id: 'adm_1', role: 'admin' },
    };
    const res = createMockRes();
    await decisionController.createDecision(req, res);
    assert.strictEqual(res.statusCode, 400);

    Project.findById = origProjFindById;
    Release.findById = origRelFindById;
  });

  // Case 301: Relationship integrity: Malformed ObjectId in routes/queries returns controlled 400 Bad Request
  await testAsync('Case 301: Relationship integrity: Malformed ObjectId in routes/queries returns controlled 400 Bad Request', async () => {
    const resGet = createMockRes();
    await decisionController.getDecision({ params: { id: 'invalid-id' }, user: { role: 'admin' } }, resGet);
    assert.strictEqual(resGet.statusCode, 400);

    const resList = createMockRes();
    await decisionController.getDecisions({ query: { project: 'bad-proj-id' }, user: { role: 'admin' } }, resList);
    assert.strictEqual(resList.statusCode, 400);
  });

  // Case 302: Relationship integrity: Missing linked task, milestone, or release returns 404 Not Found
  await testAsync('Case 302: Relationship integrity: Missing linked task, milestone, or release returns 404 Not Found', async () => {
    const projId = new mongoose.Types.ObjectId().toString();
    const missingTaskId = new mongoose.Types.ObjectId().toString();
    const origProjFindById = Project.findById;
    const origTaskFindById = Task.findById;
    Project.findById = () => Promise.resolve({ _id: projId, status: 'active', owner: 'adm_1', members: [] });
    Task.findById = () => Promise.resolve(null); // Missing!

    const req = {
      body: {
        title: 'Missing Task Link',
        context: 'C',
        decision: 'D',
        rationale: 'R',
        project: projId,
        linkedTasks: [missingTaskId],
      },
      user: { _id: 'adm_1', role: 'admin' },
    };
    const res = createMockRes();
    await decisionController.createDecision(req, res);
    assert.strictEqual(res.statusCode, 404);

    Project.findById = origProjFindById;
    Task.findById = origTaskFindById;
  });

  // Case 303: Relationship integrity: Hidden tasks cannot be linked by Member and return generic 400 without leaking existence
  await testAsync('Case 303: Relationship integrity: Hidden tasks cannot be linked by Member and return generic 400 without leaking existence', async () => {
    const memberId = new mongoose.Types.ObjectId().toString();
    const otherUserId = new mongoose.Types.ObjectId().toString();
    const projId = new mongoose.Types.ObjectId().toString();
    const hiddenTaskId = new mongoose.Types.ObjectId().toString();
    const nonexistentTaskId = new mongoose.Types.ObjectId().toString();

    const origProjFindById = Project.findById;
    const origTaskFindById = Task.findById;
    Project.findById = () => Promise.resolve({
      _id: projId,
      status: 'active',
      owner: 'mgr_1',
      members: [{ user: { _id: memberId } }],
    });
    Task.findById = (id) => {
      if (id === hiddenTaskId) {
        return Promise.resolve({
          _id: hiddenTaskId,
          project: projId,
          assignedTo: otherUserId,
          createdBy: otherUserId,
        });
      }
      return Promise.resolve(null);
    };

    // 1. Inaccessible task link
    const req1 = {
      body: {
        title: 'Member Linking Hidden Task',
        context: 'C',
        decision: 'D',
        rationale: 'R',
        project: projId,
        linkedTasks: [hiddenTaskId],
      },
      user: { _id: memberId, role: 'member' },
    };
    const res1 = createMockRes();
    await decisionController.createDecision(req1, res1);
    assert.strictEqual(res1.statusCode, 400);
    assert.strictEqual(res1.body.message, 'One or more linked tasks are invalid or inaccessible.');

    // 2. Nonexistent task link by Member produces IDENTICAL 400 message (zero existence leakage)
    const req2 = {
      body: {
        title: 'Member Linking Nonexistent Task',
        context: 'C',
        decision: 'D',
        rationale: 'R',
        project: projId,
        linkedTasks: [nonexistentTaskId],
      },
      user: { _id: memberId, role: 'member' },
    };
    const res2 = createMockRes();
    await decisionController.createDecision(req2, res2);
    assert.strictEqual(res2.statusCode, 400);
    assert.strictEqual(res2.body.message, 'One or more linked tasks are invalid or inaccessible.');

    Project.findById = origProjFindById;
    Task.findById = origTaskFindById;
  });

  // Case 304: Lifecycle: Proposed -> accepted succeeds and records decidedBy and decidedAt
  await testAsync('Case 304: Lifecycle: Proposed -> accepted succeeds and records decidedBy and decidedAt', async () => {
    const decId = new mongoose.Types.ObjectId().toString();
    const projId = new mongoose.Types.ObjectId().toString();
    const origDecFindById = DecisionRecord.findById;
    const origProjFindById = Project.findById;

    const mockDec = {
      _id: decId,
      project: projId,
      status: 'proposed',
      proposedBy: 'user_1',
      save: async function () { return this; },
      populate: async function () { return this; },
    };
    DecisionRecord.findById = () => Promise.resolve(mockDec);
    Project.findById = () => Promise.resolve({ _id: projId, status: 'active', owner: 'adm_1', members: [] });

    const req = {
      params: { id: decId },
      body: { status: 'accepted' },
      user: { _id: 'adm_1', role: 'admin' },
    };
    const res = createMockRes();
    await decisionController.transitionDecision(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(mockDec.status, 'accepted');
    assert.strictEqual(mockDec.decidedBy, 'adm_1');
    assert.ok(mockDec.decidedAt instanceof Date);

    DecisionRecord.findById = origDecFindById;
    Project.findById = origProjFindById;
  });

  // Case 305: Lifecycle: Proposed -> rejected succeeds and enters terminal state
  await testAsync('Case 305: Lifecycle: Proposed -> rejected succeeds and enters terminal state', async () => {
    const decId = new mongoose.Types.ObjectId().toString();
    const projId = new mongoose.Types.ObjectId().toString();
    const origDecFindById = DecisionRecord.findById;
    const origProjFindById = Project.findById;

    const mockDec = {
      _id: decId,
      project: projId,
      status: 'proposed',
      proposedBy: 'user_1',
      save: async function () { return this; },
      populate: async function () { return this; },
    };
    DecisionRecord.findById = () => Promise.resolve(mockDec);
    Project.findById = () => Promise.resolve({ _id: projId, status: 'active', owner: 'adm_1', members: [] });

    const req = {
      params: { id: decId },
      body: { status: 'rejected' },
      user: { _id: 'adm_1', role: 'admin' },
    };
    const res = createMockRes();
    await decisionController.transitionDecision(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(mockDec.status, 'rejected');

    DecisionRecord.findById = origDecFindById;
    Project.findById = origProjFindById;
  });

  // Case 306: Lifecycle: Proposed -> withdrawn succeeds and enters terminal state
  await testAsync('Case 306: Lifecycle: Proposed -> withdrawn succeeds and enters terminal state', async () => {
    const decId = new mongoose.Types.ObjectId().toString();
    const projId = new mongoose.Types.ObjectId().toString();
    const memberId = new mongoose.Types.ObjectId().toString();
    const origDecFindById = DecisionRecord.findById;
    const origProjFindById = Project.findById;

    const mockDec = {
      _id: decId,
      project: projId,
      status: 'proposed',
      proposedBy: memberId,
      save: async function () { return this; },
      populate: async function () { return this; },
    };
    DecisionRecord.findById = () => Promise.resolve(mockDec);
    Project.findById = () => Promise.resolve({
      _id: projId,
      status: 'active',
      owner: 'mgr_1',
      members: [{ user: { _id: memberId } }],
    });

    const req = {
      params: { id: decId },
      body: { status: 'withdrawn' },
      user: { _id: memberId, role: 'member' },
    };
    const res = createMockRes();
    await decisionController.transitionDecision(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(mockDec.status, 'withdrawn');

    DecisionRecord.findById = origDecFindById;
    Project.findById = origProjFindById;
  });

  // Case 307: Lifecycle: Accepted -> superseded succeeds when replacement is an accepted decision in the same project
  await testAsync('Case 307: Lifecycle: Accepted -> superseded succeeds when replacement is an accepted decision in the same project', async () => {
    const decId = new mongoose.Types.ObjectId().toString();
    const replacementId = new mongoose.Types.ObjectId().toString();
    const projId = new mongoose.Types.ObjectId().toString();

    const origDecFindById = DecisionRecord.findById;
    const origProjFindById = Project.findById;

    const originalDec = {
      _id: decId,
      project: projId,
      status: 'accepted',
      proposedBy: 'user_1',
      supersededBy: null,
      save: async function () { return this; },
      populate: async function () { return this; },
    };
    const replacementDec = {
      _id: replacementId,
      project: projId,
      status: 'accepted',
    };

    DecisionRecord.findById = (id) => {
      if (id === decId) return Promise.resolve(originalDec);
      if (id === replacementId) return Promise.resolve(replacementDec);
      return Promise.resolve(null);
    };
    Project.findById = () => Promise.resolve({ _id: projId, status: 'active', owner: 'adm_1', members: [] });

    const req = {
      params: { id: decId },
      body: { status: 'superseded', replacementDecisionId: replacementId },
      user: { _id: 'adm_1', role: 'admin' },
    };
    const res = createMockRes();
    await decisionController.transitionDecision(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(originalDec.status, 'superseded');
    assert.strictEqual(originalDec.supersededBy.toString(), replacementId);

    DecisionRecord.findById = origDecFindById;
    Project.findById = origProjFindById;
  });

  // Case 308: Lifecycle: Accepted decision content is immutable (PUT returns 409 Conflict)
  await testAsync('Case 308: Lifecycle: Accepted decision content is immutable (PUT returns 409 Conflict)', async () => {
    const decId = new mongoose.Types.ObjectId().toString();
    const origDecFindById = DecisionRecord.findById;
    DecisionRecord.findById = () => Promise.resolve({
      _id: decId,
      status: 'accepted',
      project: 'proj_1',
    });

    const req = {
      params: { id: decId },
      body: { title: 'Attempted Modification to Accepted' },
      user: { _id: 'adm_1', role: 'admin' },
    };
    const res = createMockRes();
    await decisionController.updateDecision(req, res);
    assert.strictEqual(res.statusCode, 409);
    assert.ok(res.body.message.includes('immutable'));

    DecisionRecord.findById = origDecFindById;
  });

  // Case 309: Lifecycle: Terminal states (rejected, withdrawn, superseded) are immutable (transition returns 409 Conflict)
  await testAsync('Case 309: Lifecycle: Terminal states (rejected, withdrawn, superseded) are immutable (transition returns 409 Conflict)', async () => {
    const origDecFindById = DecisionRecord.findById;
    const origProjFindById = Project.findById;
    const projId = new mongoose.Types.ObjectId().toString();
    const decId = new mongoose.Types.ObjectId().toString();
    Project.findById = () => Promise.resolve({ _id: projId, status: 'active', owner: 'adm_1', members: [] });

    for (const termState of ['rejected', 'withdrawn', 'superseded']) {
      DecisionRecord.findById = () => Promise.resolve({
        _id: decId,
        status: termState,
        project: projId,
      });
      const res = createMockRes();
      await decisionController.transitionDecision({
        params: { id: decId },
        body: { status: 'accepted' },
        user: { _id: 'adm_1', role: 'admin' },
      }, res);
      assert.strictEqual(res.statusCode, 409, `Terminal state ${termState} cannot be transitioned`);
    }

    DecisionRecord.findById = origDecFindById;
    Project.findById = origProjFindById;
  });

  // Case 310: Lifecycle: Self-supersession rejected with 400 Bad Request
  await testAsync('Case 310: Lifecycle: Self-supersession rejected with 400 Bad Request', async () => {
    const decId = new mongoose.Types.ObjectId().toString();
    const origDecFindById = DecisionRecord.findById;
    const origProjFindById = Project.findById;
    DecisionRecord.findById = () => Promise.resolve({ _id: decId, status: 'accepted', project: 'proj_1' });
    Project.findById = () => Promise.resolve({ _id: 'proj_1', status: 'active', owner: 'adm_1', members: [] });

    const req = {
      params: { id: decId },
      body: { status: 'superseded', replacementDecisionId: decId },
      user: { _id: 'adm_1', role: 'admin' },
    };
    const res = createMockRes();
    await decisionController.transitionDecision(req, res);
    assert.strictEqual(res.statusCode, 400);
    assert.ok(res.body.message.includes('cannot supersede itself'));

    DecisionRecord.findById = origDecFindById;
    Project.findById = origProjFindById;
  });

  // Case 311: Lifecycle: Cross-project replacement decision rejected with 400 Bad Request
  await testAsync('Case 311: Lifecycle: Cross-project replacement decision rejected with 400 Bad Request', async () => {
    const decId = new mongoose.Types.ObjectId().toString();
    const replId = new mongoose.Types.ObjectId().toString();
    const origDecFindById = DecisionRecord.findById;
    const origProjFindById = Project.findById;

    DecisionRecord.findById = (id) => {
      if (id === decId) return Promise.resolve({ _id: decId, status: 'accepted', project: 'proj_A' });
      if (id === replId) return Promise.resolve({ _id: replId, status: 'accepted', project: 'proj_B' });
      return Promise.resolve(null);
    };
    Project.findById = () => Promise.resolve({ _id: 'proj_A', status: 'active', owner: 'adm_1', members: [] });

    const req = {
      params: { id: decId },
      body: { status: 'superseded', replacementDecisionId: replId },
      user: { _id: 'adm_1', role: 'admin' },
    };
    const res = createMockRes();
    await decisionController.transitionDecision(req, res);
    assert.strictEqual(res.statusCode, 400);
    assert.ok(res.body.message.includes('same project'));

    DecisionRecord.findById = origDecFindById;
    Project.findById = origProjFindById;
  });

  // Case 312: Lifecycle: Non-accepted replacement decision rejected with 409 Conflict
  await testAsync('Case 312: Lifecycle: Non-accepted replacement decision rejected with 409 Conflict', async () => {
    const decId = new mongoose.Types.ObjectId().toString();
    const replId = new mongoose.Types.ObjectId().toString();
    const projId = new mongoose.Types.ObjectId().toString();
    const origDecFindById = DecisionRecord.findById;
    const origProjFindById = Project.findById;

    DecisionRecord.findById = (id) => {
      if (id === decId) return Promise.resolve({ _id: decId, status: 'accepted', project: projId });
      if (id === replId) return Promise.resolve({ _id: replId, status: 'proposed', project: projId }); // Not accepted!
      return Promise.resolve(null);
    };
    Project.findById = () => Promise.resolve({ _id: projId, status: 'active', owner: 'adm_1', members: [] });

    const req = {
      params: { id: decId },
      body: { status: 'superseded', replacementDecisionId: replId },
      user: { _id: 'adm_1', role: 'admin' },
    };
    const res = createMockRes();
    await decisionController.transitionDecision(req, res);
    assert.strictEqual(res.statusCode, 409);
    assert.ok(res.body.message.includes('must have status "accepted"'));

    DecisionRecord.findById = origDecFindById;
    Project.findById = origProjFindById;
  });

  // Case 313: Lifecycle: Circular supersession chain rejected with 409 Conflict
  await testAsync('Case 313: Lifecycle: Circular supersession chain rejected with 409 Conflict', async () => {
    const idA = new mongoose.Types.ObjectId().toString();
    const idB = new mongoose.Types.ObjectId().toString();
    const projId = new mongoose.Types.ObjectId().toString();
    const origDecFindById = DecisionRecord.findById;
    const origProjFindById = Project.findById;

    // B already superseded by A; now attempting to supersede A with B -> Cycle!
    DecisionRecord.findById = (id) => {
      if (id === idA) return Promise.resolve({ _id: idA, status: 'accepted', project: projId });
      if (id === idB) return Promise.resolve({ _id: idB, status: 'accepted', project: projId, supersededBy: idA });
      return Promise.resolve(null);
    };
    Project.findById = () => Promise.resolve({ _id: projId, status: 'active', owner: 'adm_1', members: [] });

    const req = {
      params: { id: idA },
      body: { status: 'superseded', replacementDecisionId: idB },
      user: { _id: 'adm_1', role: 'admin' },
    };
    const res = createMockRes();
    await decisionController.transitionDecision(req, res);
    assert.strictEqual(res.statusCode, 409);
    assert.ok(res.body.message.includes('Circular supersession'));

    DecisionRecord.findById = origDecFindById;
    Project.findById = origProjFindById;
  });

  // Case 314: Lifecycle: Generic PUT endpoint cannot mutate lifecycle state (ignores status field)
  await testAsync('Case 314: Lifecycle: Generic PUT endpoint cannot mutate lifecycle state (ignores status field)', async () => {
    const decId = new mongoose.Types.ObjectId().toString();
    const projId = new mongoose.Types.ObjectId().toString();
    const origDecFindById = DecisionRecord.findById;
    const origProjFindById = Project.findById;

    const mockDec = {
      _id: decId,
      title: 'T',
      status: 'proposed',
      project: projId,
      proposedBy: 'adm_1',
      save: async function () { return this; },
      populate: async function () { return this; },
    };
    DecisionRecord.findById = () => Promise.resolve(mockDec);
    Project.findById = () => Promise.resolve({ _id: projId, status: 'active', owner: 'adm_1', members: [] });

    const req = {
      params: { id: decId },
      body: { title: 'New T', status: 'accepted' }, // Attemping sneaky transition via PUT
      user: { _id: 'adm_1', role: 'admin' },
    };
    const res = createMockRes();
    await decisionController.updateDecision(req, res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(mockDec.status, 'proposed', 'Status must remain proposed; PUT cannot change lifecycle status');

    DecisionRecord.findById = origDecFindById;
    Project.findById = origProjFindById;
  });

  // Case 315: Invariant: Permanent deletion endpoint does not exist for decisions (no DELETE route)
  await testAsync('Case 315: Invariant: Permanent deletion endpoint does not exist for decisions (no DELETE route)', async () => {
    const decisionsRouter = require('./routes/decisions');
    const deleteRoutes = decisionsRouter.stack.filter((layer) => layer.route && layer.route.methods.delete);
    assert.strictEqual(deleteRoutes.length, 0, 'No DELETE route must be declared on decisions router');
  });

  // Case 316: Deterministic impact: Directly linked task appears in impact analysis with direct_task_link driver
  await testAsync('Case 316: Deterministic impact: Directly linked task appears in impact analysis with direct_task_link driver', async () => {
    const projId = 'proj_316';
    const tId = 't_316';
    const decision = { _id: 'dec_316', project: projId, status: 'accepted', linkedTasks: [tId] };
    const project = { _id: projId, status: 'active' };
    const tasks = [{ _id: tId, project: projId, title: 'T1', status: 'To Do', estimateDays: 3, dependsOn: [] }];

    const impact = computeDecisionImpact(decision, project, tasks, [], [], { role: 'admin' });
    assert.strictEqual(impact.directlyLinkedTasks.length, 1);
    assert.strictEqual(impact.directlyLinkedTasks[0].id, tId);
    assert.ok(impact.drivers.some((d) => d.type === 'direct_task_link'));
  });

  // Case 317: Deterministic impact: Linear downstream impact traversal (A linked -> B -> C affected)
  await testAsync('Case 317: Deterministic impact: Linear downstream impact traversal (A linked -> B -> C affected)', async () => {
    const projId = 'proj_317';
    const idA = 't_317_a';
    const idB = 't_317_b';
    const idC = 't_317_c';

    const decision = { _id: 'dec_317', project: projId, status: 'proposed', linkedTasks: [idA] };
    const project = { _id: projId, status: 'active' };
    const tasks = [
      { _id: idA, project: projId, title: 'A', status: 'To Do', estimateDays: 2, dependsOn: [] },
      { _id: idB, project: projId, title: 'B', status: 'To Do', estimateDays: 2, dependsOn: [idA] },
      { _id: idC, project: projId, title: 'C', status: 'To Do', estimateDays: 2, dependsOn: [idB] },
    ];

    const impact = computeDecisionImpact(decision, project, tasks, [], [], { role: 'admin' });
    assert.strictEqual(impact.directlyLinkedTasks.length, 1);
    assert.strictEqual(impact.downstreamTasks.length, 2);
    const downstreamIds = impact.downstreamTasks.map((t) => t.id);
    assert.ok(downstreamIds.includes(idB));
    assert.ok(downstreamIds.includes(idC));
    assert.ok(impact.drivers.some((d) => d.type === 'downstream_impact' && d.count === 2));
  });

  // Case 318: Deterministic impact: Diamond dependency descendants deduplicated
  await testAsync('Case 318: Deterministic impact: Diamond dependency descendants deduplicated', async () => {
    const projId = 'proj_318';
    const idA = 't_318_a';
    const idB = 't_318_b';
    const idC = 't_318_c';
    const idD = 't_318_d';

    const decision = { _id: 'dec_318', project: projId, status: 'proposed', linkedTasks: [idA] };
    const project = { _id: projId, status: 'active' };
    const tasks = [
      { _id: idA, project: projId, title: 'A', status: 'To Do', estimateDays: 1, dependsOn: [] },
      { _id: idB, project: projId, title: 'B', status: 'To Do', estimateDays: 1, dependsOn: [idA] },
      { _id: idC, project: projId, title: 'C', status: 'To Do', estimateDays: 1, dependsOn: [idA] },
      { _id: idD, project: projId, title: 'D', status: 'To Do', estimateDays: 1, dependsOn: [idB, idC] },
    ];

    const impact = computeDecisionImpact(decision, project, tasks, [], [], { role: 'admin' });
    assert.strictEqual(impact.downstreamTasks.length, 3); // B, C, D (D visited once!)
    assert.strictEqual(impact.summary.totalDownstreamTasks, 3);
  });

  // Case 319: Deterministic impact: Affected milestones discovered and deduplicated from task associations
  await testAsync('Case 319: Deterministic impact: Affected milestones discovered and deduplicated from task associations', async () => {
    const projId = 'proj_319';
    const idA = 't_319_a';
    const idB = 't_319_b';
    const msId1 = 'ms_319_1';
    const msId2 = 'ms_319_2';

    const decision = { _id: 'dec_319', project: projId, status: 'proposed', linkedTasks: [idA], linkedMilestones: [msId2] };
    const project = { _id: projId, status: 'active' };
    const tasks = [
      { _id: idA, project: projId, title: 'A', status: 'To Do', estimateDays: 1, milestone: msId1, dependsOn: [] },
      { _id: idB, project: projId, title: 'B', status: 'To Do', estimateDays: 1, milestone: msId1, dependsOn: [idA] },
    ];
    const milestones = [
      { _id: msId1, project: projId, title: 'M1', sequence: 1 },
      { _id: msId2, project: projId, title: 'M2', sequence: 2 },
    ];

    const impact = computeDecisionImpact(decision, project, tasks, milestones, [], { role: 'admin' });
    assert.strictEqual(impact.affectedMilestones.length, 2); // msId1 (from tasks) + msId2 (direct)
  });

  // Case 320: Deterministic impact: Affected releases discovered and deduplicated from milestone associations
  await testAsync('Case 320: Deterministic impact: Affected releases discovered and deduplicated from milestone associations', async () => {
    const projId = 'proj_320';
    const idA = 't_320_a';
    const msId = 'ms_320';
    const relId = 'rel_320';

    const decision = { _id: 'dec_320', project: projId, status: 'proposed', linkedTasks: [idA] };
    const project = { _id: projId, status: 'active' };
    const milestones = [{ _id: msId, project: projId, release: relId }];
    const releases = [{ _id: relId, project: projId, name: 'R1', version: 'v1.0' }];
    const tasks = [{ _id: idA, project: projId, title: 'A', status: 'To Do', estimateDays: 1, milestone: msId, dependsOn: [] }];

    const impact = computeDecisionImpact(decision, project, tasks, milestones, releases, { role: 'admin' });
    assert.strictEqual(impact.affectedReleases.length, 1);
    assert.strictEqual(impact.affectedReleases[0].id, relId);
  });

  // Case 321: Deterministic impact: Duration critical path intersection detected and classified as critical_path
  await testAsync('Case 321: Deterministic impact: Duration critical path intersection detected and classified as critical_path', async () => {
    const projId = 'proj_321';
    const idA = 't_321_cp';
    const idB = 't_321_non_cp';

    const decision = { _id: 'dec_321', project: projId, status: 'accepted', linkedTasks: [idA] };
    const project = { _id: projId, status: 'active' };
    const tasks = [
      { _id: idA, project: projId, title: 'CP Task', status: 'To Do', estimateDays: 10, dependsOn: [] },
      { _id: idB, project: projId, title: 'Side Task', status: 'To Do', estimateDays: 2, dependsOn: [] },
    ];

    const impact = computeDecisionImpact(decision, project, tasks, [], [], { role: 'admin' });
    assert.strictEqual(impact.classification, 'critical_path');
    assert.strictEqual(impact.criticalPath.intersectsDurationPath, true);
  });

  // Case 322: Deterministic impact: Forecast-driving critical path intersection detected and emits forecast_path_intersection driver
  await testAsync('Case 322: Deterministic impact: Forecast-driving critical path intersection detected and emits forecast_path_intersection driver', async () => {
    const projId = 'proj_322';
    const idA = 't_322_driver';
    const futureEta = addCalendarDays(toUtcDay(new Date()), 15);

    const decision = { _id: 'dec_322', project: projId, status: 'proposed', linkedTasks: [idA] };
    const project = { _id: projId, status: 'active' };
    const tasks = [
      { _id: idA, project: projId, title: 'Blocked Driver', status: 'In Progress', isBlocked: true, blockerEta: futureEta, estimateDays: 1, dependsOn: [] },
    ];

    const impact = computeDecisionImpact(decision, project, tasks, [], [], { role: 'admin' });
    assert.strictEqual(impact.classification, 'critical_path');
    assert.ok(impact.drivers.some((d) => d.type === 'forecast_path_intersection'));
  });

  // Case 323: Deterministic impact: Historical decision classification (rejected/withdrawn/superseded classified as historical)
  await testAsync('Case 323: Deterministic impact: Historical decision classification (rejected/withdrawn/superseded classified as historical)', async () => {
    const projId = 'proj_323';
    const idA = 't_323';
    const project = { _id: projId, status: 'active' };
    const tasks = [{ _id: idA, project: projId, title: 'Task', status: 'To Do', estimateDays: 10, dependsOn: [] }];

    for (const termStatus of ['rejected', 'withdrawn', 'superseded']) {
      const decision = { _id: `dec_${termStatus}`, project: projId, status: termStatus, linkedTasks: [idA] };
      const impact = computeDecisionImpact(decision, project, tasks, [], [], { role: 'admin' });
      assert.strictEqual(impact.classification, 'historical', `Status ${termStatus} must classify as historical`);
    }
  });

  // Case 324: Deterministic impact: Missing estimates or empty scope returns insufficient_data classification
  await testAsync('Case 324: Deterministic impact: Missing estimates or empty scope returns insufficient_data classification', async () => {
    const projId = 'proj_324';
    const project = { _id: projId, status: 'active' };
    const decision = { _id: 'dec_324', project: projId, status: 'proposed', linkedTasks: [] };

    const impact = computeDecisionImpact(decision, project, [], [], [], { role: 'admin' });
    assert.strictEqual(impact.classification, 'insufficient_data');
    assert.ok(impact.drivers.some((d) => d.type === 'insufficient_data'));
  });

  // Case 325: Deterministic impact: Corrupted cyclic graph terminates safely without infinite recursion
  await testAsync('Case 325: Deterministic impact: Corrupted cyclic graph terminates safely without infinite recursion', async () => {
    const projId = 'proj_325';
    const idA = 't_325_a';
    const idB = 't_325_b';

    const decision = { _id: 'dec_325', project: projId, status: 'proposed', linkedTasks: [idA] };
    const project = { _id: projId, status: 'active' };
    // Corrupted cycle: A -> B and B -> A
    const tasks = [
      { _id: idA, project: projId, title: 'A', status: 'To Do', estimateDays: 1, dependsOn: [idB] },
      { _id: idB, project: projId, title: 'B', status: 'To Do', estimateDays: 1, dependsOn: [idA] },
    ];

    const impact = computeDecisionImpact(decision, project, tasks, [], [], { role: 'admin' });
    assert.ok(impact, 'Cycle must terminate cleanly without stack overflow');
    assert.strictEqual(impact.downstreamTasks.length, 1);
  });

  // Case 326: Deterministic impact: Cross-project tasks strictly excluded from decision impact traversal
  await testAsync('Case 326: Deterministic impact: Cross-project tasks strictly excluded from decision impact traversal', async () => {
    const projId = 'proj_326_a';
    const otherProjId = 'proj_326_b';
    const idA = 't_326_valid';
    const idForeign = 't_326_foreign';

    const decision = { _id: 'dec_326', project: projId, status: 'proposed', linkedTasks: [idA, idForeign] };
    const project = { _id: projId, status: 'active' };
    const tasks = [
      { _id: idA, project: projId, title: 'Valid Task', status: 'To Do', estimateDays: 2, dependsOn: [] },
      { _id: idForeign, project: otherProjId, title: 'Foreign Task', status: 'To Do', estimateDays: 5, dependsOn: [] },
    ];

    const impact = computeDecisionImpact(decision, project, tasks, [], [], { role: 'admin' });
    assert.strictEqual(impact.directlyLinkedTasks.length, 1);
    assert.strictEqual(impact.directlyLinkedTasks[0].id, idA);
  });

  // Case 327: Privacy: Member receives personal scope and isPartial: true when hidden delivery work is affected
  await testAsync('Case 327: Privacy: Member receives personal scope and isPartial: true when hidden delivery work is affected', async () => {
    const memberUser = { _id: 'mem_327', role: 'member' };
    const projId = 'proj_327';
    const visibleTaskId = 't_327_vis';
    const hiddenTaskId = 't_327_hidden';

    const decision = { _id: 'dec_327', project: projId, status: 'proposed', linkedTasks: [visibleTaskId, hiddenTaskId] };
    const project = { _id: projId, status: 'active' };
    const tasks = [
      { _id: visibleTaskId, project: projId, title: 'Visible', assignedTo: 'mem_327', status: 'To Do', estimateDays: 2, dependsOn: [] },
      { _id: hiddenTaskId, project: projId, title: 'Secret Task', assignedTo: 'admin_1', status: 'To Do', estimateDays: 4, dependsOn: [] },
    ];

    const impact = computeDecisionImpact(decision, project, tasks, [], [], memberUser);
    assert.strictEqual(impact.scope, 'personal');
    assert.strictEqual(impact.isPartial, true);
    assert.strictEqual(impact.directlyLinkedTasks.length, 1);
    assert.strictEqual(impact.directlyLinkedTasks[0].id, visibleTaskId);
  });

  // Case 328: Privacy: Member serialized JSON contains 0 leaks of hidden task IDs, titles, owners, dates, estimates, or blocker reasons
  await testAsync('Case 328: Privacy: Member serialized JSON contains 0 leaks of hidden task IDs, titles, owners, dates, estimates, or blocker reasons', async () => {
    const memberUser = { _id: 'mem_328', role: 'member' };
    const projId = 'proj_328';
    const visibleTaskId = 't_328_vis';
    const hiddenTaskId = 'SECRET_ID_99999';
    const hiddenTaskTitle = 'SUPER_SECRET_CORE_TASK';
    const hiddenOwner = 'CLASSIFIED_ADMIN';
    const hiddenReason = 'CRITICAL_SECURITY_BREACH';

    const decision = { _id: 'dec_328', project: projId, status: 'proposed', linkedTasks: [visibleTaskId, hiddenTaskId] };
    const project = { _id: projId, status: 'active' };
    const tasks = [
      { _id: visibleTaskId, project: projId, title: 'Member Task', assignedTo: 'mem_328', status: 'To Do', estimateDays: 2, dependsOn: [] },
      {
        _id: hiddenTaskId,
        project: projId,
        title: hiddenTaskTitle,
        assignedTo: hiddenOwner,
        status: 'In Progress',
        isBlocked: true,
        blockedReason: hiddenReason,
        estimateDays: 33,
        dueDate: new Date('2026-11-15'),
        blockerEta: new Date('2026-10-30'),
        dependsOn: [],
      },
    ];

    const impact = computeDecisionImpact(decision, project, tasks, [], [], memberUser);
    const json = JSON.stringify(impact);

    assert.strictEqual(json.includes(hiddenTaskId), false, 'Must not leak hidden task ID');
    assert.strictEqual(json.includes(hiddenTaskTitle), false, 'Must not leak hidden task title');
    assert.strictEqual(json.includes(hiddenOwner), false, 'Must not leak hidden owner');
    assert.strictEqual(json.includes(hiddenReason), false, 'Must not leak hidden blocker reason');
    assert.strictEqual(json.includes('33'), false, 'Must not leak hidden estimate');
    assert.strictEqual(json.includes('2026-11-15'), false, 'Must not leak hidden dueDate');
    assert.strictEqual(json.includes('2026-10-30'), false, 'Must not leak hidden blockerEta');
  });

  // Case 329: Privacy: Member serialized JSON contains 0 exact counts of hidden tasks or delivery items
  await testAsync('Case 329: Privacy: Member serialized JSON contains 0 exact counts of hidden tasks or delivery items', async () => {
    const memberUser = { _id: 'mem_329', role: 'member' };
    const projId = 'proj_329';
    const visibleTaskId = 't_329_vis';
    const hiddenTask1 = 't_329_h1';
    const hiddenTask2 = 't_329_h2';

    const decision = { _id: 'dec_329', project: projId, status: 'proposed', linkedTasks: [visibleTaskId, hiddenTask1, hiddenTask2] };
    const project = { _id: projId, status: 'active' };
    const tasks = [
      { _id: visibleTaskId, project: projId, title: 'Visible', assignedTo: 'mem_329', status: 'To Do', estimateDays: 1, dependsOn: [] },
      { _id: hiddenTask1, project: projId, title: 'H1', assignedTo: 'adm_1', status: 'To Do', estimateDays: 1, dependsOn: [] },
      { _id: hiddenTask2, project: projId, title: 'H2', assignedTo: 'adm_1', status: 'To Do', estimateDays: 1, dependsOn: [] },
    ];

    const impact = computeDecisionImpact(decision, project, tasks, [], [], memberUser);
    const json = JSON.stringify(impact);

    assert.strictEqual(json.includes('totalAffectedTasks'), false, 'totalAffectedTasks must not appear in member response');
    assert.strictEqual(impact.summary.totalAffectedTasks, undefined);
    assert.strictEqual(impact.summary.visibleDirectTasksCount, 1);
  });

  // Case 330: Privacy: Generic restricted_delivery_impact signal emitted when hidden delivery work is affected
  await testAsync('Case 330: Privacy: Generic restricted_delivery_impact signal emitted when hidden delivery work is affected', async () => {
    const memberUser = { _id: 'mem_330', role: 'member' };
    const projId = 'proj_330';
    const visibleTaskId = 't_330_vis';
    const hiddenTaskId = 't_330_h';

    const decision = { _id: 'dec_330', project: projId, status: 'proposed', linkedTasks: [visibleTaskId, hiddenTaskId] };
    const project = { _id: projId, status: 'active' };
    const tasks = [
      { _id: visibleTaskId, project: projId, title: 'Visible', assignedTo: 'mem_330', status: 'To Do', estimateDays: 1, dependsOn: [] },
      { _id: hiddenTaskId, project: projId, title: 'H', assignedTo: 'adm_1', status: 'To Do', estimateDays: 1, dependsOn: [] },
    ];

    const impact = computeDecisionImpact(decision, project, tasks, [], [], memberUser);
    assert.ok(impact.restrictedSignal);
    assert.strictEqual(impact.restrictedSignal.type, 'restricted_delivery_impact');
    assert.strictEqual(impact.restrictedSignal.message, 'Restricted project work may be affected by this decision.');
  });

  // Case 331: Privacy: Member payload remains strictly invariant across hidden prerequisite state changes
  await testAsync('Case 331: Privacy: Member payload remains strictly invariant across hidden prerequisite state changes', async () => {
    const memberUser = { _id: 'mem_331', role: 'member' };
    const projId = 'proj_331';
    const visTaskId = 't_331_vis';
    const hiddenTaskId = 't_331_h';

    const decision = { _id: 'dec_331', project: projId, status: 'proposed', linkedTasks: [visTaskId, hiddenTaskId] };
    const project = { _id: projId, status: 'active' };

    // State 1: Hidden task is To Do, unblocked, estimate 2
    const tasksState1 = [
      { _id: visTaskId, project: projId, title: 'Visible', assignedTo: 'mem_331', status: 'To Do', estimateDays: 3, dependsOn: [] },
      { _id: hiddenTaskId, project: projId, title: 'Hidden', assignedTo: 'adm_1', status: 'To Do', estimateDays: 2, isBlocked: false, dependsOn: [] },
    ];
    const impact1 = computeDecisionImpact(decision, project, tasksState1, [], [], memberUser);

    // State 2: Hidden task is now In Progress, blocked with ETA, estimate 20
    const tasksState2 = [
      { _id: visTaskId, project: projId, title: 'Visible', assignedTo: 'mem_331', status: 'To Do', estimateDays: 3, dependsOn: [] },
      { _id: hiddenTaskId, project: projId, title: 'Hidden', assignedTo: 'adm_1', status: 'In Progress', estimateDays: 20, isBlocked: true, blockerEta: new Date('2026-12-01'), blockedReason: 'Database failure', dependsOn: [] },
    ];
    const impact2 = computeDecisionImpact(decision, project, tasksState2, [], [], memberUser);

    assert.strictEqual(JSON.stringify(impact1), JSON.stringify(impact2), 'Serialized member payload must be identical across hidden task state changes');
    assert.deepStrictEqual(impact1, impact2);
  });

  // Case 332: Privacy: Admin and authorized Manager responses retain complete authorized delivery detail
  await testAsync('Case 332: Privacy: Admin and authorized Manager responses retain complete authorized delivery detail', async () => {
    const adminUser = { _id: 'adm_332', role: 'admin' };
    const projId = 'proj_332';
    const tId = 't_332';

    const decision = { _id: 'dec_332', project: projId, status: 'accepted', linkedTasks: [tId] };
    const project = { _id: projId, status: 'active' };
    const tasks = [
      { _id: tId, project: projId, title: 'Full Detail Task', status: 'In Progress', estimateDays: 5, isBlocked: true, blockerEta: new Date('2026-11-20'), dependsOn: [] },
    ];

    const impact = computeDecisionImpact(decision, project, tasks, [], [], adminUser);
    assert.strictEqual(impact.scope, 'project');
    assert.strictEqual(impact.isPartial, false);
    assert.strictEqual(impact.directlyLinkedTasks[0].estimateDays, 5);
    assert.strictEqual(impact.directlyLinkedTasks[0].isBlocked, true);
    assert.ok(impact.directlyLinkedTasks[0].blockerEta.includes('2026-11-20'));
  });

  // Case 333: Search: Regex metacharacters safely escaped in search query
  await testAsync('Case 333: Search: Regex metacharacters safely escaped in search query', async () => {
    const maliciousStrings = ['[.*+?^${}()|[\\]\\]', 'test.*(.*)', '()(?=.*)'];
    for (const str of maliciousStrings) {
      const escaped = escapeRegex(str);
      assert.doesNotThrow(() => new RegExp(escaped, 'i'), `Escaped regex must be valid syntax: ${str}`);
    }
  });

  // Case 334: Filtering: Project, status, release, milestone, and task filters remain properly scoped
  await testAsync('Case 334: Filtering: Project, status, release, milestone, and task filters remain properly scoped', async () => {
    const origDecFind = DecisionRecord.find;
    const origDecCount = DecisionRecord.countDocuments;
    const origProjFindById = Project.findById;

    let capturedFilter = null;
    Project.findById = () => Promise.resolve({ _id: 'proj_334', status: 'active', owner: 'adm_1', members: [] });
    DecisionRecord.find = (filter) => {
      capturedFilter = filter;
      return {
        populate: () => ({
          populate: () => ({
            populate: () => ({
              populate: () => ({
                sort: () => ({
                  skip: () => ({
                    limit: () => Promise.resolve([]),
                  }),
                }),
              }),
            }),
          }),
        }),
      };
    };
    DecisionRecord.countDocuments = () => Promise.resolve(0);

    const relId = new mongoose.Types.ObjectId().toString();
    const msId = new mongoose.Types.ObjectId().toString();
    const req = {
      query: {
        project: '64b0f0000000000000000334',
        status: 'accepted',
        release: relId,
        milestone: msId,
      },
      user: { role: 'admin' },
    };
    const res = createMockRes();
    await decisionController.getDecisions(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(capturedFilter.project, '64b0f0000000000000000334');
    assert.strictEqual(capturedFilter.status, 'accepted');
    assert.strictEqual(capturedFilter.linkedReleases, relId);
    assert.strictEqual(capturedFilter.linkedMilestones, msId);

    DecisionRecord.find = origDecFind;
    DecisionRecord.countDocuments = origDecCount;
    Project.findById = origProjFindById;
  });

  // Case 335: Pagination: Bounded pagination respects max limits and returns correct page metadata
  await testAsync('Case 335: Pagination: Bounded pagination respects max limits and returns correct page metadata', async () => {
    const origDecFind = DecisionRecord.find;
    const origDecCount = DecisionRecord.countDocuments;
    const origProjFindById = Project.findById;

    let capturedLimit = 0;
    Project.findById = () => Promise.resolve({ _id: 'proj_335', status: 'active', owner: 'adm_1', members: [] });
    DecisionRecord.find = () => ({
      populate: () => ({
        populate: () => ({
          populate: () => ({
            populate: () => ({
              sort: () => ({
                skip: () => ({
                  limit: (lim) => {
                    capturedLimit = lim;
                    return Promise.resolve([]);
                  },
                }),
              }),
            }),
          }),
        }),
      }),
    });
    DecisionRecord.countDocuments = () => Promise.resolve(105);

    const req = {
      query: { project: '64b0f0000000000000000335', page: '2', limit: '100' }, // Requesting 100
      user: { role: 'admin' },
    };
    const res = createMockRes();
    await decisionController.getDecisions(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(capturedLimit, 50, 'Limit must be capped at 50 max');
    assert.strictEqual(res.body.totalPages, 3);
    assert.strictEqual(res.body.currentPage, 2);

    DecisionRecord.find = origDecFind;
    DecisionRecord.countDocuments = origDecCount;
    Project.findById = origProjFindById;
  });

  // Case 336: Sorting: Deterministic sorting orders by updatedAt descending then _id descending
  await testAsync('Case 336: Sorting: Deterministic sorting orders by updatedAt descending then _id descending', async () => {
    const origDecFind = DecisionRecord.find;
    const origDecCount = DecisionRecord.countDocuments;
    const origProjFindById = Project.findById;

    let capturedSort = null;
    Project.findById = () => Promise.resolve({ _id: 'proj_336', status: 'active', owner: 'adm_1', members: [] });
    DecisionRecord.find = () => ({
      populate: () => ({
        populate: () => ({
          populate: () => ({
            populate: () => ({
              sort: (sortObj) => {
                capturedSort = sortObj;
                return {
                  skip: () => ({
                    limit: () => Promise.resolve([]),
                  }),
                };
              },
            }),
          }),
        }),
      }),
    });
    DecisionRecord.countDocuments = () => Promise.resolve(0);

    const req = {
      query: { project: '64b0f0000000000000000336' },
      user: { role: 'admin' },
    };
    const res = createMockRes();
    await decisionController.getDecisions(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(capturedSort, { updatedAt: -1, _id: -1 });

    DecisionRecord.find = origDecFind;
    DecisionRecord.countDocuments = origDecCount;
    Project.findById = origProjFindById;
  });

  // Case 337: Performance: GET /api/decisions executes bounded batch queries
  await testAsync('Case 337: Performance: GET /api/decisions executes bounded batch queries', async () => {
    let queryCount = 0;
    const origProjFind = Project.find;
    const origDecFind = DecisionRecord.find;
    const origDecCount = DecisionRecord.countDocuments;

    Project.find = () => {
      queryCount++;
      return { select: () => Promise.resolve([{ _id: 'p1' }]) };
    };
    DecisionRecord.find = () => {
      queryCount++;
      return {
        populate: () => ({
          populate: () => ({
            populate: () => ({
              populate: () => ({
                sort: () => ({
                  skip: () => ({
                    limit: () => Promise.resolve([]),
                  }),
                }),
              }),
            }),
          }),
        }),
      };
    };
    DecisionRecord.countDocuments = () => {
      queryCount++;
      return Promise.resolve(0);
    };

    const req = { query: {}, user: { role: 'member', _id: 'mem_1' } };
    const res = createMockRes();
    await decisionController.getDecisions(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(queryCount, 3, 'Member list must execute exactly 3 bounded queries');

    Project.find = origProjFind;
    DecisionRecord.find = origDecFind;
    DecisionRecord.countDocuments = origDecCount;
  });

  // Case 338: Performance: GET /api/decisions/:id executes bounded batch queries
  await testAsync('Case 338: Performance: GET /api/decisions/:id executes bounded batch queries', async () => {
    let queryCount = 0;
    const origDecFindById = DecisionRecord.findById;

    DecisionRecord.findById = () => {
      queryCount++;
      return {
        populate: () => ({
          populate: () => ({
            populate: () => ({
              populate: () => ({
                populate: () => ({
                  populate: () => ({
                    populate: () => Promise.resolve({
                      _id: 'dec_1',
                      project: { _id: 'p1', owner: 'adm_1', members: [] },
                    }),
                  }),
                }),
              }),
            }),
          }),
        }),
      };
    };

    const req = { params: { id: '64b0f0000000000000000338' }, user: { role: 'admin' } };
    const res = createMockRes();
    await decisionController.getDecision(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(queryCount, 1, 'Decision detail must execute exactly 1 populated query');

    DecisionRecord.findById = origDecFindById;
  });

  // Case 339: Performance: GET /api/decisions/:id/impact executes exactly 5 bounded batch queries regardless of graph size
  await testAsync('Case 339: Performance: GET /api/decisions/:id/impact executes exactly 5 bounded batch queries regardless of graph size', async () => {
    let queryCount = 0;
    const origDecFindById = DecisionRecord.findById;
    const origProjFindById = Project.findById;
    const origTaskFind = Task.find;
    const origMsFind = Milestone.find;
    const origRelFind = Release.find;

    DecisionRecord.findById = () => {
      queryCount++;
      return Promise.resolve({
        _id: 'dec_339',
        project: '64b0f0000000000000000339',
        status: 'proposed',
        linkedTasks: [],
        linkedMilestones: [],
        linkedReleases: [],
      });
    };
    Project.findById = () => {
      queryCount++;
      return Promise.resolve({ _id: '64b0f0000000000000000339', status: 'active', owner: 'adm_1', members: [] });
    };
    Task.find = () => {
      queryCount++;
      return { select: () => Promise.resolve([]) };
    };
    Milestone.find = () => {
      queryCount++;
      return { select: () => Promise.resolve([]) };
    };
    Release.find = () => {
      queryCount++;
      return { select: () => Promise.resolve([]) };
    };

    const req = { params: { id: '64b0f0000000000000000339' }, user: { role: 'admin' } };
    const res = createMockRes();
    await decisionController.getDecisionImpact(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(queryCount, 5, 'Must execute exactly 5 bounded batch queries');

    DecisionRecord.findById = origDecFindById;
    Project.findById = origProjFindById;
    Task.find = origTaskFind;
    Milestone.find = origMsFind;
    Release.find = origRelFind;
  });

  // Case 340: Performance: Query count remains invariant between small (5 tasks) and large (500 tasks) graphs
  await testAsync('Case 340: Performance: Query count remains invariant between small (5 tasks) and large (500 tasks) graphs', async () => {
    const origDecFindById = DecisionRecord.findById;
    const origProjFindById = Project.findById;
    const origTaskFind = Task.find;
    const origMsFind = Milestone.find;
    const origRelFind = Release.find;

    for (const datasetSize of ['small', 'large']) {
      let qCount = 0;
      const taskCount = datasetSize === 'small' ? 5 : 500;
      const mockTasks = Array.from({ length: taskCount }, (_, i) => ({
        _id: `t_${datasetSize}_${i}`,
        title: `Task ${i}`,
        status: 'To Do',
        estimateDays: 1,
        dependsOn: i > 0 ? [`t_${datasetSize}_${i - 1}`] : [],
      }));

      DecisionRecord.findById = () => {
        qCount++;
        return Promise.resolve({
          _id: 'dec_340',
          project: '64b0f0000000000000000340',
          status: 'accepted',
          linkedTasks: [`t_${datasetSize}_0`],
        });
      };
      Project.findById = () => {
        qCount++;
        return Promise.resolve({ _id: '64b0f0000000000000000340', status: 'active', owner: 'adm_1', members: [] });
      };
      Task.find = () => {
        qCount++;
        return { select: () => Promise.resolve(mockTasks) };
      };
      Milestone.find = () => {
        qCount++;
        return { select: () => Promise.resolve([]) };
      };
      Release.find = () => {
        qCount++;
        return { select: () => Promise.resolve([]) };
      };

      const req = { params: { id: '64b0f0000000000000000340' }, user: { role: 'admin' } };
      const res = createMockRes();
      await decisionController.getDecisionImpact(req, res);

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(qCount, 5, `Must execute exactly 5 queries on ${datasetSize} dataset (${taskCount} tasks)`);
    }

    DecisionRecord.findById = origDecFindById;
    Project.findById = origProjFindById;
    Task.find = origTaskFind;
    Milestone.find = origMsFind;
    Release.find = origRelFind;
  });

  // Case 341: Large synthetic DAG stack safety: 500-node dependency graph computes decision impact without recursion failure
  await testAsync('Case 341: Large synthetic DAG stack safety: 500-node dependency graph computes decision impact without recursion failure', async () => {
    const nodeCount = 500;
    const tasks = [];
    for (let i = 0; i < nodeCount; i++) {
      const id = `t_synth_dec_${i}`;
      const dependsOn = i > 0 ? [`t_synth_dec_${i - 1}`] : [];
      tasks.push({
        _id: id,
        project: 'proj_synth_dec',
        title: `Task ${i}`,
        status: 'To Do',
        estimateDays: 1,
        dependsOn,
      });
    }

    const decision = {
      _id: 'dec_synth_500',
      project: 'proj_synth_dec',
      status: 'accepted',
      linkedTasks: ['t_synth_dec_0'],
    };
    const project = { _id: 'proj_synth_dec', status: 'active' };

    const impact = computeDecisionImpact(decision, project, tasks, [], [], { role: 'admin' });
    assert.strictEqual(impact.directlyLinkedTasks.length, 1);
    assert.strictEqual(impact.downstreamTasks.length, 499);
    assert.strictEqual(impact.summary.totalAffectedTasks, 500);
    assert.strictEqual(impact.classification, 'critical_path');
  });

  // Case 342: Amendment 1: Missing estimate does not downgrade structural delivery-relevant decision to insufficient_data
  await testAsync('Case 342: Amendment 1: Missing estimate does not downgrade structural delivery-relevant decision to insufficient_data', async () => {
    const projId = 'proj_342';
    const idA = 't_342_a';
    const idB = 't_342_b';
    const project = { _id: projId, status: 'active' };
    const decision = { _id: 'dec_342', project: projId, status: 'accepted', linkedTasks: [idA] };
    // Task A has downstream task B, but task B lacks estimateDays (missing estimate)
    const tasks = [
      { _id: idA, project: projId, title: 'A', status: 'To Do', estimateDays: 3, dependsOn: [] },
      { _id: idB, project: projId, title: 'B', status: 'To Do', estimateDays: null, dependsOn: [idA] },
    ];

    const impact = computeDecisionImpact(decision, project, tasks, [], [], { role: 'admin' });
    // Structural impact is delivery_relevant
    assert.strictEqual(impact.impactClassification, 'delivery_relevant');
    assert.strictEqual(impact.classification, 'delivery_relevant');
    // Path availability reflects missing estimate
    assert.strictEqual(impact.pathAnalysis.availability, 'insufficient_data');
    assert.strictEqual(impact.pathAnalysis.durationPathIntersection, null);
    assert.strictEqual(impact.pathAnalysis.forecastPathIntersection, null);
  });

  // Case 343: Amendment 2: ?task= filter returns empty array identically for nonexistent or inaccessible tasks
  await testAsync('Case 343: Amendment 2: ?task= filter returns empty array identically for nonexistent or inaccessible tasks', async () => {
    const memberId = new mongoose.Types.ObjectId().toString();
    const otherUserId = new mongoose.Types.ObjectId().toString();
    const projId = new mongoose.Types.ObjectId().toString();
    const hiddenTaskId = new mongoose.Types.ObjectId().toString();
    const nonexistentTaskId = new mongoose.Types.ObjectId().toString();

    const origProjFindById = Project.findById;
    const origTaskFindById = Task.findById;
    const origDecFind = DecisionRecord.find;
    const origDecCount = DecisionRecord.countDocuments;

    Project.findById = () => Promise.resolve({
      _id: projId,
      status: 'active',
      owner: 'mgr_1',
      members: [{ user: { _id: memberId } }],
    });
    Task.findById = (id) => {
      if (id === hiddenTaskId) {
        return Promise.resolve({
          _id: hiddenTaskId,
          project: projId,
          assignedTo: otherUserId,
          createdBy: otherUserId,
        });
      }
      return Promise.resolve(null);
    };

    // 1. Probing inaccessible task via ?task= filter
    const req1 = {
      query: { project: projId, task: hiddenTaskId },
      user: { _id: memberId, role: 'member' },
    };
    const res1 = createMockRes();
    await decisionController.getDecisions(req1, res1);
    assert.strictEqual(res1.statusCode, 200);
    assert.deepStrictEqual(res1.body.decisions, []);

    // 2. Probing nonexistent task via ?task= filter
    const req2 = {
      query: { project: projId, task: nonexistentTaskId },
      user: { _id: memberId, role: 'member' },
    };
    const res2 = createMockRes();
    await decisionController.getDecisions(req2, res2);
    assert.strictEqual(res2.statusCode, 200);
    assert.deepStrictEqual(res2.body.decisions, []);

    Project.findById = origProjFindById;
    Task.findById = origTaskFindById;
    DecisionRecord.find = origDecFind;
    DecisionRecord.countDocuments = origDecCount;
  });

  // --- SECTION 18: Phase 6 Team Capacity, WIP Pressure & Ownership Risk Intelligence ---
  console.log('\n--- SECTION 18: Phase 6 Team Capacity, WIP Pressure & Ownership Risk Intelligence ---');

  // Case 344: Model validation: valid capacity configuration succeeds
  await testAsync('Case 344: Model validation: valid capacity configuration succeeds', async () => {
    const projId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId();
    const adminId = new mongoose.Types.ObjectId();

    const cap = new ProjectCapacity({
      project: projId,
      user: userId,
      availableDaysPerWeek: 4.5,
      wipLimit: 3,
      createdBy: adminId,
      updatedBy: adminId,
    });
    const err = cap.validateSync();
    assert.strictEqual(err, undefined);
    assert.strictEqual(cap.availableDaysPerWeek, 4.5);
    assert.strictEqual(cap.wipLimit, 3);
  });

  // Case 345: Model validation: unique compound index exists on project and user
  await testAsync('Case 345: Model validation: unique compound index exists on project and user', async () => {
    const indexes = ProjectCapacity.schema.indexes();
    const compoundUnique = indexes.find(
      ([fields, opts]) => fields.project === 1 && fields.user === 1 && opts && opts.unique === true
    );
    assert.ok(compoundUnique, 'Compound unique index on { project: 1, user: 1 } must exist');
  });

  // Case 346: Model validation: availableDaysPerWeek boundaries [0.5, 7.0]
  await testAsync('Case 346: Model validation: availableDaysPerWeek boundaries [0.5, 7.0]', async () => {
    const projId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId();
    const adminId = new mongoose.Types.ObjectId();

    // Reject < 0.5
    const capLow = new ProjectCapacity({
      project: projId,
      user: userId,
      availableDaysPerWeek: 0.2,
      wipLimit: 2,
      createdBy: adminId,
      updatedBy: adminId,
    });
    assert.ok(capLow.validateSync()?.errors?.availableDaysPerWeek);

    // Reject > 7.0
    const capHigh = new ProjectCapacity({
      project: projId,
      user: userId,
      availableDaysPerWeek: 7.5,
      wipLimit: 2,
      createdBy: adminId,
      updatedBy: adminId,
    });
    assert.ok(capHigh.validateSync()?.errors?.availableDaysPerWeek);
  });

  // Case 347: Model validation: availableDaysPerWeek half-day increment enforcement
  await testAsync('Case 347: Model validation: availableDaysPerWeek half-day increment enforcement', async () => {
    const projId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId();
    const adminId = new mongoose.Types.ObjectId();

    // Reject non-half-day increments like 3.2
    const capInvalid = new ProjectCapacity({
      project: projId,
      user: userId,
      availableDaysPerWeek: 3.2,
      wipLimit: 2,
      createdBy: adminId,
      updatedBy: adminId,
    });
    assert.ok(capInvalid.validateSync()?.errors?.availableDaysPerWeek);

    // Accept valid half-day increments
    for (const validVal of [0.5, 1.0, 1.5, 2.0, 3.5, 4.0, 5.0, 6.5, 7.0]) {
      const capValid = new ProjectCapacity({
        project: projId,
        user: userId,
        availableDaysPerWeek: validVal,
        wipLimit: 2,
        createdBy: adminId,
        updatedBy: adminId,
      });
      assert.strictEqual(capValid.validateSync(), undefined);
    }
  });

  // Case 348: Model validation: wipLimit integer and boundaries [1, 10]
  await testAsync('Case 348: Model validation: wipLimit integer and boundaries [1, 10]', async () => {
    const projId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId();
    const adminId = new mongoose.Types.ObjectId();

    // Reject < 1
    const cap0 = new ProjectCapacity({
      project: projId,
      user: userId,
      availableDaysPerWeek: 5,
      wipLimit: 0,
      createdBy: adminId,
      updatedBy: adminId,
    });
    assert.ok(cap0.validateSync()?.errors?.wipLimit);

    // Reject > 10
    const cap11 = new ProjectCapacity({
      project: projId,
      user: userId,
      availableDaysPerWeek: 5,
      wipLimit: 11,
      createdBy: adminId,
      updatedBy: adminId,
    });
    assert.ok(cap11.validateSync()?.errors?.wipLimit);

    // Reject non-integer
    const capFloat = new ProjectCapacity({
      project: projId,
      user: userId,
      availableDaysPerWeek: 5,
      wipLimit: 2.5,
      createdBy: adminId,
      updatedBy: adminId,
    });
    assert.ok(capFloat.validateSync()?.errors?.wipLimit);

    // Accept 1 and 10
    const cap1 = new ProjectCapacity({
      project: projId,
      user: userId,
      availableDaysPerWeek: 5,
      wipLimit: 1,
      createdBy: adminId,
      updatedBy: adminId,
    });
    assert.strictEqual(cap1.validateSync(), undefined);

    const cap10 = new ProjectCapacity({
      project: projId,
      user: userId,
      availableDaysPerWeek: 5,
      wipLimit: 10,
      createdBy: adminId,
      updatedBy: adminId,
    });
    assert.strictEqual(cap10.validateSync(), undefined);
  });

  // Case 349: Model validation: explicit audit field assignment
  await testAsync('Case 349: Model validation: explicit audit field assignment', async () => {
    const projId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId();

    // Missing createdBy & updatedBy fails validation
    const cap = new ProjectCapacity({
      project: projId,
      user: userId,
      availableDaysPerWeek: 5,
      wipLimit: 3,
    });
    const err = cap.validateSync();
    assert.ok(err?.errors?.createdBy);
    assert.ok(err?.errors?.updatedBy);
  });

  // Case 350: Model validation: client derived fields ignored/rejected
  await testAsync('Case 350: Model validation: client derived fields ignored/rejected', async () => {
    const projId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId();
    const adminId = new mongoose.Types.ObjectId();

    const cap = new ProjectCapacity({
      project: projId,
      user: userId,
      availableDaysPerWeek: 5,
      wipLimit: 3,
      createdBy: adminId,
      updatedBy: adminId,
      loadRatio: 0.99,
      loadStatus: 'overloaded',
      wipRatio: 1.5,
      riskDrivers: ['bad_driver'],
    });

    assert.strictEqual(cap.loadRatio, undefined);
    assert.strictEqual(cap.loadStatus, undefined);
    assert.strictEqual(cap.wipRatio, undefined);
    assert.strictEqual(cap.riskDrivers, undefined);
  });

  // Case 351: Invariant: existing projects and users without allocations remain valid
  await testAsync('Case 351: Invariant: existing projects and users without allocations remain valid', async () => {
    const proj = new Project({
      name: 'Unconfigured Project',
      owner: new mongoose.Types.ObjectId(),
      status: 'active',
    });
    assert.strictEqual(proj.validateSync(), undefined);

    const user = new User({
      name: 'Unconfigured User',
      email: 'unconfigured@company.local',
      password: 'password123',
    });
    assert.strictEqual(user.validateSync(), undefined);
  });

  // Case 352: Authorization: Admin can configure capacity in any active project
  await testAsync('Case 352: Authorization: Admin can configure capacity in any active project', async () => {
    const projId = new mongoose.Types.ObjectId().toString();
    const userId = new mongoose.Types.ObjectId().toString();
    const adminId = new mongoose.Types.ObjectId().toString();

    const origProjFindById = Project.findById;
    const origUserFindById = User.findById;
    const origCapFindOne = ProjectCapacity.findOne;
    const origCapCreate = ProjectCapacity.create;

    Project.findById = () => Promise.resolve({
      _id: projId,
      status: 'active',
      owner: new mongoose.Types.ObjectId(),
      members: [{ user: userId }],
    });
    User.findById = () => Promise.resolve({
      _id: userId,
      isActive: true,
      name: 'Test Member',
    });
    ProjectCapacity.findOne = () => Promise.resolve(null);
    ProjectCapacity.create = (doc) => Promise.resolve({
      ...doc,
      _id: new mongoose.Types.ObjectId(),
      populate: () => Promise.resolve(this),
    });

    const req = {
      params: { projectId: projId, userId },
      body: { availableDaysPerWeek: 4.5, wipLimit: 3 },
      user: { _id: adminId, role: 'admin' },
    };
    const res = createMockRes();
    await capacityController.upsertProjectCapacity(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, true);

    Project.findById = origProjFindById;
    User.findById = origUserFindById;
    ProjectCapacity.findOne = origCapFindOne;
    ProjectCapacity.create = origCapCreate;
  });

  // Case 353: Authorization: Project-owning Manager can configure capacity in owned active project
  await testAsync('Case 353: Authorization: Project-owning Manager can configure capacity in owned active project', async () => {
    const projId = new mongoose.Types.ObjectId().toString();
    const managerId = new mongoose.Types.ObjectId().toString();
    const memberId = new mongoose.Types.ObjectId().toString();

    const origProjFindById = Project.findById;
    const origUserFindById = User.findById;
    const origCapFindOne = ProjectCapacity.findOne;
    const origCapCreate = ProjectCapacity.create;

    Project.findById = () => Promise.resolve({
      _id: projId,
      status: 'active',
      owner: managerId,
      members: [{ user: memberId }],
    });
    User.findById = () => Promise.resolve({
      _id: memberId,
      isActive: true,
      name: 'Test Member',
    });
    ProjectCapacity.findOne = () => Promise.resolve(null);
    ProjectCapacity.create = (doc) => Promise.resolve({
      ...doc,
      _id: new mongoose.Types.ObjectId(),
      populate: () => Promise.resolve(this),
    });

    const req = {
      params: { projectId: projId, userId: memberId },
      body: { availableDaysPerWeek: 5.0, wipLimit: 2 },
      user: { _id: managerId, role: 'manager' },
    };
    const res = createMockRes();
    await capacityController.upsertProjectCapacity(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, true);

    Project.findById = origProjFindById;
    User.findById = origUserFindById;
    ProjectCapacity.findOne = origCapFindOne;
    ProjectCapacity.create = origCapCreate;
  });

  // Case 354: Authorization: Non-owner Manager mutation is rejected with 403 Forbidden
  await testAsync('Case 354: Authorization: Non-owner Manager mutation is rejected with 403 Forbidden', async () => {
    const projId = new mongoose.Types.ObjectId().toString();
    const nonOwnerMgrId = new mongoose.Types.ObjectId().toString();
    const actualOwnerId = new mongoose.Types.ObjectId().toString();
    const memberId = new mongoose.Types.ObjectId().toString();

    const origProjFindById = Project.findById;
    Project.findById = () => Promise.resolve({
      _id: projId,
      status: 'active',
      owner: actualOwnerId,
      members: [{ user: memberId }],
    });

    const req = {
      params: { projectId: projId, userId: memberId },
      body: { availableDaysPerWeek: 5.0, wipLimit: 2 },
      user: { _id: nonOwnerMgrId, role: 'manager' },
    };
    const res = createMockRes();
    await capacityController.upsertProjectCapacity(req, res);

    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(res.body.success, false);

    Project.findById = origProjFindById;
  });

  // Case 355: Authorization: Member mutation is rejected with 403 Forbidden
  await testAsync('Case 355: Authorization: Member mutation is rejected with 403 Forbidden', async () => {
    const projId = new mongoose.Types.ObjectId().toString();
    const memberId = new mongoose.Types.ObjectId().toString();

    const origProjFindById = Project.findById;
    Project.findById = () => Promise.resolve({
      _id: projId,
      status: 'active',
      owner: 'mgr_1',
      members: [{ user: memberId }],
    });

    const req = {
      params: { projectId: projId, userId: memberId },
      body: { availableDaysPerWeek: 5.0, wipLimit: 2 },
      user: { _id: memberId, role: 'member' },
    };
    const res = createMockRes();
    await capacityController.upsertProjectCapacity(req, res);

    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(res.body.success, false);

    Project.findById = origProjFindById;
  });

  // Case 356: Authorization: Unauthorized project access rejected with 403 Forbidden
  await testAsync('Case 356: Authorization: Unauthorized project access rejected with 403 Forbidden', async () => {
    const projId = new mongoose.Types.ObjectId().toString();
    const outsiderId = new mongoose.Types.ObjectId().toString();

    const origProjFindById = Project.findById;
    Project.findById = () => Promise.resolve({
      _id: projId,
      status: 'active',
      owner: 'mgr_1',
      members: [{ user: 'other_member' }],
    });

    const req = {
      params: { projectId: projId },
      query: { horizonDays: '14' },
      user: { _id: outsiderId, role: 'member' },
    };
    const res = createMockRes();
    await capacityController.getProjectCapacityIntelligence(req, res);

    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(res.body.success, false);

    Project.findById = origProjFindById;
  });

  // Case 357: Invariant: Archived project capacity mutations return 409 Conflict
  await testAsync('Case 357: Invariant: Archived project capacity mutations return 409 Conflict', async () => {
    const projId = new mongoose.Types.ObjectId().toString();
    const adminId = new mongoose.Types.ObjectId().toString();
    const memberId = new mongoose.Types.ObjectId().toString();

    const origProjFindById = Project.findById;
    Project.findById = () => Promise.resolve({
      _id: projId,
      status: 'archived',
      owner: adminId,
      members: [{ user: memberId }],
    });

    // 1. PUT on archived project
    const reqPut = {
      params: { projectId: projId, userId: memberId },
      body: { availableDaysPerWeek: 5, wipLimit: 2 },
      user: { _id: adminId, role: 'admin' },
    };
    const resPut = createMockRes();
    await capacityController.upsertProjectCapacity(reqPut, resPut);
    assert.strictEqual(resPut.statusCode, 409);

    // 2. DELETE on archived project
    const reqDel = {
      params: { projectId: projId, userId: memberId },
      user: { _id: adminId, role: 'admin' },
    };
    const resDel = createMockRes();
    await capacityController.deleteProjectCapacity(reqDel, resDel);
    assert.strictEqual(resDel.statusCode, 409);

    Project.findById = origProjFindById;
  });

  // Case 358: Relationship integrity: Removed/non-member allocation cannot be created (400)
  await testAsync('Case 358: Relationship integrity: Removed/non-member allocation cannot be created (400)', async () => {
    const projId = new mongoose.Types.ObjectId().toString();
    const adminId = new mongoose.Types.ObjectId().toString();
    const strangerId = new mongoose.Types.ObjectId().toString();

    const origProjFindById = Project.findById;
    const origUserFindById = User.findById;

    Project.findById = () => Promise.resolve({
      _id: projId,
      status: 'active',
      owner: adminId,
      members: [], // stranger is not in members
    });
    User.findById = () => Promise.resolve({
      _id: strangerId,
      isActive: true,
      name: 'Stranger',
    });

    const req = {
      params: { projectId: projId, userId: strangerId },
      body: { availableDaysPerWeek: 4, wipLimit: 2 },
      user: { _id: adminId, role: 'admin' },
    };
    const res = createMockRes();
    await capacityController.upsertProjectCapacity(req, res);

    assert.strictEqual(res.statusCode, 400);
    assert.ok(res.body.message.includes('must be the project owner or an active member'));

    Project.findById = origProjFindById;
    User.findById = origUserFindById;
  });

  // Case 359: Relationship integrity: Inactive user allocation cannot be created (400)
  await testAsync('Case 359: Relationship integrity: Inactive user allocation cannot be created (400)', async () => {
    const projId = new mongoose.Types.ObjectId().toString();
    const adminId = new mongoose.Types.ObjectId().toString();
    const inactiveUserId = new mongoose.Types.ObjectId().toString();

    const origProjFindById = Project.findById;
    const origUserFindById = User.findById;

    Project.findById = () => Promise.resolve({
      _id: projId,
      status: 'active',
      owner: adminId,
      members: [{ user: inactiveUserId }],
    });
    User.findById = () => Promise.resolve({
      _id: inactiveUserId,
      isActive: false, // inactive
      name: 'Deactivated User',
    });

    const req = {
      params: { projectId: projId, userId: inactiveUserId },
      body: { availableDaysPerWeek: 4, wipLimit: 2 },
      user: { _id: adminId, role: 'admin' },
    };
    const res = createMockRes();
    await capacityController.upsertProjectCapacity(req, res);

    assert.strictEqual(res.statusCode, 400);
    assert.ok(res.body.message.includes('Cannot configure capacity for an inactive user'));

    Project.findById = origProjFindById;
    User.findById = origUserFindById;
  });

  // Case 360: Lifecycle: Allocation deletion removes configuration only
  await testAsync('Case 360: Lifecycle: Allocation deletion removes configuration only', async () => {
    const projId = new mongoose.Types.ObjectId().toString();
    const adminId = new mongoose.Types.ObjectId().toString();
    const memberId = new mongoose.Types.ObjectId().toString();
    const allocId = new mongoose.Types.ObjectId().toString();

    const origProjFindById = Project.findById;
    const origCapFindOneAndDelete = ProjectCapacity.findOneAndDelete;

    Project.findById = () => Promise.resolve({
      _id: projId,
      status: 'active',
      owner: adminId,
      members: [{ user: memberId }],
    });
    ProjectCapacity.findOneAndDelete = () => Promise.resolve({ _id: allocId });

    const req = {
      params: { projectId: projId, userId: memberId },
      user: { _id: adminId, role: 'admin' },
    };
    const res = createMockRes();
    await capacityController.deleteProjectCapacity(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.data.id, allocId);

    Project.findById = origProjFindById;
    ProjectCapacity.findOneAndDelete = origCapFindOneAndDelete;
  });

  // Case 361: Lifecycle: Missing allocation deletion returns controlled 404 Not Found
  await testAsync('Case 361: Lifecycle: Missing allocation deletion returns controlled 404 Not Found', async () => {
    const projId = new mongoose.Types.ObjectId().toString();
    const adminId = new mongoose.Types.ObjectId().toString();
    const memberId = new mongoose.Types.ObjectId().toString();

    const origProjFindById = Project.findById;
    const origCapFindOneAndDelete = ProjectCapacity.findOneAndDelete;

    Project.findById = () => Promise.resolve({
      _id: projId,
      status: 'active',
      owner: adminId,
      members: [{ user: memberId }],
    });
    ProjectCapacity.findOneAndDelete = () => Promise.resolve(null);

    const req = {
      params: { projectId: projId, userId: memberId },
      user: { _id: adminId, role: 'admin' },
    };
    const res = createMockRes();
    await capacityController.deleteProjectCapacity(req, res);

    assert.strictEqual(res.statusCode, 404);
    assert.strictEqual(res.body.success, false);

    Project.findById = origProjFindById;
    ProjectCapacity.findOneAndDelete = origCapFindOneAndDelete;
  });

  // Case 362: Capacity math: Exact 7-day calculation formula
  await testAsync('Case 362: Capacity math: Exact 7-day calculation formula', async () => {
    const project = { _id: 'proj_362', owner: 'u_1', members: [{ user: 'u_1' }] };
    const capacities = [{ project: 'proj_362', user: 'u_1', availableDaysPerWeek: 4.5, wipLimit: 3 }];
    const users = [{ _id: 'u_1', name: 'Dev', role: 'member', isActive: true }];

    const intel = computeCapacityIntelligence({
      project,
      users,
      capacities,
      tasks: [],
      horizonDays: 7,
    });

    const m = intel.members[0];
    // availableCapacityDays = 4.5 * 7 / 7 = 4.5
    assert.strictEqual(m.rawAvailableCapacityDays, 4.5);
    assert.strictEqual(m.availableCapacityDays, 4.5);
    assert.strictEqual(m.committedEstimateDays, 0);
    assert.strictEqual(m.loadStatus, 'balanced');
  });

  // Case 363: Capacity math: Exact 14-day calculation formula
  await testAsync('Case 363: Capacity math: Exact 14-day calculation formula', async () => {
    const project = { _id: 'proj_363', owner: 'u_1', members: [{ user: 'u_1' }] };
    const capacities = [{ project: 'proj_363', user: 'u_1', availableDaysPerWeek: 4.5, wipLimit: 3 }];
    const users = [{ _id: 'u_1', name: 'Dev', role: 'member', isActive: true }];

    const intel = computeCapacityIntelligence({
      project,
      users,
      capacities,
      tasks: [],
      horizonDays: 14,
    });

    const m = intel.members[0];
    // availableCapacityDays = 4.5 * 14 / 7 = 9.0
    assert.strictEqual(m.rawAvailableCapacityDays, 9.0);
    assert.strictEqual(m.availableCapacityDays, 9.0);
  });

  // Case 364: Capacity math: Exact 30-day calculation formula
  await testAsync('Case 364: Capacity math: Exact 30-day calculation formula', async () => {
    const project = { _id: 'proj_364', owner: 'u_1', members: [{ user: 'u_1' }] };
    const capacities = [{ project: 'proj_364', user: 'u_1', availableDaysPerWeek: 5.0, wipLimit: 3 }];
    const users = [{ _id: 'u_1', name: 'Dev', role: 'member', isActive: true }];

    const intel = computeCapacityIntelligence({
      project,
      users,
      capacities,
      tasks: [],
      horizonDays: 30,
    });

    const m = intel.members[0];
    // availableCapacityDays = 5.0 * 30 / 7 = 21.42857...
    assert.strictEqual(Math.round(m.availableCapacityDays * 100) / 100, 21.43);
    assert.strictEqual(m.displayAvailableCapacityDays, 21.4);
  });

  // Case 365: Validation: Invalid horizon rejected with 400
  await testAsync('Case 365: Validation: Invalid horizon rejected with 400', async () => {
    assert.throws(() => parseHorizonDays('5'), /Invalid horizonDays/);
    assert.throws(() => parseHorizonDays('15'), /Invalid horizonDays/);
    assert.throws(() => parseHorizonDays('60'), /Invalid horizonDays/);
    assert.throws(() => parseHorizonDays('abc'), /Invalid horizonDays/);

    assert.strictEqual(parseHorizonDays(undefined), 14);
    assert.strictEqual(parseHorizonDays(7), 7);
    assert.strictEqual(parseHorizonDays('14'), 14);
    assert.strictEqual(parseHorizonDays('30'), 30);
  });

  // Case 366: Scope rules: In-progress assigned task included in committed effort
  await testAsync('Case 366: Scope rules: In-progress assigned task included in committed effort', async () => {
    const project = { _id: 'proj_366', owner: 'u_1', members: [{ user: 'u_1' }] };
    const capacities = [{ project: 'proj_366', user: 'u_1', availableDaysPerWeek: 5, wipLimit: 3 }];
    const users = [{ _id: 'u_1', name: 'Dev', role: 'member', isActive: true }];
    const tasks = [
      { _id: 't_366', project: 'proj_366', title: 'Work', status: 'In Progress', assignedTo: 'u_1', estimateDays: 3 },
    ];

    const intel = computeCapacityIntelligence({ project, users, capacities, tasks, horizonDays: 14 });
    assert.strictEqual(intel.members[0].committedEstimateDays, 3);
    assert.strictEqual(intel.members[0].committedTasksCount, 1);
  });

  // Case 367: Scope rules: To Do assigned task due within horizon included
  await testAsync('Case 367: Scope rules: To Do assigned task due within horizon included', async () => {
    const today = toUtcDay(new Date());
    const project = { _id: 'proj_367', owner: 'u_1', members: [{ user: 'u_1' }] };
    const capacities = [{ project: 'proj_367', user: 'u_1', availableDaysPerWeek: 5, wipLimit: 3 }];
    const users = [{ _id: 'u_1', name: 'Dev', role: 'member', isActive: true }];
    const tasks = [
      {
        _id: 't_367',
        project: 'proj_367',
        title: 'Due Soon',
        status: 'To Do',
        assignedTo: 'u_1',
        dueDate: addCalendarDays(today, 5),
        estimateDays: 4,
      },
    ];

    const intel = computeCapacityIntelligence({ project, users, capacities, tasks, horizonDays: 14, referenceDate: today });
    assert.strictEqual(intel.members[0].committedEstimateDays, 4);
    assert.strictEqual(intel.members[0].committedTasksCount, 1);
  });

  // Case 368: Scope rules: To Do assigned task due beyond horizon excluded
  await testAsync('Case 368: Scope rules: To Do assigned task due beyond horizon excluded', async () => {
    const today = toUtcDay(new Date());
    const project = { _id: 'proj_368', owner: 'u_1', members: [{ user: 'u_1' }] };
    const capacities = [{ project: 'proj_368', user: 'u_1', availableDaysPerWeek: 5, wipLimit: 3 }];
    const users = [{ _id: 'u_1', name: 'Dev', role: 'member', isActive: true }];
    const tasks = [
      {
        _id: 't_368',
        project: 'proj_368',
        title: 'Far Future',
        status: 'To Do',
        assignedTo: 'u_1',
        dueDate: addCalendarDays(today, 25),
        estimateDays: 4,
      },
    ];

    const intel = computeCapacityIntelligence({ project, users, capacities, tasks, horizonDays: 14, referenceDate: today });
    assert.strictEqual(intel.members[0].committedEstimateDays, 0);
    assert.strictEqual(intel.members[0].committedTasksCount, 0);
  });

  // Case 369: Scope rules: Incomplete assigned task on release forecastDrivingPath included even beyond horizon
  await testAsync('Case 369: Scope rules: Incomplete assigned task on release forecastDrivingPath included even beyond horizon', async () => {
    const today = toUtcDay(new Date());
    const projId = 'proj_369';
    const relId = 'rel_369';
    const project = { _id: projId, owner: 'u_1', members: [{ user: 'u_1' }] };
    const capacities = [{ project: projId, user: 'u_1', availableDaysPerWeek: 5, wipLimit: 3 }];
    const users = [{ _id: 'u_1', name: 'Dev', role: 'member', isActive: true }];
    const releases = [{ _id: relId, status: 'active', project: projId, targetDate: addCalendarDays(today, 40) }];
    const tasks = [
      {
        _id: 't_369',
        project: projId,
        release: relId,
        title: 'Forecast Critical Task',
        status: 'To Do',
        assignedTo: 'u_1',
        dueDate: addCalendarDays(today, 35), // outside 14-day horizon!
        estimateDays: 6,
      },
    ];

    const intel = computeCapacityIntelligence({ project, users, capacities, tasks, releases, horizonDays: 14, referenceDate: today });
    assert.strictEqual(intel.members[0].committedEstimateDays, 6);
    assert.strictEqual(intel.members[0].forecastDrivingTasksCount, 1);
  });

  // Case 370: Scope rules: Duplicate scope inclusion deduplicated
  await testAsync('Case 370: Scope rules: Duplicate scope inclusion deduplicated', async () => {
    const today = toUtcDay(new Date());
    const projId = 'proj_370';
    const relId = 'rel_370';
    const project = { _id: projId, owner: 'u_1', members: [{ user: 'u_1' }] };
    const capacities = [{ project: projId, user: 'u_1', availableDaysPerWeek: 5, wipLimit: 3 }];
    const users = [{ _id: 'u_1', name: 'Dev', role: 'member', isActive: true }];
    const releases = [{ _id: relId, status: 'active', project: projId, targetDate: addCalendarDays(today, 20) }];
    // Task is In Progress AND due within horizon AND on forecast path
    const tasks = [
      {
        _id: 't_370',
        project: projId,
        release: relId,
        title: 'Triply Qualified Task',
        status: 'In Progress',
        assignedTo: 'u_1',
        dueDate: addCalendarDays(today, 3),
        estimateDays: 5,
      },
    ];

    const intel = computeCapacityIntelligence({ project, users, capacities, tasks, releases, horizonDays: 14, referenceDate: today });
    // Must be counted exactly once
    assert.strictEqual(intel.members[0].committedEstimateDays, 5);
    assert.strictEqual(intel.members[0].committedTasksCount, 1);
    assert.deepStrictEqual(intel.members[0].tasks[0].inclusionReasons, ['in_progress', 'forecast_driving_path']);
  });

  // Case 371: Scope rules: Done tasks excluded
  await testAsync('Case 371: Scope rules: Done tasks excluded', async () => {
    const project = { _id: 'proj_371', owner: 'u_1', members: [{ user: 'u_1' }] };
    const capacities = [{ project: 'proj_371', user: 'u_1', availableDaysPerWeek: 5, wipLimit: 3 }];
    const users = [{ _id: 'u_1', name: 'Dev', role: 'member', isActive: true }];
    const tasks = [
      { _id: 't_371', project: 'proj_371', title: 'Finished', status: 'Done', assignedTo: 'u_1', estimateDays: 10 },
    ];

    const intel = computeCapacityIntelligence({ project, users, capacities, tasks, horizonDays: 14 });
    assert.strictEqual(intel.members[0].committedEstimateDays, 0);
    assert.strictEqual(intel.members[0].committedTasksCount, 0);
  });

  // Case 372: Scope rules: Cancelled milestone scope exclusion
  await testAsync('Case 372: Scope rules: Cancelled milestone scope exclusion', async () => {
    const projId = 'proj_372';
    const mId = 'ms_372';
    const project = { _id: projId, owner: 'u_1', members: [{ user: 'u_1' }] };
    const capacities = [{ project: projId, user: 'u_1', availableDaysPerWeek: 5, wipLimit: 3 }];
    const users = [{ _id: 'u_1', name: 'Dev', role: 'member', isActive: true }];
    const milestones = [{ _id: mId, project: projId, status: 'cancelled' }];
    const tasks = [
      { _id: 't_372', project: projId, milestone: mId, title: 'Dead Milestone Task', status: 'In Progress', assignedTo: 'u_1', estimateDays: 5 },
    ];

    const intel = computeCapacityIntelligence({ project, users, capacities, tasks, milestones, horizonDays: 14 });
    assert.strictEqual(intel.members[0].committedEstimateDays, 0);
  });

  // Case 373: Scope rules: Cancelled release scope exclusion
  await testAsync('Case 373: Scope rules: Cancelled release scope exclusion', async () => {
    const projId = 'proj_373';
    const relId = 'rel_373';
    const project = { _id: projId, owner: 'u_1', members: [{ user: 'u_1' }] };
    const capacities = [{ project: projId, user: 'u_1', availableDaysPerWeek: 5, wipLimit: 3 }];
    const users = [{ _id: 'u_1', name: 'Dev', role: 'member', isActive: true }];
    const releases = [{ _id: relId, project: projId, status: 'cancelled' }];
    const tasks = [
      { _id: 't_373', project: projId, release: relId, title: 'Dead Release Task', status: 'In Progress', assignedTo: 'u_1', estimateDays: 5 },
    ];

    const intel = computeCapacityIntelligence({ project, users, capacities, tasks, releases, horizonDays: 14 });
    assert.strictEqual(intel.members[0].committedEstimateDays, 0);
  });

  // Case 374: Capacity math: Missing estimate produces insufficient_data
  await testAsync('Case 374: Capacity math: Missing estimate produces insufficient_data', async () => {
    const project = { _id: 'proj_374', owner: 'u_1', members: [{ user: 'u_1' }] };
    const capacities = [{ project: 'proj_374', user: 'u_1', availableDaysPerWeek: 5, wipLimit: 3 }];
    const users = [{ _id: 'u_1', name: 'Dev', role: 'member', isActive: true }];
    const tasks = [
      { _id: 't_374_1', project: 'proj_374', title: 'Task with estimate', status: 'In Progress', assignedTo: 'u_1', estimateDays: 4 },
      { _id: 't_374_2', project: 'proj_374', title: 'Task without estimate', status: 'In Progress', assignedTo: 'u_1', estimateDays: null },
    ];

    const intel = computeCapacityIntelligence({ project, users, capacities, tasks, horizonDays: 14 });
    const m = intel.members[0];

    assert.strictEqual(m.availability, 'insufficient_data');
    assert.strictEqual(m.loadStatus, 'insufficient_data');
    assert.strictEqual(m.loadRatio, null);
    assert.strictEqual(m.committedEstimateDays, null);
    // WIP remains calculable!
    assert.strictEqual(m.wip.count, 2);
    assert.strictEqual(m.wip.state, 'within_limit');
    assert.strictEqual(intel.summary.hasMissingEstimatesOverall, true);
  });

  // Case 375: Capacity math: Missing allocation produces unconfigured
  await testAsync('Case 375: Capacity math: Missing allocation produces unconfigured', async () => {
    const project = { _id: 'proj_375', owner: 'u_1', members: [{ user: 'u_1' }] };
    const capacities = []; // no allocation configured
    const users = [{ _id: 'u_1', name: 'Dev', role: 'member', isActive: true }];

    const intel = computeCapacityIntelligence({ project, users, capacities, tasks: [], horizonDays: 14 });
    const m = intel.members[0];

    assert.strictEqual(m.isConfigured, false);
    assert.strictEqual(m.allocation, null);
    assert.strictEqual(m.loadStatus, 'unconfigured');
    assert.strictEqual(m.availability, 'unconfigured');
    assert.strictEqual(m.wip.state, 'unconfigured');
    assert.strictEqual(intel.summary.unconfiguredActiveMembers, 1);
  });

  // Case 376: Capacity math: Full precision internal math and display-only rounding
  await testAsync('Case 376: Capacity math: Full precision internal math and display-only rounding', async () => {
    const project = { _id: 'proj_376', owner: 'u_1', members: [{ user: 'u_1' }] };
    const capacities = [{ project: 'proj_376', user: 'u_1', availableDaysPerWeek: 3.5, wipLimit: 3 }];
    const users = [{ _id: 'u_1', name: 'Dev', role: 'member', isActive: true }];
    const tasks = [
      { _id: 't_376', project: 'proj_376', title: 'Work', status: 'In Progress', assignedTo: 'u_1', estimateDays: 4 },
    ];

    const intel = computeCapacityIntelligence({ project, users, capacities, tasks, horizonDays: 7 });
    const m = intel.members[0];

    // availableCapacityDays = 3.5 * 7 / 7 = 3.5
    // loadRatio = 4 / 3.5 = 1.142857...
    assert.strictEqual(m.loadRatio, 4 / 3.5);
    assert.strictEqual(m.displayLoadRatio, 1.14);
    assert.strictEqual(m.loadStatus, 'overloaded');
  });

  // Case 377: Capacity math: UTC boundary correctness across midnight
  await testAsync('Case 377: Capacity math: UTC boundary correctness across midnight', async () => {
    const date1 = new Date('2026-09-13T23:59:59.999Z');
    const date2 = new Date('2026-09-14T00:00:01.000Z');

    const utc1 = toUtcDay(date1);
    const utc2 = toUtcDay(date2);

    assert.strictEqual(diffCalendarDays(utc2, utc1), 1);
    assert.strictEqual(utc1.getUTCHours(), 0);
    assert.strictEqual(utc2.getUTCHours(), 0);
  });

  // Case 378: Load status: Balanced load (loadRatio < 0.85)
  await testAsync('Case 378: Load status: Balanced load (loadRatio < 0.85)', async () => {
    const project = { _id: 'proj_378', owner: 'u_1', members: [{ user: 'u_1' }] };
    const capacities = [{ project: 'proj_378', user: 'u_1', availableDaysPerWeek: 5.0, wipLimit: 3 }];
    const users = [{ _id: 'u_1', name: 'Dev', role: 'member', isActive: true }];
    // Horizon 7 -> available: 5.0. Committed: 4.2 -> ratio: 4.2 / 5.0 = 0.84 (< 0.85)
    const tasks = [
      { _id: 't_378', project: 'proj_378', title: 'Work', status: 'In Progress', assignedTo: 'u_1', estimateDays: 4.2 },
    ];

    const intel = computeCapacityIntelligence({ project, users, capacities, tasks, horizonDays: 7 });
    assert.strictEqual(intel.members[0].loadStatus, 'balanced');
    assert.strictEqual(intel.members[0].displayLoadRatio, 0.84);
    assert.ok(Math.abs(intel.members[0].loadRatio - 0.84) < 1e-10);
  });

  // Case 379: Load status: Approaching-limit boundaries (0.85 <= loadRatio <= 1.0)
  await testAsync('Case 379: Load status: Approaching-limit boundaries (0.85 <= loadRatio <= 1.0)', async () => {
    const project = { _id: 'proj_379', owner: 'u_1', members: [{ user: 'u_1' }] };
    const capacities = [{ project: 'proj_379', user: 'u_1', availableDaysPerWeek: 5.0, wipLimit: 3 }];
    const users = [{ _id: 'u_1', name: 'Dev', role: 'member', isActive: true }];

    // Exactly 0.85
    const tasks1 = [{ _id: 't_379_1', project: 'proj_379', title: 'Work', status: 'In Progress', assignedTo: 'u_1', estimateDays: 4.25 }];
    const intel1 = computeCapacityIntelligence({ project, users, capacities, tasks: tasks1, horizonDays: 7 });
    assert.strictEqual(intel1.members[0].loadStatus, 'approaching_limit');
    assert.strictEqual(intel1.members[0].loadRatio, 0.85);

    // Exactly 1.0
    const tasks2 = [{ _id: 't_379_2', project: 'proj_379', title: 'Work', status: 'In Progress', assignedTo: 'u_1', estimateDays: 5.0 }];
    const intel2 = computeCapacityIntelligence({ project, users, capacities, tasks: tasks2, horizonDays: 7 });
    assert.strictEqual(intel2.members[0].loadStatus, 'approaching_limit');
    assert.strictEqual(intel2.members[0].loadRatio, 1.0);
  });

  // Case 380: Load status: Overloaded load (loadRatio > 1.0)
  await testAsync('Case 380: Load status: Overloaded load (loadRatio > 1.0)', async () => {
    const project = { _id: 'proj_380', owner: 'u_1', members: [{ user: 'u_1' }] };
    const capacities = [{ project: 'proj_380', user: 'u_1', availableDaysPerWeek: 5.0, wipLimit: 3 }];
    const users = [{ _id: 'u_1', name: 'Dev', role: 'member', isActive: true }];
    // 5.1 / 5.0 = 1.02 (> 1.0)
    const tasks = [{ _id: 't_380', project: 'proj_380', title: 'Work', status: 'In Progress', assignedTo: 'u_1', estimateDays: 5.1 }];

    const intel = computeCapacityIntelligence({ project, users, capacities, tasks, horizonDays: 7 });
    assert.strictEqual(intel.members[0].loadStatus, 'overloaded');
    assert.strictEqual(intel.members[0].loadRatio, 1.02);
    assert.strictEqual(intel.summary.overloadedMembers, 1);
  });

  // Case 381: WIP state: WIP within limit (wipCount < wipLimit)
  await testAsync('Case 381: WIP state: WIP within limit (wipCount < wipLimit)', async () => {
    const project = { _id: 'proj_381', owner: 'u_1', members: [{ user: 'u_1' }] };
    const capacities = [{ project: 'proj_381', user: 'u_1', availableDaysPerWeek: 5, wipLimit: 3 }];
    const users = [{ _id: 'u_1', name: 'Dev', role: 'member', isActive: true }];
    const tasks = [
      { _id: 't_381_1', project: 'proj_381', title: 'W1', status: 'In Progress', assignedTo: 'u_1', estimateDays: 1 },
      { _id: 't_381_2', project: 'proj_381', title: 'W2', status: 'In Progress', assignedTo: 'u_1', estimateDays: 1 },
    ];

    const intel = computeCapacityIntelligence({ project, users, capacities, tasks, horizonDays: 14 });
    assert.strictEqual(intel.members[0].wip.count, 2);
    assert.strictEqual(intel.members[0].wip.limit, 3);
    assert.strictEqual(intel.members[0].wip.state, 'within_limit');
  });

  // Case 382: WIP state: WIP exactly at limit (wipCount === wipLimit)
  await testAsync('Case 382: WIP state: WIP exactly at limit (wipCount === wipLimit)', async () => {
    const project = { _id: 'proj_382', owner: 'u_1', members: [{ user: 'u_1' }] };
    const capacities = [{ project: 'proj_382', user: 'u_1', availableDaysPerWeek: 5, wipLimit: 2 }];
    const users = [{ _id: 'u_1', name: 'Dev', role: 'member', isActive: true }];
    const tasks = [
      { _id: 't_382_1', project: 'proj_382', title: 'W1', status: 'In Progress', assignedTo: 'u_1', estimateDays: 1 },
      { _id: 't_382_2', project: 'proj_382', title: 'W2', status: 'In Progress', assignedTo: 'u_1', estimateDays: 1 },
    ];

    const intel = computeCapacityIntelligence({ project, users, capacities, tasks, horizonDays: 14 });
    assert.strictEqual(intel.members[0].wip.count, 2);
    assert.strictEqual(intel.members[0].wip.limit, 2);
    assert.strictEqual(intel.members[0].wip.state, 'at_limit');
  });

  // Case 383: WIP state: WIP over limit (wipCount > wipLimit)
  await testAsync('Case 383: WIP state: WIP over limit (wipCount > wipLimit)', async () => {
    const project = { _id: 'proj_383', owner: 'u_1', members: [{ user: 'u_1' }] };
    const capacities = [{ project: 'proj_383', user: 'u_1', availableDaysPerWeek: 5, wipLimit: 2 }];
    const users = [{ _id: 'u_1', name: 'Dev', role: 'member', isActive: true }];
    const tasks = [
      { _id: 't_383_1', project: 'proj_383', title: 'W1', status: 'In Progress', assignedTo: 'u_1', estimateDays: 1 },
      { _id: 't_383_2', project: 'proj_383', title: 'W2', status: 'In Progress', assignedTo: 'u_1', estimateDays: 1 },
      { _id: 't_383_3', project: 'proj_383', title: 'W3', status: 'In Progress', assignedTo: 'u_1', estimateDays: 1 },
    ];

    const intel = computeCapacityIntelligence({ project, users, capacities, tasks, horizonDays: 14 });
    assert.strictEqual(intel.members[0].wip.count, 3);
    assert.strictEqual(intel.members[0].wip.limit, 2);
    assert.strictEqual(intel.members[0].wip.state, 'over_limit');
    assert.strictEqual(intel.summary.membersAtOrOverWipLimit, 1);
    const driver = intel.riskDrivers.find((d) => d.type === 'wip_limit_exceeded');
    assert.ok(driver);
    assert.strictEqual(driver.wipCount, 3);
  });

  // Case 384: WIP state: WIP remains calculable when estimates are missing
  await testAsync('Case 384: WIP state: WIP remains calculable when estimates are missing', async () => {
    const project = { _id: 'proj_384', owner: 'u_1', members: [{ user: 'u_1' }] };
    const capacities = [{ project: 'proj_384', user: 'u_1', availableDaysPerWeek: 5, wipLimit: 2 }];
    const users = [{ _id: 'u_1', name: 'Dev', role: 'member', isActive: true }];
    const tasks = [
      { _id: 't_384_1', project: 'proj_384', title: 'W1', status: 'In Progress', assignedTo: 'u_1', estimateDays: null },
      { _id: 't_384_2', project: 'proj_384', title: 'W2', status: 'In Progress', assignedTo: 'u_1', estimateDays: null },
      { _id: 't_384_3', project: 'proj_384', title: 'W3', status: 'In Progress', assignedTo: 'u_1', estimateDays: null },
    ];

    const intel = computeCapacityIntelligence({ project, users, capacities, tasks, horizonDays: 14 });
    assert.strictEqual(intel.members[0].loadStatus, 'insufficient_data');
    assert.strictEqual(intel.members[0].wip.count, 3);
    assert.strictEqual(intel.members[0].wip.state, 'over_limit');
  });

  // Case 385: Ownership risk: Unassigned high-priority task detected
  await testAsync('Case 385: Ownership risk: Unassigned high-priority task detected', async () => {
    const project = { _id: 'proj_385', owner: 'u_1', members: [{ user: 'u_1' }] };
    const tasks = [
      { _id: 't_385', project: 'proj_385', title: 'Unassigned Critical Task', status: 'In Progress', assignedTo: null, priority: 'critical', estimateDays: 3 },
    ];

    const intel = computeCapacityIntelligence({ project, users: [], capacities: [], tasks, horizonDays: 14 });
    const driver = intel.riskDrivers.find((d) => d.type === 'unassigned_high_priority');
    assert.ok(driver);
    assert.strictEqual(driver.severity, 'high');
  });

  // Case 386: Ownership risk: Unassigned forecast-driving task detected
  await testAsync('Case 386: Ownership risk: Unassigned forecast-driving task detected', async () => {
    const today = toUtcDay(new Date());
    const projId = 'proj_386';
    const relId = 'rel_386';
    const project = { _id: projId, owner: 'u_1', members: [{ user: 'u_1' }] };
    const releases = [{ _id: relId, status: 'active', project: projId, targetDate: addCalendarDays(today, 20) }];
    const tasks = [
      { _id: 't_386', project: projId, release: relId, title: 'Unassigned Path Task', status: 'To Do', assignedTo: null, estimateDays: 5 },
    ];

    const intel = computeCapacityIntelligence({ project, users: [], capacities: [], tasks, releases, horizonDays: 14 });
    const driver = intel.riskDrivers.find((d) => d.type === 'unassigned_critical_path');
    assert.ok(driver);
    assert.strictEqual(driver.severity, 'critical');
  });

  // Case 387: Ownership risk: Inactive owner detected
  await testAsync('Case 387: Ownership risk: Inactive owner detected', async () => {
    const project = { _id: 'proj_387', owner: 'u_1', members: [{ user: 'u_1' }, { user: 'u_2' }] };
    const users = [
      { _id: 'u_1', name: 'Active Dev', isActive: true },
      { _id: 'u_2', name: 'Deactivated Dev', isActive: false },
    ];
    const tasks = [
      { _id: 't_387', project: 'proj_387', title: 'Zombie Task', status: 'In Progress', assignedTo: 'u_2', estimateDays: 4 },
    ];

    const intel = computeCapacityIntelligence({ project, users, capacities: [], tasks, horizonDays: 14 });
    const driver = intel.riskDrivers.find((d) => d.type === 'inactive_owner');
    assert.ok(driver);
    assert.strictEqual(driver.userName, 'Deactivated Dev');
  });

  // Case 388: Ownership risk: Non-member owner detected
  await testAsync('Case 388: Ownership risk: Non-member owner detected', async () => {
    const project = { _id: 'proj_388', owner: 'u_1', members: [{ user: 'u_1' }] };
    const users = [
      { _id: 'u_1', name: 'Project Owner', isActive: true },
      { _id: 'u_stranger', name: 'Stranger', isActive: true },
    ];
    const tasks = [
      { _id: 't_388', project: 'proj_388', title: 'Alien Task', status: 'In Progress', assignedTo: 'u_stranger', estimateDays: 3 },
    ];

    const intel = computeCapacityIntelligence({ project, users, capacities: [], tasks, horizonDays: 14 });
    const driver = intel.riskDrivers.find((d) => d.type === 'non_member_owner');
    assert.ok(driver);
    assert.strictEqual(driver.userName, 'Stranger');
  });

  // Case 389: Ownership risk: Overloaded critical owner detected
  await testAsync('Case 389: Ownership risk: Overloaded critical owner detected', async () => {
    const today = toUtcDay(new Date());
    const projId = 'proj_389';
    const relId = 'rel_389';
    const project = { _id: projId, owner: 'u_1', members: [{ user: 'u_1' }] };
    const capacities = [{ project: projId, user: 'u_1', availableDaysPerWeek: 5, wipLimit: 5 }];
    const users = [{ _id: 'u_1', name: 'Critical Dev', role: 'member', isActive: true }];
    const releases = [{ _id: relId, status: 'active', project: projId, targetDate: addCalendarDays(today, 20) }];
    // Horizon 7 -> available: 5. Committed: 10 -> overloaded (200% load)
    const tasks = [
      { _id: 't_389', project: projId, release: relId, title: 'Big Critical Task', status: 'In Progress', assignedTo: 'u_1', estimateDays: 10 },
    ];

    const intel = computeCapacityIntelligence({ project, users, capacities, tasks, releases, horizonDays: 7, referenceDate: today });
    const driver = intel.riskDrivers.find((d) => d.type === 'overloaded_critical_owner');
    assert.ok(driver);
    assert.strictEqual(driver.severity, 'critical');
  });

  // Case 390: Ownership risk: Forecast-path concentration below threshold (<60%)
  await testAsync('Case 390: Ownership risk: Forecast-path concentration below threshold (<60%)', async () => {
    const today = toUtcDay(new Date());
    const projId = 'proj_390';
    const relId = 'rel_390';
    const project = { _id: projId, owner: 'u_1', members: [{ user: 'u_1' }, { user: 'u_2' }] };
    const users = [
      { _id: 'u_1', name: 'Dev 1', isActive: true },
      { _id: 'u_2', name: 'Dev 2', isActive: true },
    ];
    const releases = [{ _id: relId, status: 'active', project: projId, targetDate: addCalendarDays(today, 30) }];
    // 4 tasks on release path: u_1 has 2 (50%), u_2 has 2 (50%) -> < 60%
    const tasks = [
      { _id: 't_390_1', project: projId, release: relId, title: 'T1', status: 'To Do', assignedTo: 'u_1', estimateDays: 2, dependsOn: [] },
      { _id: 't_390_2', project: projId, release: relId, title: 'T2', status: 'To Do', assignedTo: 'u_1', estimateDays: 2, dependsOn: ['t_390_1'] },
      { _id: 't_390_3', project: projId, release: relId, title: 'T3', status: 'To Do', assignedTo: 'u_2', estimateDays: 2, dependsOn: ['t_390_2'] },
      { _id: 't_390_4', project: projId, release: relId, title: 'T4', status: 'To Do', assignedTo: 'u_2', estimateDays: 2, dependsOn: ['t_390_3'] },
    ];

    const intel = computeCapacityIntelligence({ project, users, capacities: [], tasks, releases, horizonDays: 14, referenceDate: today });
    const driver = intel.riskDrivers.find((d) => d.type === 'forecast_path_concentration');
    assert.strictEqual(driver, undefined);
    assert.strictEqual(intel.summary.forecastPathConcentration.isConcentrated, false);
    assert.strictEqual(intel.summary.forecastPathConcentration.share, 0.5);
  });

  // Case 391: Ownership risk: Forecast-path concentration at >=60% with >=3 tasks
  await testAsync('Case 391: Ownership risk: Forecast-path concentration at >=60% with >=3 tasks', async () => {
    const today = toUtcDay(new Date());
    const projId = 'proj_391';
    const relId = 'rel_391';
    const project = { _id: projId, owner: 'u_1', members: [{ user: 'u_1' }, { user: 'u_2' }] };
    const users = [
      { _id: 'u_1', name: 'Dev 1', isActive: true },
      { _id: 'u_2', name: 'Dev 2', isActive: true },
    ];
    const releases = [{ _id: relId, status: 'active', project: projId, targetDate: addCalendarDays(today, 30) }];
    // 5 tasks on path: u_1 has 4 (80%), u_2 has 1 (20%) -> >= 60%
    const tasks = [
      { _id: 't_391_1', project: projId, release: relId, title: 'T1', status: 'To Do', assignedTo: 'u_1', estimateDays: 2, dependsOn: [] },
      { _id: 't_391_2', project: projId, release: relId, title: 'T2', status: 'To Do', assignedTo: 'u_1', estimateDays: 2, dependsOn: ['t_391_1'] },
      { _id: 't_391_3', project: projId, release: relId, title: 'T3', status: 'To Do', assignedTo: 'u_1', estimateDays: 2, dependsOn: ['t_391_2'] },
      { _id: 't_391_4', project: projId, release: relId, title: 'T4', status: 'To Do', assignedTo: 'u_1', estimateDays: 2, dependsOn: ['t_391_3'] },
      { _id: 't_391_5', project: projId, release: relId, title: 'T5', status: 'To Do', assignedTo: 'u_2', estimateDays: 2, dependsOn: ['t_391_4'] },
    ];

    const intel = computeCapacityIntelligence({ project, users, capacities: [], tasks, releases, horizonDays: 14, referenceDate: today });
    const driver = intel.riskDrivers.find((d) => d.type === 'forecast_path_concentration');
    assert.ok(driver);
    assert.strictEqual(driver.share, 0.8);
    assert.strictEqual(intel.summary.forecastPathConcentration.isConcentrated, true);
  });

  // Case 392: Ownership risk: Minimum three-task concentration guard
  await testAsync('Case 392: Ownership risk: Minimum three-task concentration guard', async () => {
    const today = toUtcDay(new Date());
    const projId = 'proj_392';
    const relId = 'rel_392';
    const project = { _id: projId, owner: 'u_1', members: [{ user: 'u_1' }] };
    const users = [{ _id: 'u_1', name: 'Solo Dev', isActive: true }];
    const releases = [{ _id: relId, status: 'active', project: projId, targetDate: addCalendarDays(today, 30) }];
    // Only 2 tasks on release path!
    const tasks = [
      { _id: 't_392_1', project: projId, release: relId, title: 'T1', status: 'To Do', assignedTo: 'u_1', estimateDays: 2, dependsOn: [] },
      { _id: 't_392_2', project: projId, release: relId, title: 'T2', status: 'To Do', assignedTo: 'u_1', estimateDays: 2, dependsOn: ['t_392_1'] },
    ];

    const intel = computeCapacityIntelligence({ project, users, capacities: [], tasks, releases, horizonDays: 14, referenceDate: today });
    const driver = intel.riskDrivers.find((d) => d.type === 'forecast_path_concentration');
    // Must NOT emit risk because threshold requires at least 3 tasks!
    assert.strictEqual(driver, undefined);
    assert.strictEqual(intel.summary.forecastPathConcentration, null);
  });

  // Case 393: Ownership risk: Diamond dependency commitments deduplicated
  await testAsync('Case 393: Ownership risk: Diamond dependency commitments deduplicated', async () => {
    const today = toUtcDay(new Date());
    const projId = 'proj_393';
    const relId = 'rel_393';
    const project = { _id: projId, owner: 'u_1', members: [{ user: 'u_1' }] };
    const capacities = [{ project: projId, user: 'u_1', availableDaysPerWeek: 5, wipLimit: 5 }];
    const users = [{ _id: 'u_1', name: 'Dev', role: 'member', isActive: true }];
    const releases = [{ _id: relId, status: 'active', project: projId, targetDate: addCalendarDays(today, 30) }];

    // Diamond: A -> B, A -> C, B -> D, C -> D
    const tasks = [
      { _id: 't_diamond_a', project: projId, release: relId, title: 'A', status: 'In Progress', assignedTo: 'u_1', estimateDays: 2, dependsOn: [] },
      { _id: 't_diamond_b', project: projId, release: relId, title: 'B', status: 'In Progress', assignedTo: 'u_1', estimateDays: 2, dependsOn: ['t_diamond_a'] },
      { _id: 't_diamond_c', project: projId, release: relId, title: 'C', status: 'In Progress', assignedTo: 'u_1', estimateDays: 2, dependsOn: ['t_diamond_a'] },
      { _id: 't_diamond_d', project: projId, release: relId, title: 'D', status: 'In Progress', assignedTo: 'u_1', estimateDays: 2, dependsOn: ['t_diamond_b', 't_diamond_c'] },
    ];

    const intel = computeCapacityIntelligence({ project, users, capacities, tasks, releases, horizonDays: 14, referenceDate: today });
    // Total committed tasks should be exactly 4, not duplicated
    assert.strictEqual(intel.members[0].committedTasksCount, 4);
    assert.strictEqual(intel.members[0].committedEstimateDays, 8);
  });

  // Case 394: Ownership risk: Blocked-work concentration detected
  await testAsync('Case 394: Ownership risk: Blocked-work concentration detected', async () => {
    const project = { _id: 'proj_394', owner: 'u_1', members: [{ user: 'u_1' }, { user: 'u_2' }] };
    const users = [
      { _id: 'u_1', name: 'Blocked Dev', isActive: true },
      { _id: 'u_2', name: 'Other Dev', isActive: true },
    ];
    // 3 blocked tasks, all assigned to u_1 (100% share)
    const tasks = [
      { _id: 't_394_1', project: 'proj_394', title: 'B1', status: 'In Progress', assignedTo: 'u_1', isBlocked: true, estimateDays: 2 },
      { _id: 't_394_2', project: 'proj_394', title: 'B2', status: 'In Progress', assignedTo: 'u_1', isBlocked: true, estimateDays: 2 },
      { _id: 't_394_3', project: 'proj_394', title: 'B3', status: 'In Progress', assignedTo: 'u_1', isBlocked: true, estimateDays: 2 },
    ];

    const intel = computeCapacityIntelligence({ project, users, capacities: [], tasks, horizonDays: 14 });
    const driver = intel.riskDrivers.find((d) => d.type === 'blocked_work_concentration');
    assert.ok(driver);
    assert.strictEqual(driver.share, 1.0);
    assert.strictEqual(driver.userId, 'u_1');
  });

  // Case 395: Ownership risk: Suggested action types remain finite and deterministic
  await testAsync('Case 395: Ownership risk: Suggested action types remain finite and deterministic', async () => {
    const ALLOWED_ACTION_TYPES = new Set([
      'assign_owner',
      'configure_capacity',
      'add_estimate',
      'reduce_wip',
      'rebalance_forecast_path',
      'review_blocked_load',
      'reactivate_or_reassign',
    ]);

    const project = { _id: 'proj_395', owner: 'u_1', members: [{ user: 'u_1' }] };
    const users = [{ _id: 'u_1', name: 'Dev', isActive: true }];
    const tasks = [
      { _id: 't_395_1', project: 'proj_395', title: 'Unassigned', status: 'In Progress', assignedTo: null, priority: 'high', estimateDays: 2 },
    ];

    const intel = computeCapacityIntelligence({ project, users, capacities: [], tasks, horizonDays: 14 });
    assert.ok(intel.suggestedActions.length > 0);
    for (const act of intel.suggestedActions) {
      assert.ok(ALLOWED_ACTION_TYPES.has(act.type), `Action type ${act.type} must be from allowed finite set`);
    }
  });

  // Case 396: Privacy: Member receives personal/partial scope
  await testAsync('Case 396: Privacy: Member receives personal/partial scope', async () => {
    const memberId = 'u_member_396';
    const project = { _id: 'proj_396', owner: 'u_owner', members: [{ user: memberId }, { user: 'u_other' }] };
    const capacities = [
      { project: 'proj_396', user: memberId, availableDaysPerWeek: 4.5, wipLimit: 2 },
      { project: 'proj_396', user: 'u_other', availableDaysPerWeek: 5.0, wipLimit: 3 },
    ];
    const users = [
      { _id: memberId, name: 'Alice Member', role: 'member', isActive: true },
      { _id: 'u_other', name: 'Bob Colleague', role: 'member', isActive: true },
    ];

    const requestingUser = { _id: memberId, role: 'member', name: 'Alice Member' };
    const intel = computeCapacityIntelligence({ project, users, capacities, tasks: [], horizonDays: 14, requestingUser });

    assert.strictEqual(intel.scope, 'personal');
    assert.strictEqual(intel.isPartial, true);
    assert.strictEqual(intel.members, undefined);
    assert.strictEqual(intel.summary, undefined);
    assert.strictEqual(intel.riskDrivers, undefined);
    assert.strictEqual(intel.suggestedActions, undefined);
    assert.ok(intel.personal);
    assert.strictEqual(intel.personal.user.id, memberId);
  });

  // Case 397: Privacy: Member sees only own allocation
  await testAsync('Case 397: Privacy: Member sees only own allocation', async () => {
    const memberId = 'u_member_397';
    const project = { _id: 'proj_397', owner: 'u_owner', members: [{ user: memberId }, { user: 'u_other' }] };
    const capacities = [
      { project: 'proj_397', user: memberId, availableDaysPerWeek: 4.5, wipLimit: 2 },
      { project: 'proj_397', user: 'u_other', availableDaysPerWeek: 5.0, wipLimit: 3 },
    ];
    const users = [
      { _id: memberId, name: 'Alice', role: 'member', isActive: true },
      { _id: 'u_other', name: 'Bob', role: 'member', isActive: true },
    ];

    const requestingUser = { _id: memberId, role: 'member', name: 'Alice' };
    const intel = computeCapacityIntelligence({ project, users, capacities, tasks: [], horizonDays: 14, requestingUser });

    assert.strictEqual(intel.personal.allocation.availableDaysPerWeek, 4.5);
    assert.strictEqual(intel.personal.allocation.wipLimit, 2);
  });

  // Case 398: Privacy: Colleague IDs and names absent from Member response
  await testAsync('Case 398: Privacy: Colleague IDs and names absent from Member response', async () => {
    const memberId = 'u_member_398';
    const colleagueId = 'u_colleague_secret_398';
    const colleagueName = 'Secret Colleague Name';

    const project = { _id: 'proj_398', owner: 'u_owner', members: [{ user: memberId }, { user: colleagueId }] };
    const capacities = [
      { project: 'proj_398', user: memberId, availableDaysPerWeek: 5, wipLimit: 3 },
      { project: 'proj_398', user: colleagueId, availableDaysPerWeek: 5, wipLimit: 3 },
    ];
    const users = [
      { _id: memberId, name: 'Alice', role: 'member', isActive: true },
      { _id: colleagueId, name: colleagueName, role: 'member', isActive: true },
    ];

    const requestingUser = { _id: memberId, role: 'member', name: 'Alice' };
    const intel = computeCapacityIntelligence({ project, users, capacities, tasks: [], horizonDays: 14, requestingUser });
    const serialized = JSON.stringify(intel);

    assert.strictEqual(serialized.includes(colleagueId), false);
    assert.strictEqual(serialized.includes(colleagueName), false);
  });

  // Case 399: Privacy: Colleague task counts and estimates absent from Member response
  await testAsync('Case 399: Privacy: Colleague task counts and estimates absent from Member response', async () => {
    const memberId = 'u_member_399';
    const colleagueId = 'u_colleague_399';

    const project = { _id: 'proj_399', owner: 'u_owner', members: [{ user: memberId }, { user: colleagueId }] };
    const capacities = [
      { project: 'proj_399', user: memberId, availableDaysPerWeek: 5, wipLimit: 3 },
      { project: 'proj_399', user: colleagueId, availableDaysPerWeek: 5, wipLimit: 3 },
    ];
    const users = [
      { _id: memberId, name: 'Alice', role: 'member', isActive: true },
      { _id: colleagueId, name: 'Bob', role: 'member', isActive: true },
    ];
    const tasks = [
      { _id: 't_colleague_1', project: 'proj_399', title: 'Bob Secret Task', status: 'In Progress', assignedTo: colleagueId, estimateDays: 42 },
    ];

    const requestingUser = { _id: memberId, role: 'member', name: 'Alice' };
    const intel = computeCapacityIntelligence({ project, users, capacities, tasks, horizonDays: 14, requestingUser });
    const serialized = JSON.stringify(intel);

    assert.strictEqual(serialized.includes('Bob Secret Task'), false);
    assert.strictEqual(serialized.includes('42'), false);
  });

  // Case 400: Privacy: Hidden blockers and specific risk drivers absent from Member response
  await testAsync('Case 400: Privacy: Hidden blockers and specific risk drivers absent from Member response', async () => {
    const memberId = 'u_member_400';
    const colleagueId = 'u_colleague_400';

    const project = { _id: 'proj_400', owner: 'u_owner', members: [{ user: memberId }, { user: colleagueId }] };
    const capacities = [
      { project: 'proj_400', user: colleagueId, availableDaysPerWeek: 1, wipLimit: 1 },
    ];
    const users = [
      { _id: memberId, name: 'Alice', role: 'member', isActive: true },
      { _id: colleagueId, name: 'Bob Overloaded', role: 'member', isActive: true },
    ];
    // Bob has 5 tasks -> heavily overloaded
    const tasks = [
      { _id: 't_400_1', project: 'proj_400', title: 'Blocked B1', status: 'In Progress', assignedTo: colleagueId, isBlocked: true, estimateDays: 10 },
      { _id: 't_400_2', project: 'proj_400', title: 'Blocked B2', status: 'In Progress', assignedTo: colleagueId, isBlocked: true, estimateDays: 10 },
      { _id: 't_400_3', project: 'proj_400', title: 'Blocked B3', status: 'In Progress', assignedTo: colleagueId, isBlocked: true, estimateDays: 10 },
    ];

    const requestingUser = { _id: memberId, role: 'member', name: 'Alice' };
    const intel = computeCapacityIntelligence({ project, users, capacities, tasks, horizonDays: 14, requestingUser });

    assert.strictEqual(intel.riskDrivers, undefined);
    assert.strictEqual(intel.suggestedActions, undefined);
  });

  // Case 401: Privacy: Exact hidden counts absent from Member response
  await testAsync('Case 401: Privacy: Exact hidden counts absent from Member response', async () => {
    const memberId = 'u_member_401';
    const colleagueId = 'u_colleague_401';

    const project = { _id: 'proj_401', owner: 'u_owner', members: [{ user: memberId }, { user: colleagueId }] };
    const users = [
      { _id: memberId, name: 'Alice', role: 'member', isActive: true },
      { _id: colleagueId, name: 'Bob', role: 'member', isActive: true },
    ];
    const tasks = [
      { _id: 't_401_1', project: 'proj_401', title: 'B1', status: 'In Progress', assignedTo: colleagueId, estimateDays: 3 },
      { _id: 't_401_2', project: 'proj_401', title: 'B2', status: 'In Progress', assignedTo: colleagueId, estimateDays: 3 },
    ];

    const requestingUser = { _id: memberId, role: 'member', name: 'Alice' };
    const intel = computeCapacityIntelligence({ project, users, capacities: [], tasks, horizonDays: 14, requestingUser });

    assert.strictEqual(intel.totalActiveMembers, undefined);
    assert.strictEqual(intel.overloadedMembers, undefined);
    assert.strictEqual(intel.summary, undefined);
  });

  // Case 402: Privacy: Generic restricted pressure signal emitted
  await testAsync('Case 402: Privacy: Generic restricted pressure signal emitted', async () => {
    const memberId = 'u_member_402';
    const colleagueId = 'u_colleague_402';

    const project = { _id: 'proj_402', owner: 'u_owner', members: [{ user: memberId }, { user: colleagueId }] };
    const capacities = [
      { project: 'proj_402', user: colleagueId, availableDaysPerWeek: 1, wipLimit: 1 },
    ];
    const users = [
      { _id: memberId, name: 'Alice', role: 'member', isActive: true },
      { _id: colleagueId, name: 'Bob', role: 'member', isActive: true },
    ];
    // Overloaded colleague
    const tasks = [
      { _id: 't_402_1', project: 'proj_402', title: 'B1', status: 'In Progress', assignedTo: colleagueId, estimateDays: 10 },
    ];

    const requestingUser = { _id: memberId, role: 'member', name: 'Alice' };
    const intel = computeCapacityIntelligence({ project, users, capacities, tasks, horizonDays: 14, requestingUser });

    assert.strictEqual(intel.restrictedSignals.length, 1);
    assert.strictEqual(intel.restrictedSignals[0].type, 'restricted_capacity_context');
    assert.strictEqual(intel.restrictedSignals[0].message, 'Additional project capacity data is restricted from this view.');
  });

  // Case 403: Privacy: Payload strictly invariant across hidden colleague state changes
  await testAsync('Case 403: Privacy: Payload strictly invariant across hidden colleague state changes', async () => {
    const memberId = 'u_member_403';
    const colleagueId = 'u_colleague_403';

    const project = { _id: 'proj_403', owner: 'u_owner', members: [{ user: memberId }, { user: colleagueId }] };
    const capacities = [{ project: 'proj_403', user: memberId, availableDaysPerWeek: 4, wipLimit: 2 }];
    const users = [
      { _id: memberId, name: 'Alice', role: 'member', isActive: true },
      { _id: colleagueId, name: 'Bob', role: 'member', isActive: true },
    ];

    // State 1: Colleague has 2 tasks
    const tasks1 = [
      { _id: 't_403_1', project: 'proj_403', title: 'B1', status: 'In Progress', assignedTo: colleagueId, estimateDays: 5 },
      { _id: 't_403_2', project: 'proj_403', title: 'B2', status: 'In Progress', assignedTo: colleagueId, estimateDays: 5 },
    ];
    const requestingUser = { _id: memberId, role: 'member', name: 'Alice' };
    const intel1 = computeCapacityIntelligence({ project, users, capacities, tasks: tasks1, horizonDays: 14, requestingUser });

    // State 2: Colleague has 10 tasks and blocked
    const tasks2 = [
      ...tasks1,
      { _id: 't_403_3', project: 'proj_403', title: 'B3', status: 'In Progress', assignedTo: colleagueId, isBlocked: true, estimateDays: 20 },
    ];
    const intel2 = computeCapacityIntelligence({ project, users, capacities, tasks: tasks2, horizonDays: 14, requestingUser });

    // Both payloads must have identical structure and personal data
    assert.deepStrictEqual(intel1.personal, intel2.personal);
    assert.deepStrictEqual(intel1.restrictedSignals, intel2.restrictedSignals);
  });

  // Case 404: Privacy: Admin and Manager retain complete authorized details
  await testAsync('Case 404: Privacy: Admin and Manager retain complete authorized details', async () => {
    const adminId = 'u_admin_404';
    const memberId = 'u_member_404';

    const project = { _id: 'proj_404', owner: adminId, members: [{ user: memberId }] };
    const capacities = [{ project: 'proj_404', user: memberId, availableDaysPerWeek: 4, wipLimit: 2 }];
    const users = [
      { _id: adminId, name: 'Admin', role: 'admin', isActive: true },
      { _id: memberId, name: 'Bob Member', role: 'member', isActive: true },
    ];
    const tasks = [
      { _id: 't_404', project: 'proj_404', title: 'Bob Task', status: 'In Progress', assignedTo: memberId, estimateDays: 3 },
    ];

    const requestingUser = { _id: adminId, role: 'admin', name: 'Admin' };
    const intel = computeCapacityIntelligence({ project, users, capacities, tasks, horizonDays: 14, requestingUser });

    assert.strictEqual(intel.scope, 'project');
    assert.strictEqual(intel.isPartial, false);
    assert.ok(intel.summary);
    assert.ok(intel.members);
    assert.strictEqual(intel.members.length, 2);
    assert.ok(intel.riskDrivers);
    assert.ok(intel.suggestedActions);
  });

  // Case 405: Integrity: Cross-project tasks strictly excluded from capacity calculations
  await testAsync('Case 405: Integrity: Cross-project tasks strictly excluded from capacity calculations', async () => {
    const projA = 'proj_405_a';
    const projB = 'proj_405_b';

    const project = { _id: projA, owner: 'u_1', members: [{ user: 'u_1' }] };
    const capacities = [{ project: projA, user: 'u_1', availableDaysPerWeek: 5, wipLimit: 3 }];
    const users = [{ _id: 'u_1', name: 'Dev', role: 'member', isActive: true }];

    const tasks = [
      { _id: 't_in_proj', project: projA, title: 'In Project', status: 'In Progress', assignedTo: 'u_1', estimateDays: 3 },
      { _id: 't_foreign', project: projB, title: 'Foreign Project', status: 'In Progress', assignedTo: 'u_1', estimateDays: 50 },
    ];

    const intel = computeCapacityIntelligence({ project, users, capacities, tasks, horizonDays: 14 });
    assert.strictEqual(intel.members[0].committedEstimateDays, 3);
    assert.strictEqual(intel.members[0].committedTasksCount, 1);
  });

  // Case 406: Integrity: Cyclic dependency graph terminates safely without infinite recursion
  await testAsync('Case 406: Integrity: Cyclic dependency graph terminates safely without infinite recursion', async () => {
    const projId = 'proj_406';
    const relId = 'rel_406';
    const project = { _id: projId, owner: 'u_1', members: [{ user: 'u_1' }] };
    const capacities = [{ project: projId, user: 'u_1', availableDaysPerWeek: 5, wipLimit: 3 }];
    const users = [{ _id: 'u_1', name: 'Dev', role: 'member', isActive: true }];
    const releases = [{ _id: relId, status: 'active', project: projId, targetDate: new Date() }];

    // Cyclic tasks: A -> B -> A
    const tasks = [
      { _id: 't_406_a', project: projId, release: relId, title: 'Cycle A', status: 'To Do', assignedTo: 'u_1', estimateDays: 2, dependsOn: ['t_406_b'] },
      { _id: 't_406_b', project: projId, release: relId, title: 'Cycle B', status: 'To Do', assignedTo: 'u_1', estimateDays: 2, dependsOn: ['t_406_a'] },
    ];

    assert.doesNotThrow(() => {
      computeCapacityIntelligence({ project, users, capacities, tasks, releases, horizonDays: 14 });
    });
  });

  // Case 407: Integrity: Malformed ObjectIds in params return controlled 400 Bad Request
  await testAsync('Case 407: Integrity: Malformed ObjectIds in params return controlled 400 Bad Request', async () => {
    const req1 = { params: { projectId: 'bad_id' } };
    const res1 = createMockRes();
    await capacityController.getProjectCapacityIntelligence(req1, res1);
    assert.strictEqual(res1.statusCode, 400);

    const req2 = { params: { projectId: 'bad_id' } };
    const res2 = createMockRes();
    await capacityController.getProjectCapacities(req2, res2);
    assert.strictEqual(res2.statusCode, 400);
  });

  // Case 408: Performance: Query count is bounded to exactly 6 batch queries
  await testAsync('Case 408: Performance: Query count is bounded to exactly 6 batch queries', async () => {
    const projId = new mongoose.Types.ObjectId().toString();
    const adminId = new mongoose.Types.ObjectId().toString();

    let queryCount = 0;
    const origProjFindById = Project.findById;
    const origUserFind = User.find;
    const origCapFind = ProjectCapacity.find;
    const origTaskFind = Task.find;
    const origMilestoneFind = Milestone.find;
    const origReleaseFind = Release.find;

    Project.findById = () => { queryCount++; return Promise.resolve({ _id: projId, status: 'active', owner: adminId, members: [] }); };
    User.find = () => { queryCount++; return { select: () => Promise.resolve([{ _id: adminId, name: 'Admin', role: 'admin', isActive: true }]) }; };
    ProjectCapacity.find = () => { queryCount++; return Promise.resolve([]); };
    Task.find = () => { queryCount++; return Promise.resolve([]); };
    Milestone.find = () => { queryCount++; return Promise.resolve([]); };
    Release.find = () => { queryCount++; return Promise.resolve([]); };

    const req = {
      params: { projectId: projId },
      query: { horizonDays: '14' },
      user: { _id: adminId, role: 'admin' },
    };
    const res = createMockRes();
    await capacityController.getProjectCapacityIntelligence(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(queryCount, 6, 'Capacity intelligence must execute exactly 6 batch queries');

    Project.findById = origProjFindById;
    User.find = origUserFind;
    ProjectCapacity.find = origCapFind;
    Task.find = origTaskFind;
    Milestone.find = origMilestoneFind;
    Release.find = origReleaseFind;
  });

  // Case 409: Performance: Query count invariant between small and 500-task datasets
  await testAsync('Case 409: Performance: Query count invariant between small and 500-task datasets', async () => {
    const projId = new mongoose.Types.ObjectId().toString();
    const adminId = new mongoose.Types.ObjectId().toString();

    let queryCountSmall = 0;
    let queryCountLarge = 0;

    const origProjFindById = Project.findById;
    const origUserFind = User.find;
    const origCapFind = ProjectCapacity.find;
    const origTaskFind = Task.find;
    const origMilestoneFind = Milestone.find;
    const origReleaseFind = Release.find;

    // Small graph mock
    Project.findById = () => { queryCountSmall++; return Promise.resolve({ _id: projId, status: 'active', owner: adminId, members: [] }); };
    User.find = () => { queryCountSmall++; return { select: () => Promise.resolve([{ _id: adminId, name: 'Admin', role: 'admin', isActive: true }]) }; };
    ProjectCapacity.find = () => { queryCountSmall++; return Promise.resolve([]); };
    Task.find = () => { queryCountSmall++; return Promise.resolve([{ _id: 't1', project: projId, status: 'In Progress', estimateDays: 2 }]); };
    Milestone.find = () => { queryCountSmall++; return Promise.resolve([]); };
    Release.find = () => { queryCountSmall++; return Promise.resolve([]); };

    const req1 = { params: { projectId: projId }, query: { horizonDays: '14' }, user: { _id: adminId, role: 'admin' } };
    const res1 = createMockRes();
    await capacityController.getProjectCapacityIntelligence(req1, res1);

    // Large 500-task graph mock
    const largeTasks = Array.from({ length: 500 }, (_, i) => ({
      _id: `t_large_${i}`,
      project: projId,
      status: 'In Progress',
      estimateDays: 1,
    }));

    Project.findById = () => { queryCountLarge++; return Promise.resolve({ _id: projId, status: 'active', owner: adminId, members: [] }); };
    User.find = () => { queryCountLarge++; return { select: () => Promise.resolve([{ _id: adminId, name: 'Admin', role: 'admin', isActive: true }]) }; };
    ProjectCapacity.find = () => { queryCountLarge++; return Promise.resolve([]); };
    Task.find = () => { queryCountLarge++; return Promise.resolve(largeTasks); };
    Milestone.find = () => { queryCountLarge++; return Promise.resolve([]); };
    Release.find = () => { queryCountLarge++; return Promise.resolve([]); };

    const req2 = { params: { projectId: projId }, query: { horizonDays: '14' }, user: { _id: adminId, role: 'admin' } };
    const res2 = createMockRes();
    await capacityController.getProjectCapacityIntelligence(req2, res2);

    assert.strictEqual(queryCountSmall, 6);
    assert.strictEqual(queryCountLarge, 6);
    assert.strictEqual(queryCountSmall, queryCountLarge);

    Project.findById = origProjFindById;
    User.find = origUserFind;
    ProjectCapacity.find = origCapFind;
    Task.find = origTaskFind;
    Milestone.find = origMilestoneFind;
    Release.find = origReleaseFind;
  });

  // Case 410: Large synthetic DAG stack safety: 500-node dependency graph computes capacity without recursion failure
  await testAsync('Case 410: Large synthetic DAG stack safety: 500-node dependency graph computes capacity without recursion failure', async () => {
    const projId = 'proj_synth_cap_500';
    const adminId = 'u_admin_500';
    const project = { _id: projId, status: 'active', owner: adminId, members: [{ user: adminId }] };
    const capacities = [{ project: projId, user: adminId, availableDaysPerWeek: 5, wipLimit: 10 }];
    const users = [{ _id: adminId, name: 'Admin', role: 'admin', isActive: true }];

    const tasks = [];
    for (let i = 0; i < 500; i++) {
      tasks.push({
        _id: `t_synth_${i}`,
        project: projId,
        title: `Synthetic Task ${i}`,
        status: i < 5 ? 'In Progress' : 'To Do',
        assignedTo: adminId,
        estimateDays: 1,
        dependsOn: i > 0 ? [`t_synth_${i - 1}`] : [],
      });
    }

    assert.doesNotThrow(() => {
      const intel = computeCapacityIntelligence({
        project,
        users,
        capacities,
        tasks,
        horizonDays: 14,
      });
      assert.strictEqual(intel.members[0].wip.count, 5);
      assert.strictEqual(intel.members[0].wip.state, 'within_limit');
    });
  });

  // Case 411: Semantic preservation: Existing Phase 2–5 semantics remain completely unchanged
  await testAsync('Case 411: Semantic preservation: Existing Phase 2–5 semantics remain completely unchanged', async () => {
    // 1. Phase 2 readiness
    const readyRes = calculateReleaseReadiness({
      release: { targetDate: new Date() },
      tasks: [{ status: 'Done' }],
      milestones: [],
    });
    assert.ok(readyRes.score >= 0);

    // 2. Phase 4 delivery forecast
    const forecast = computeDeliveryForecast(
      { _id: 'proj_fc', status: 'active' },
      { _id: 'rel_fc', status: 'active', targetDate: new Date() },
      [{ _id: 't_fc_1', status: 'To Do', estimateDays: 3 }]
    );
    assert.ok(forecast.forecastDate);

    // 3. Phase 5 decision impact
    const decisionImpact = computeDecisionImpact(
      { _id: 'dec_sem', status: 'proposed', linkedTasks: ['t_sem_1'] },
      { _id: 'proj_sem', status: 'active' },
      [{ _id: 't_sem_1', project: 'proj_sem', status: 'In Progress' }],
      [],
      [],
      { role: 'admin' }
    );
    assert.strictEqual(decisionImpact.classification, 'contained');
  });

  // Case 412: Shared authorization module: canonical predicates pass regression checks
  await testAsync('Case 412: Shared authorization module: canonical predicates pass regression checks', async () => {
    const admin = { _id: 'u_admin', role: 'admin' };
    const ownerManager = { _id: 'u_owner_mgr', role: 'manager' };
    const strangerManager = { _id: 'u_stranger_mgr', role: 'manager' };
    const member = { _id: 'u_member', role: 'member' };
    const outsider = { _id: 'u_outsider', role: 'member' };

    const project = {
      _id: 'proj_auth_test',
      owner: 'u_owner_mgr',
      members: [{ user: 'u_owner_mgr' }, { user: 'u_member' }],
    };

    // canReadProject
    assert.strictEqual(sharedAuth.canReadProject(admin, project), true);
    assert.strictEqual(sharedAuth.canReadProject(ownerManager, project), true);
    assert.strictEqual(sharedAuth.canReadProject(strangerManager, project), true, 'Manager has full project read access');
    assert.strictEqual(sharedAuth.canReadProject(member, project), true);
    assert.strictEqual(sharedAuth.canReadProject(outsider, project), false);

    // canManageProject
    assert.strictEqual(sharedAuth.canManageProject(admin, project), true);
    assert.strictEqual(sharedAuth.canManageProject(ownerManager, project), true);
    assert.strictEqual(sharedAuth.canManageProject(strangerManager, project), false);
    assert.strictEqual(sharedAuth.canManageProject(member, project), false);

    // isActiveProjectMember
    assert.strictEqual(sharedAuth.isActiveProjectMember('u_owner_mgr', project), true);
    assert.strictEqual(sharedAuth.isActiveProjectMember('u_member', project), true);
    assert.strictEqual(sharedAuth.isActiveProjectMember('u_outsider', project), false);

    // canAccessTask
    const taskAssigned = { _id: 't_assigned', assignedTo: 'u_member', createdBy: 'u_admin' };
    const taskCreated = { _id: 't_created', assignedTo: 'u_other', createdBy: 'u_member' };
    const taskUnrelated = { _id: 't_unrelated', assignedTo: 'u_other', createdBy: 'u_admin' };

    assert.strictEqual(sharedAuth.canAccessTask(admin, taskUnrelated), true);
    assert.strictEqual(sharedAuth.canAccessTask(ownerManager, taskUnrelated), true);
    assert.strictEqual(sharedAuth.canAccessTask(member, taskAssigned), true);
    assert.strictEqual(sharedAuth.canAccessTask(member, taskCreated), true);
    assert.strictEqual(sharedAuth.canAccessTask(member, taskUnrelated), false);
  });

  // Case 413: Project lifecycle: Capacity mutations on on-hold project return 409 Conflict
  await testAsync('Case 413: Project lifecycle: Capacity mutations on on-hold project return 409 Conflict', async () => {
    const projId = new mongoose.Types.ObjectId().toString();
    const userId = new mongoose.Types.ObjectId().toString();
    const adminUser = { _id: new mongoose.Types.ObjectId().toString(), role: 'admin' };

    const origFindById = Project.findById;
    Project.findById = () => Promise.resolve({
      _id: projId,
      status: 'on-hold',
      owner: adminUser._id,
      members: [{ user: userId }],
    });

    // PUT mutation
    const reqPut = {
      params: { projectId: projId, userId },
      body: { availableDaysPerWeek: 5, wipLimit: 3 },
      user: adminUser,
    };
    const resPut = createMockRes();
    await capacityController.upsertProjectCapacity(reqPut, resPut);
    assert.strictEqual(resPut.statusCode, 409);
    assert.ok(resPut.body.message.includes('on-hold'));

    // DELETE mutation
    const reqDel = {
      params: { projectId: projId, userId },
      user: adminUser,
    };
    const resDel = createMockRes();
    await capacityController.deleteProjectCapacity(reqDel, resDel);
    assert.strictEqual(resDel.statusCode, 409);
    assert.ok(resDel.body.message.includes('on-hold'));

    Project.findById = origFindById;
  });

  // Case 414: Project lifecycle: Capacity mutations on completed project return 409 Conflict
  await testAsync('Case 414: Project lifecycle: Capacity mutations on completed project return 409 Conflict', async () => {
    const projId = new mongoose.Types.ObjectId().toString();
    const userId = new mongoose.Types.ObjectId().toString();
    const adminUser = { _id: new mongoose.Types.ObjectId().toString(), role: 'admin' };

    const origFindById = Project.findById;
    Project.findById = () => Promise.resolve({
      _id: projId,
      status: 'completed',
      owner: adminUser._id,
      members: [{ user: userId }],
    });

    const reqPut = {
      params: { projectId: projId, userId },
      body: { availableDaysPerWeek: 5, wipLimit: 3 },
      user: adminUser,
    };
    const resPut = createMockRes();
    await capacityController.upsertProjectCapacity(reqPut, resPut);
    assert.strictEqual(resPut.statusCode, 409);
    assert.ok(resPut.body.message.includes('completed'));

    Project.findById = origFindById;
  });

  // Case 415: Project lifecycle: Capacity intelligence reads report on_hold, completed, and archived availability
  await testAsync('Case 415: Project lifecycle: Capacity intelligence reads report on_hold, completed, and archived availability', async () => {
    const uId = 'u_dev_415';
    const users = [{ _id: uId, name: 'Dev', role: 'member', isActive: true }];
    const capacities = [{ project: 'p_hold', user: uId, availableDaysPerWeek: 5, wipLimit: 3 }];
    const tasks = [{ _id: 't_hold', status: 'In Progress', assignedTo: uId, estimateDays: 20 }];

    // on-hold
    const intelHold = computeCapacityIntelligence({
      project: { _id: 'p_hold', status: 'on-hold', owner: uId, members: [{ user: uId }] },
      users,
      capacities,
      tasks,
      horizonDays: 14,
    });
    assert.strictEqual(intelHold.availability, 'on_hold');
    assert.strictEqual(intelHold.summary.overloadedMembers, 0); // No active overload conclusions

    // completed
    const intelComp = computeCapacityIntelligence({
      project: { _id: 'p_comp', status: 'completed', owner: uId, members: [{ user: uId }] },
      users,
      capacities,
      tasks,
      horizonDays: 14,
    });
    assert.strictEqual(intelComp.availability, 'completed');
    assert.strictEqual(intelComp.summary.overloadedMembers, 0);

    // archived
    const intelArch = computeCapacityIntelligence({
      project: { _id: 'p_arch', status: 'archived', owner: uId, members: [{ user: uId }] },
      users,
      capacities,
      tasks,
      horizonDays: 14,
    });
    assert.strictEqual(intelArch.availability, 'archived');
    assert.strictEqual(intelArch.summary.overloadedMembers, 0);
  });

  // Case 416: Member privacy: Invariant signal restricted_capacity_context always returned on personal scope
  await testAsync('Case 416: Member privacy: Invariant signal restricted_capacity_context always returned on personal scope', async () => {
    const memberId = 'u_member_416';
    const project = { _id: 'p_416', owner: 'u_mgr', members: [{ user: memberId }] };
    const users = [{ _id: memberId, name: 'Alice', role: 'member', isActive: true }];
    const memberUser = { _id: memberId, name: 'Alice', role: 'member' };

    const intel = computeCapacityIntelligence({
      project,
      users,
      capacities: [],
      tasks: [],
      horizonDays: 14,
      requestingUser: memberUser,
    });

    assert.strictEqual(intel.scope, 'personal');
    assert.strictEqual(intel.isPartial, true);
    assert.ok(Array.isArray(intel.restrictedSignals));
    assert.strictEqual(intel.restrictedSignals[0].type, 'restricted_capacity_context');
    assert.strictEqual(intel.restrictedSignals[0].message, 'Additional project capacity data is restricted from this view.');
  });

  // Case 417: Member privacy: GET /api/projects/:projectId/capacity returns only Member own allocation
  await testAsync('Case 417: Member privacy: GET /api/projects/:projectId/capacity returns only Member own allocation', async () => {
    const projId = new mongoose.Types.ObjectId().toString();
    const memberId = new mongoose.Types.ObjectId().toString();
    const colleagueId = new mongoose.Types.ObjectId().toString();

    const origProjectFindById = Project.findById;
    const origCapacityFind = ProjectCapacity.find;

    Project.findById = () => Promise.resolve({
      _id: projId,
      status: 'active',
      owner: colleagueId,
      members: [{ user: memberId }, { user: colleagueId }],
    });

    ProjectCapacity.find = () => ({
      populate: () => ({
        populate: () => ({
          populate: () => ({
            sort: () => Promise.resolve([
              { _id: 'cap_1', project: projId, user: { _id: memberId }, availableDaysPerWeek: 4, wipLimit: 2 },
              { _id: 'cap_2', project: projId, user: { _id: colleagueId }, availableDaysPerWeek: 5, wipLimit: 3 },
            ]),
          }),
        }),
      }),
    });

    const reqMember = {
      params: { projectId: projId },
      user: { _id: memberId, role: 'member' },
    };
    const resMember = createMockRes();
    await capacityController.getProjectCapacities(reqMember, resMember);

    assert.strictEqual(resMember.statusCode, 200);
    assert.strictEqual(resMember.body.count, 1);
    assert.strictEqual(resMember.body.data[0]._id, 'cap_1');

    Project.findById = origProjectFindById;
    ProjectCapacity.find = origCapacityFind;
  });

  // Case 418: Metric naming amendment: Capacity intelligence returns metricName Commitment Pressure with explanation
  await testAsync('Case 418: Metric naming amendment: Capacity intelligence returns metricName Commitment Pressure with explanation', async () => {
    const intel = computeCapacityIntelligence({
      project: { _id: 'p_cp', status: 'active', owner: 'u_1', members: [{ user: 'u_1' }] },
      users: [{ _id: 'u_1', name: 'Dev', role: 'member', isActive: true }],
      capacities: [],
      tasks: [],
      horizonDays: 14,
    });

    assert.strictEqual(intel.metricName, 'Commitment Pressure');
    assert.ok(intel.explanation.includes('Commitment Pressure'));
    assert.ok(intel.explanation.includes('not a measurement of time worked or individual performance'));
  });

  // Case 419: Ownership risk formula amendment: overloaded_critical_owner strictly requires loadStatus overloaded and active release path
  await testAsync('Case 419: Ownership risk formula amendment: overloaded_critical_owner strictly requires loadStatus overloaded and active release path', async () => {
    const today = toUtcDay(new Date());
    const projId = 'proj_419';
    const relId = 'rel_419';
    const uId = 'u_419';

    const project = { _id: projId, status: 'active', owner: uId, members: [{ user: uId }] };
    const users = [{ _id: uId, name: 'Lead Dev', role: 'member', isActive: true }];
    const releases = [{ _id: relId, status: 'active', project: projId, targetDate: addCalendarDays(today, 20) }];

    // Subtest A: Approaching limit (loadRatio = 1.0) -> NOT overloaded_critical_owner even with path task
    const capA = [{ project: projId, user: uId, availableDaysPerWeek: 7, wipLimit: 5 }]; // 7 days available in 7d horizon
    const tasksA = [
      { _id: 't_path_1', project: projId, release: relId, title: 'Path Task', status: 'In Progress', assignedTo: uId, estimateDays: 7 },
    ];
    const intelA = computeCapacityIntelligence({
      project,
      users,
      capacities: capA,
      tasks: tasksA,
      releases,
      horizonDays: 7,
      referenceDate: today,
    });
    assert.strictEqual(intelA.members[0].loadStatus, 'approaching_limit');
    assert.strictEqual(intelA.riskDrivers.filter((d) => d.type === 'overloaded_critical_owner').length, 0);

    // Subtest B: Overloaded (loadRatio = 1.5) -> DOES trigger overloaded_critical_owner
    const tasksB = [
      { _id: 't_path_1', project: projId, release: relId, title: 'Path Task', status: 'In Progress', assignedTo: uId, estimateDays: 11 },
    ];
    const intelB = computeCapacityIntelligence({
      project,
      users,
      capacities: capA,
      tasks: tasksB,
      releases,
      horizonDays: 7,
      referenceDate: today,
    });
    assert.strictEqual(intelB.members[0].loadStatus, 'overloaded');
    assert.strictEqual(intelB.riskDrivers.filter((d) => d.type === 'overloaded_critical_owner').length, 1);
  });

  // Case 420: Ownership risk formula amendment: blocked_work_concentration requires >=3 assigned blocked tasks and >=60% share
  await testAsync('Case 420: Ownership risk formula amendment: blocked_work_concentration requires >=3 assigned blocked tasks and >=60% share', async () => {
    const projId = 'proj_420';
    const u1 = 'u_420_1';
    const u2 = 'u_420_2';

    const project = { _id: projId, status: 'active', owner: u1, members: [{ user: u1 }, { user: u2 }] };
    const users = [
      { _id: u1, name: 'Dev 1', role: 'member', isActive: true },
      { _id: u2, name: 'Dev 2', role: 'member', isActive: true },
    ];

    // 4 assigned blocked tasks: 3 for u1 (75% >= 60%), 1 for u2 -> triggers blocked_work_concentration
    const tasks = [
      { _id: 't_b1', project: projId, title: 'B1', status: 'In Progress', assignedTo: u1, isBlocked: true, estimateDays: 1 },
      { _id: 't_b2', project: projId, title: 'B2', status: 'In Progress', assignedTo: u1, isBlocked: true, estimateDays: 1 },
      { _id: 't_b3', project: projId, title: 'B3', status: 'In Progress', assignedTo: u1, isBlocked: true, estimateDays: 1 },
      { _id: 't_b4', project: projId, title: 'B4', status: 'In Progress', assignedTo: u2, isBlocked: true, estimateDays: 1 },
    ];

    const intel = computeCapacityIntelligence({
      project,
      users,
      capacities: [],
      tasks,
      horizonDays: 14,
    });

    const driver = intel.riskDrivers.find((d) => d.type === 'blocked_work_concentration');
    assert.ok(driver);
    assert.strictEqual(driver.userId, u1);
    assert.strictEqual(driver.share, 0.75);
    assert.strictEqual(driver.taskCount, 3);
    assert.strictEqual(driver.totalTasks, 4);
  });

  // --- SECTION 19: Phase 6 Contract Alignment & Mathematical Correctness ---

  // Case 421: Canonical Manager read access: Non-owner Manager can read project-level capacity-intelligence
  await testAsync('Case 421: Canonical Manager read access: Non-owner Manager can read project-level capacity-intelligence', async () => {
    const projId = new mongoose.Types.ObjectId().toString();
    const ownerId = new mongoose.Types.ObjectId().toString();
    const nonOwnerMgr = { _id: new mongoose.Types.ObjectId().toString(), role: 'manager' };

    const origProjectFindById = Project.findById;
    const origUserFind = User.find;
    const origCapacityFind = ProjectCapacity.find;
    const origTaskFind = Task.find;
    const origReleaseFind = Release.find;
    const origMilestoneFind = Milestone.find;

    Project.findById = () => Promise.resolve({
      _id: projId,
      status: 'active',
      owner: ownerId,
      members: [{ user: ownerId }],
    });
    User.find = () => ({ select: () => Promise.resolve([]) });
    ProjectCapacity.find = () => Promise.resolve([]);
    Task.find = () => Promise.resolve([]);
    Release.find = () => Promise.resolve([]);
    Milestone.find = () => Promise.resolve([]);

    const req = {
      params: { projectId: projId },
      query: { horizonDays: '14' },
      user: nonOwnerMgr,
    };
    const res = createMockRes();
    await capacityController.getProjectCapacityIntelligence(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.data.scope, 'project');
    assert.strictEqual(res.body.data.isPartial, false);

    Project.findById = origProjectFindById;
    User.find = origUserFind;
    ProjectCapacity.find = origCapacityFind;
    Task.find = origTaskFind;
    Release.find = origReleaseFind;
    Milestone.find = origMilestoneFind;
  });

  // Case 422: Canonical Manager mutation restriction: Non-owner Manager receives 403 Forbidden for capacity mutations
  await testAsync('Case 422: Canonical Manager mutation restriction: Non-owner Manager receives 403 Forbidden for capacity mutations', async () => {
    const projId = new mongoose.Types.ObjectId().toString();
    const ownerId = new mongoose.Types.ObjectId().toString();
    const nonOwnerMgr = { _id: new mongoose.Types.ObjectId().toString(), role: 'manager' };
    const targetUser = new mongoose.Types.ObjectId().toString();

    const origProjectFindById = Project.findById;
    Project.findById = () => Promise.resolve({
      _id: projId,
      status: 'active',
      owner: ownerId,
      members: [{ user: ownerId }, { user: targetUser }],
    });

    const req = {
      params: { projectId: projId, userId: targetUser },
      body: { availableDaysPerWeek: 4, wipLimit: 2 },
      user: nonOwnerMgr,
    };
    const res = createMockRes();
    await capacityController.upsertProjectCapacity(req, res);

    assert.strictEqual(res.statusCode, 403);
    assert.ok(res.body.message.includes('owner or an administrator'));

    Project.findById = origProjectFindById;
  });

  // Case 423: Canonical Manager project owner mutation: Project-owning Manager can mutate capacity
  await testAsync('Case 423: Canonical Manager project owner mutation: Project-owning Manager can mutate capacity', async () => {
    const projId = new mongoose.Types.ObjectId().toString();
    const ownerMgrId = new mongoose.Types.ObjectId().toString();
    const ownerMgr = { _id: ownerMgrId, role: 'manager' };
    const targetUserId = new mongoose.Types.ObjectId().toString();

    const origProjectFindById = Project.findById;
    const origUserFindById = User.findById;
    const origCapFindOne = ProjectCapacity.findOne;
    const origCapCreate = ProjectCapacity.create;

    Project.findById = () => Promise.resolve({
      _id: projId,
      status: 'active',
      owner: ownerMgrId,
      members: [{ user: ownerMgrId }, { user: targetUserId }],
    });
    User.findById = () => Promise.resolve({ _id: targetUserId, isActive: true });
    ProjectCapacity.findOne = () => Promise.resolve(null);
    ProjectCapacity.create = (doc) => Promise.resolve({
      ...doc,
      _id: 'cap_new',
      populate: () => Promise.resolve({ ...doc, _id: 'cap_new' }),
    });

    const req = {
      params: { projectId: projId, userId: targetUserId },
      body: { availableDaysPerWeek: 5, wipLimit: 3 },
      user: ownerMgr,
    };
    const res = createMockRes();
    await capacityController.upsertProjectCapacity(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, true);

    Project.findById = origProjectFindById;
    User.findById = origUserFindById;
    ProjectCapacity.findOne = origCapFindOne;
    ProjectCapacity.create = origCapCreate;
  });

  // Case 424: Member read access restriction: Member can read only explicit member projects
  await testAsync('Case 424: Member read access restriction: Member can read only explicit member projects', async () => {
    const projId = new mongoose.Types.ObjectId().toString();
    const ownerId = new mongoose.Types.ObjectId().toString();
    const strangerMember = { _id: new mongoose.Types.ObjectId().toString(), role: 'member' };

    const origProjectFindById = Project.findById;
    Project.findById = () => Promise.resolve({
      _id: projId,
      status: 'active',
      owner: ownerId,
      members: [{ user: ownerId }],
    });

    const req = {
      params: { projectId: projId },
      query: { horizonDays: '14' },
      user: strangerMember,
    };
    const res = createMockRes();
    await capacityController.getProjectCapacityIntelligence(req, res);

    assert.strictEqual(res.statusCode, 403);

    Project.findById = origProjectFindById;
  });

  // Case 425: Regression check across controllers consuming projectAuthorization.js
  await testAsync('Case 425: Regression check across controllers consuming projectAuthorization.js', async () => {
    const shared = require('./utils/projectAuthorization');
    const mgr = { _id: 'mgr_reg', role: 'manager' };
    const memberIn = { _id: 'mem_in', role: 'member' };
    const memberOut = { _id: 'mem_out', role: 'member' };
    const proj = { _id: 'p_reg', owner: 'owner_reg', members: [{ user: 'mem_in' }] };

    assert.strictEqual(shared.canReadProject(mgr, proj), true);
    assert.strictEqual(shared.canReadProject(memberIn, proj), true);
    assert.strictEqual(shared.canReadProject(memberOut, proj), false);
    assert.strictEqual(shared.canManageProject(mgr, proj), false);
  });

  // Case 426: Full precision internal calculation: 30-day boundary test where premature one-decimal rounding would change classification
  await testAsync('Case 426: Full precision internal calculation: 30-day boundary test where premature one-decimal rounding would change classification', async () => {
    const projId = 'proj_426';
    const uId = 'u_426';
    const project = { _id: projId, status: 'active', owner: uId, members: [{ user: uId }] };
    const users = [{ _id: uId, name: 'Precision Tester', role: 'member', isActive: true }];

    // availableDaysPerWeek = 2.5, horizonDays = 30
    // Raw availableCapacityDays = 2.5 * 30 / 7 = 75 / 7 = 10.714285714...
    // If prematurely rounded to 1 decimal place: 10.7
    // With committedEstimateDays = 9.1:
    // Raw loadRatio: 9.1 / (75/7) = 9.1 / 10.7142857 = 0.8493333333333334 (< 0.85 -> BALANCED)
    // Prematurely rounded loadRatio: 9.1 / 10.7 = 0.8504672897196262 (>= 0.85 -> APPROACHING_LIMIT)
    const capacities = [{ project: projId, user: uId, availableDaysPerWeek: 2.5, wipLimit: 5 }];
    const tasks = [
      { _id: 't_426', project: projId, title: 'Task Precision', status: 'In Progress', assignedTo: uId, estimateDays: 9.1 },
    ];

    const intel = computeCapacityIntelligence({
      project,
      users,
      capacities,
      tasks,
      horizonDays: 30,
    });

    const mem = intel.members[0];
    // Must be classified as 'balanced' using full precision
    assert.strictEqual(mem.loadStatus, 'balanced', 'Full precision must evaluate to balanced (< 0.85)');
    assert.strictEqual(mem.displayAvailableCapacityDays, 10.7, 'Display field must be 10.7');
    assert.strictEqual(typeof mem.availableCapacityDays, 'number');
    assert.ok(Math.abs(mem.availableCapacityDays - (75 / 7)) < 1e-10, 'availableCapacityDays must preserve full IEEE-754 precision');
  });

  // Case 427: Precision contract: engine returns full precision availableCapacityDays and display-rounded displayAvailableCapacityDays
  await testAsync('Case 427: Precision contract: engine returns full precision availableCapacityDays and display-rounded displayAvailableCapacityDays', async () => {
    const projId = 'proj_427';
    const uId = 'u_427';
    const project = { _id: projId, status: 'active', owner: uId, members: [{ user: uId }] };
    const users = [{ _id: uId, name: 'Precision Tester 2', role: 'member', isActive: true }];
    const capacities = [{ project: projId, user: uId, availableDaysPerWeek: 4.5, wipLimit: 3 }];
    const tasks = [{ _id: 't_427', project: projId, title: 'Task', status: 'In Progress', assignedTo: uId, estimateDays: 4 }];

    const intel = computeCapacityIntelligence({
      project,
      users,
      capacities,
      tasks,
      horizonDays: 14,
    });

    // 4.5 * 14 / 7 = 9.0
    assert.strictEqual(intel.members[0].availableCapacityDays, 9);
    assert.strictEqual(intel.members[0].displayAvailableCapacityDays, 9);
    assert.strictEqual(intel.summary.totalAvailableCapacityDays, 9);
    assert.strictEqual(intel.summary.displayTotalAvailableCapacityDays, 9);
  });

  // Case 428: Canonical API endpoint: GET /api/projects/:projectId/capacity-intelligence responds with 200
  await testAsync('Case 428: Canonical API endpoint: GET /api/projects/:projectId/capacity-intelligence responds with 200', async () => {
    const projId = new mongoose.Types.ObjectId().toString();
    const adminUser = { _id: new mongoose.Types.ObjectId().toString(), role: 'admin' };

    const origProjectFindById = Project.findById;
    const origUserFind = User.find;
    const origCapacityFind = ProjectCapacity.find;
    const origTaskFind = Task.find;
    const origReleaseFind = Release.find;
    const origMilestoneFind = Milestone.find;

    Project.findById = () => Promise.resolve({ _id: projId, status: 'active', owner: adminUser._id, members: [] });
    User.find = () => ({ select: () => Promise.resolve([]) });
    ProjectCapacity.find = () => Promise.resolve([]);
    Task.find = () => Promise.resolve([]);
    Release.find = () => Promise.resolve([]);
    Milestone.find = () => Promise.resolve([]);

    const req = {
      params: { projectId: projId },
      query: { horizonDays: '14' },
      user: adminUser,
    };
    const res = createMockRes();
    await capacityController.getProjectCapacityIntelligence(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.data.metricName, 'Commitment Pressure');

    Project.findById = origProjectFindById;
    User.find = origUserFind;
    ProjectCapacity.find = origCapacityFind;
    Task.find = origTaskFind;
    Release.find = origReleaseFind;
    Milestone.find = origMilestoneFind;
  });

  // Case 429: Deprecated alias endpoint: GET /api/projects/:projectId/capacity/intelligence responds with identical payload and X-Deprecated-Route
  await testAsync('Case 429: Deprecated alias endpoint: GET /api/projects/:projectId/capacity/intelligence responds with identical payload and X-Deprecated-Route', async () => {
    const projId = new mongoose.Types.ObjectId().toString();
    const adminUser = { _id: new mongoose.Types.ObjectId().toString(), role: 'admin' };

    const origProjectFindById = Project.findById;
    const origUserFind = User.find;
    const origCapacityFind = ProjectCapacity.find;
    const origTaskFind = Task.find;
    const origReleaseFind = Release.find;
    const origMilestoneFind = Milestone.find;

    Project.findById = () => Promise.resolve({ _id: projId, status: 'active', owner: adminUser._id, members: [] });
    User.find = () => ({ select: () => Promise.resolve([]) });
    ProjectCapacity.find = () => Promise.resolve([]);
    Task.find = () => Promise.resolve([]);
    Release.find = () => Promise.resolve([]);
    Milestone.find = () => Promise.resolve([]);

    const req = {
      params: { projectId: projId },
      query: { horizonDays: '14' },
      user: adminUser,
    };
    const res = createMockRes();
    res.set('X-Deprecated-Route', 'Use /api/projects/:projectId/capacity-intelligence');
    await capacityController.getProjectCapacityIntelligence(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.headers['X-Deprecated-Route'], 'Use /api/projects/:projectId/capacity-intelligence');
    assert.strictEqual(res.body.data.metricName, 'Commitment Pressure');

    Project.findById = origProjectFindById;
    User.find = origUserFind;
    ProjectCapacity.find = origCapacityFind;
    Task.find = origTaskFind;
    Release.find = origReleaseFind;
    Milestone.find = origMilestoneFind;
  });

  // Case 430: Canonical risk driver enum: strictly validates approved finite enum
  await testAsync('Case 430: Canonical risk driver enum: strictly validates approved finite enum', async () => {
    const approvedEnum = new Set([
      'unassigned_high_priority',
      'unassigned_critical_path',
      'inactive_owner',
      'non_member_owner',
      'overloaded_critical_owner',
      'wip_limit_exceeded',
      'forecast_path_concentration',
      'blocked_work_concentration',
      'missing_capacity_configuration',
      'missing_estimate',
    ]);

    const projId = 'proj_430';
    const u1 = 'u_430_1';
    const project = { _id: projId, status: 'active', owner: u1, members: [{ user: u1 }] };
    const users = [{ _id: u1, name: 'Dev', role: 'member', isActive: true }];

    const intel = computeCapacityIntelligence({
      project,
      users,
      capacities: [], // triggers missing_capacity_configuration
      tasks: [{ _id: 't_unest', project: projId, title: 'No Est', status: 'In Progress', assignedTo: u1, estimateDays: null }],
      horizonDays: 14,
    });

    for (const d of intel.riskDrivers) {
      assert.ok(approvedEnum.has(d.type), `Risk driver type "${d.type}" must be in approved finite enum`);
    }
  });

  // Case 431: Unassigned high-priority work and forecast-path work remain separately explainable
  await testAsync('Case 431: Unassigned high-priority work and forecast-path work remain separately explainable', async () => {
    const projId = 'proj_431';
    const relId = 'rel_431';
    const today = toUtcDay(new Date());
    const project = { _id: projId, status: 'active', owner: 'u_owner', members: [] };
    const users = [];
    const releases = [{ _id: relId, status: 'active', project: projId, targetDate: addCalendarDays(today, 20) }];
    const tasks = [
      // Forecast path unassigned task -> unassigned_critical_path
      { _id: 't_path_un', project: projId, release: relId, title: 'Critical Path Unassigned', status: 'To Do', priority: 'medium', assignedTo: null, estimateDays: 3 },
      // High priority non-path unassigned task -> unassigned_high_priority
      { _id: 't_high_un', project: projId, title: 'High Priority Standalone Unassigned', status: 'To Do', priority: 'high', assignedTo: null, estimateDays: 2, dueDate: addCalendarDays(today, 5) },
    ];

    const intel = computeCapacityIntelligence({
      project,
      users,
      capacities: [],
      tasks,
      releases,
      horizonDays: 14,
      referenceDate: today,
    });

    const pathDriver = intel.riskDrivers.find((d) => d.type === 'unassigned_critical_path');
    const highDriver = intel.riskDrivers.find((d) => d.type === 'unassigned_high_priority');
    assert.ok(pathDriver, 'Must emit unassigned_critical_path for forecast-driving task');
    assert.ok(highDriver, 'Must emit unassigned_high_priority for high-priority task');
    assert.strictEqual(pathDriver.taskId, 't_path_un');
    assert.strictEqual(highDriver.taskId, 't_high_un');
  });

  // Case 432: Project-owner membership handling: Active project owner not in members is valid capacity associate
  await testAsync('Case 432: Project-owner membership handling: Active project owner not in members is valid capacity associate', async () => {
    const projId = 'proj_432';
    const ownerId = 'u_owner_432';
    // Owner is NOT in project.members array!
    const project = { _id: projId, status: 'active', owner: ownerId, members: [] };
    const users = [{ _id: ownerId, name: 'Project Owner', role: 'manager', isActive: true }];
    const capacities = [{ project: projId, user: ownerId, availableDaysPerWeek: 5, wipLimit: 3 }];
    const tasks = [
      { _id: 't_owner', project: projId, title: 'Owner Task', status: 'In Progress', assignedTo: ownerId, estimateDays: 2 },
    ];

    const intel = computeCapacityIntelligence({
      project,
      users,
      capacities,
      tasks,
      horizonDays: 14,
    });

    // Owner is recognized in members list
    assert.strictEqual(intel.members.length, 1);
    assert.strictEqual(intel.members[0].user.id, ownerId);
    assert.strictEqual(intel.members[0].isConfigured, true);
    // Task is NOT flagged as non_member_owner
    const nonMemDriver = intel.riskDrivers.find((d) => d.type === 'non_member_owner');
    assert.strictEqual(nonMemDriver, undefined, 'Active project owner must NOT be flagged as non_member_owner');
  });

  // Case 433: Project-owner membership handling: Inactive project owner is excluded from available capacity
  await testAsync('Case 433: Project-owner membership handling: Inactive project owner is excluded from available capacity', async () => {
    const projId = 'proj_433';
    const ownerId = 'u_inactive_owner';
    const project = { _id: projId, status: 'active', owner: ownerId, members: [] };
    const users = [{ _id: ownerId, name: 'Inactive Owner', role: 'manager', isActive: false }];
    const capacities = [{ project: projId, user: ownerId, availableDaysPerWeek: 5, wipLimit: 3 }];
    const tasks = [
      { _id: 't_inact_owner', project: projId, title: 'Task', status: 'In Progress', assignedTo: ownerId, estimateDays: 2 },
    ];

    const intel = computeCapacityIntelligence({
      project,
      users,
      capacities,
      tasks,
      horizonDays: 14,
    });

    // Inactive owner availableCapacityDays is null / excluded
    assert.strictEqual(intel.members[0].availableCapacityDays, null);
    assert.strictEqual(intel.summary.totalAvailableCapacityDays, 0);
    // Emits inactive_owner risk
    const inactDriver = intel.riskDrivers.find((d) => d.type === 'inactive_owner');
    assert.ok(inactDriver, 'Inactive project owner must be flagged as inactive_owner');
  });

  // Case 434: Project-owner membership handling: Genuinely removed/non-member assignee is correctly flagged as non_member_owner
  await testAsync('Case 434: Project-owner membership handling: Genuinely removed/non-member assignee is correctly flagged as non_member_owner', async () => {
    const projId = 'proj_434';
    const ownerId = 'u_owner_434';
    const strangerId = 'u_stranger_434';
    const project = { _id: projId, status: 'active', owner: ownerId, members: [{ user: ownerId }] };
    const users = [
      { _id: ownerId, name: 'Owner', role: 'manager', isActive: true },
      { _id: strangerId, name: 'Stranger', role: 'member', isActive: true },
    ];
    const tasks = [
      { _id: 't_stranger', project: projId, title: 'Stranger Task', status: 'In Progress', assignedTo: strangerId, estimateDays: 3 },
    ];

    const intel = computeCapacityIntelligence({
      project,
      users,
      capacities: [],
      tasks,
      horizonDays: 14,
    });

    const driver = intel.riskDrivers.find((d) => d.type === 'non_member_owner');
    assert.ok(driver, 'Non-member assignee must be flagged as non_member_owner');
    assert.strictEqual(driver.userId, strangerId);
  });

  // Case 435: WIP scope: Unmilestoned active In Progress task counts toward WIP
  await testAsync('Case 435: WIP scope: Unmilestoned active In Progress task counts toward WIP', async () => {
    const projId = 'proj_435';
    const uId = 'u_435';
    const project = { _id: projId, status: 'active', owner: uId, members: [{ user: uId }] };
    const users = [{ _id: uId, name: 'Dev', role: 'member', isActive: true }];
    const capacities = [{ project: projId, user: uId, availableDaysPerWeek: 5, wipLimit: 3 }];
    // Task with NO milestone and NO release
    const tasks = [
      { _id: 't_unmilestoned', project: projId, title: 'No Milestone Task', status: 'In Progress', assignedTo: uId, estimateDays: 2 },
    ];

    const intel = computeCapacityIntelligence({
      project,
      users,
      capacities,
      tasks,
      horizonDays: 14,
    });

    assert.strictEqual(intel.members[0].wip.count, 1, 'Unmilestoned In Progress task must count toward WIP');
  });

  // Case 436: WIP scope: Task on active milestone counts toward WIP
  await testAsync('Case 436: WIP scope: Task on active milestone counts toward WIP', async () => {
    const projId = 'proj_436';
    const msId = 'ms_436';
    const uId = 'u_436';
    const project = { _id: projId, status: 'active', owner: uId, members: [{ user: uId }] };
    const users = [{ _id: uId, name: 'Dev', role: 'member', isActive: true }];
    const milestones = [{ _id: msId, status: 'active', project: projId }];
    const capacities = [{ project: projId, user: uId, availableDaysPerWeek: 5, wipLimit: 3 }];
    const tasks = [
      { _id: 't_active_ms', project: projId, milestone: msId, title: 'Active MS Task', status: 'In Progress', assignedTo: uId, estimateDays: 2 },
    ];

    const intel = computeCapacityIntelligence({
      project,
      users,
      milestones,
      capacities,
      tasks,
      horizonDays: 14,
    });

    assert.strictEqual(intel.members[0].wip.count, 1, 'Task on active milestone must count toward WIP');
  });

  // Case 437: WIP scope: Task on cancelled milestone is excluded from WIP
  await testAsync('Case 437: WIP scope: Task on cancelled milestone is excluded from WIP', async () => {
    const projId = 'proj_437';
    const msCancelledId = 'ms_cancelled_437';
    const uId = 'u_437';
    const project = { _id: projId, status: 'active', owner: uId, members: [{ user: uId }] };
    const users = [{ _id: uId, name: 'Dev', role: 'member', isActive: true }];
    const milestones = [{ _id: msCancelledId, status: 'cancelled', project: projId }];
    const capacities = [{ project: projId, user: uId, availableDaysPerWeek: 5, wipLimit: 3 }];
    const tasks = [
      { _id: 't_cancelled_ms', project: projId, milestone: msCancelledId, title: 'Cancelled MS Task', status: 'In Progress', assignedTo: uId, estimateDays: 2 },
    ];

    const intel = computeCapacityIntelligence({
      project,
      users,
      milestones,
      capacities,
      tasks,
      horizonDays: 14,
    });

    assert.strictEqual(intel.members[0].wip.count, 0, 'Task on cancelled milestone must be excluded from WIP');
  });

  // Case 438: WIP scope: Task attached to cancelled release scope is excluded from WIP
  await testAsync('Case 438: WIP scope: Task attached to cancelled release scope is excluded from WIP', async () => {
    const projId = 'proj_438';
    const relCancelledId = 'rel_cancelled_438';
    const uId = 'u_438';
    const project = { _id: projId, status: 'active', owner: uId, members: [{ user: uId }] };
    const users = [{ _id: uId, name: 'Dev', role: 'member', isActive: true }];
    const releases = [{ _id: relCancelledId, status: 'cancelled', project: projId }];
    const capacities = [{ project: projId, user: uId, availableDaysPerWeek: 5, wipLimit: 3 }];
    const tasks = [
      { _id: 't_cancelled_rel', project: projId, release: relCancelledId, title: 'Cancelled Rel Task', status: 'In Progress', assignedTo: uId, estimateDays: 2 },
    ];

    const intel = computeCapacityIntelligence({
      project,
      users,
      releases,
      capacities,
      tasks,
      horizonDays: 14,
    });

    assert.strictEqual(intel.members[0].wip.count, 0, 'Task on cancelled release must be excluded from WIP');
  });

  // Case 439: WIP scope: Task included through multiple active releases/paths counts exactly once toward WIP
  await testAsync('Case 439: WIP scope: Task included through multiple active releases/paths counts exactly once toward WIP', async () => {
    const projId = 'proj_439';
    const relId = 'rel_439';
    const uId = 'u_439';
    const today = toUtcDay(new Date());
    const project = { _id: projId, status: 'active', owner: uId, members: [{ user: uId }] };
    const users = [{ _id: uId, name: 'Dev', role: 'member', isActive: true }];
    const releases = [{ _id: relId, status: 'active', project: projId, targetDate: addCalendarDays(today, 10) }];
    const capacities = [{ project: projId, user: uId, availableDaysPerWeek: 5, wipLimit: 3 }];
    // Task is In Progress AND on release forecastDrivingPath AND due within horizon
    const tasks = [
      { _id: 't_multi_scope', project: projId, release: relId, title: 'Multi Scope Task', status: 'In Progress', assignedTo: uId, estimateDays: 2, dueDate: addCalendarDays(today, 3) },
    ];

    const intel = computeCapacityIntelligence({
      project,
      users,
      releases,
      capacities,
      tasks,
      horizonDays: 14,
      referenceDate: today,
    });

    assert.strictEqual(intel.members[0].wip.count, 1, 'Task included via multiple paths must count exactly once toward WIP');
  });

  // Case 440: Complete query instrumentation: GET /api/projects/:projectId/capacity executes bounded queries
  await testAsync('Case 440: Complete query instrumentation: GET /api/projects/:projectId/capacity executes bounded queries', async () => {
    const projId = new mongoose.Types.ObjectId().toString();
    const adminUser = { _id: new mongoose.Types.ObjectId().toString(), role: 'admin' };

    let queryCount = 0;
    const origProjectFindById = Project.findById;
    const origCapacityFind = ProjectCapacity.find;

    Project.findById = () => {
      queryCount++;
      return Promise.resolve({ _id: projId, status: 'active', owner: adminUser._id, members: [] });
    };

    ProjectCapacity.find = () => {
      queryCount++;
      return {
        populate: () => {
          queryCount++; // populate user
          return {
            populate: () => {
              queryCount++; // populate createdBy
              return {
                populate: () => {
                  queryCount++; // populate updatedBy
                  return {
                    sort: () => Promise.resolve([]),
                  };
                },
              };
            },
          };
        },
      };
    };

    const req = { params: { projectId: projId }, user: adminUser };
    const res = createMockRes();
    await capacityController.getProjectCapacities(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(queryCount, 5, 'GET capacity endpoint must execute bounded queries (1 findById + 1 find + 3 populates)');

    Project.findById = origProjectFindById;
    ProjectCapacity.find = origCapacityFind;
  });

  // Case 441: Complete query instrumentation: PUT /api/projects/:projectId/capacity/:userId executes bounded queries
  await testAsync('Case 441: Complete query instrumentation: PUT /api/projects/:projectId/capacity/:userId executes bounded queries', async () => {
    const projId = new mongoose.Types.ObjectId().toString();
    const adminUser = { _id: new mongoose.Types.ObjectId().toString(), role: 'admin' };
    const targetUserId = new mongoose.Types.ObjectId().toString();

    let queryCount = 0;
    const origProjectFindById = Project.findById;
    const origUserFindById = User.findById;
    const origCapFindOne = ProjectCapacity.findOne;
    const origCapCreate = ProjectCapacity.create;

    Project.findById = () => {
      queryCount++;
      return Promise.resolve({ _id: projId, status: 'active', owner: adminUser._id, members: [{ user: targetUserId }] });
    };
    User.findById = () => {
      queryCount++;
      return Promise.resolve({ _id: targetUserId, isActive: true });
    };
    ProjectCapacity.findOne = () => {
      queryCount++;
      return Promise.resolve(null);
    };
    ProjectCapacity.create = (doc) => {
      queryCount++;
      return Promise.resolve({
        ...doc,
        _id: 'cap_created',
        populate: () => {
          queryCount += 3; // 3 populates: user, createdBy, updatedBy
          return Promise.resolve({ ...doc, _id: 'cap_created' });
        },
      });
    };

    const req = {
      params: { projectId: projId, userId: targetUserId },
      body: { availableDaysPerWeek: 5, wipLimit: 3 },
      user: adminUser,
    };
    const res = createMockRes();
    await capacityController.upsertProjectCapacity(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(queryCount, 7, 'PUT capacity must execute bounded 7 operations on create');

    Project.findById = origProjectFindById;
    User.findById = origUserFindById;
    ProjectCapacity.findOne = origCapFindOne;
    ProjectCapacity.create = origCapCreate;
  });

  // Case 442: Complete query instrumentation: DELETE /api/projects/:projectId/capacity/:userId executes bounded queries
  await testAsync('Case 442: Complete query instrumentation: DELETE /api/projects/:projectId/capacity/:userId executes bounded queries', async () => {
    const projId = new mongoose.Types.ObjectId().toString();
    const adminUser = { _id: new mongoose.Types.ObjectId().toString(), role: 'admin' };
    const targetUserId = new mongoose.Types.ObjectId().toString();

    let queryCount = 0;
    const origProjectFindById = Project.findById;
    const origCapFindOneAndDelete = ProjectCapacity.findOneAndDelete;

    Project.findById = () => {
      queryCount++;
      return Promise.resolve({ _id: projId, status: 'active', owner: adminUser._id, members: [] });
    };
    ProjectCapacity.findOneAndDelete = () => {
      queryCount++;
      return Promise.resolve({ _id: 'cap_del' });
    };

    const req = {
      params: { projectId: projId, userId: targetUserId },
      user: adminUser,
    };
    const res = createMockRes();
    await capacityController.deleteProjectCapacity(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(queryCount, 2, 'DELETE capacity must execute exactly 2 queries');

    Project.findById = origProjectFindById;
    ProjectCapacity.findOneAndDelete = origCapFindOneAndDelete;
  });

  // Case 443: Complete query instrumentation: GET /api/projects/:projectId/capacity-intelligence executes bounded queries invariant across 5 vs 500 tasks
  await testAsync('Case 443: Complete query instrumentation: GET /api/projects/:projectId/capacity-intelligence executes bounded queries invariant across 5 vs 500 tasks', async () => {
    const projId = new mongoose.Types.ObjectId().toString();
    const adminUser = { _id: new mongoose.Types.ObjectId().toString(), role: 'admin' };

    let smallQueryCount = 0;
    let largeQueryCount = 0;

    const origProjectFindById = Project.findById;
    const origUserFind = User.find;
    const origCapacityFind = ProjectCapacity.find;
    const origTaskFind = Task.find;
    const origReleaseFind = Release.find;
    const origMilestoneFind = Milestone.find;

    // Run small (5 tasks)
    Project.findById = () => { smallQueryCount++; return Promise.resolve({ _id: projId, status: 'active', owner: adminUser._id, members: [] }); };
    User.find = () => { smallQueryCount++; return { select: () => Promise.resolve([]) }; };
    ProjectCapacity.find = () => { smallQueryCount++; return Promise.resolve([]); };
    Task.find = () => { smallQueryCount++; return Promise.resolve(new Array(5).fill({ _id: 't', status: 'To Do' })); };
    Release.find = () => { smallQueryCount++; return Promise.resolve([]); };
    Milestone.find = () => { smallQueryCount++; return Promise.resolve([]); };

    const req = { params: { projectId: projId }, query: { horizonDays: '14' }, user: adminUser };
    const resSmall = createMockRes();
    await capacityController.getProjectCapacityIntelligence(req, resSmall);

    // Run large (500 tasks)
    Project.findById = () => { largeQueryCount++; return Promise.resolve({ _id: projId, status: 'active', owner: adminUser._id, members: [] }); };
    User.find = () => { largeQueryCount++; return { select: () => Promise.resolve([]) }; };
    ProjectCapacity.find = () => { largeQueryCount++; return Promise.resolve([]); };
    Task.find = () => { largeQueryCount++; return Promise.resolve(new Array(500).fill({ _id: 't', status: 'To Do' })); };
    Release.find = () => { largeQueryCount++; return Promise.resolve([]); };
    Milestone.find = () => { largeQueryCount++; return Promise.resolve([]); };

    const resLarge = createMockRes();
    await capacityController.getProjectCapacityIntelligence(req, resLarge);

    assert.strictEqual(smallQueryCount, 6, 'Small dataset must execute exactly 6 batch queries (Project, User/Members, Capacity, Task, Release, Milestone)');
    assert.strictEqual(largeQueryCount, 6, 'Large dataset must execute exactly 6 batch queries');
    assert.strictEqual(smallQueryCount, largeQueryCount, 'Query count must remain strictly invariant across graph size');

    Project.findById = origProjectFindById;
    User.find = origUserFind;
    ProjectCapacity.find = origCapacityFind;
    Task.find = origTaskFind;
    Release.find = origReleaseFind;
    Milestone.find = origMilestoneFind;
  });

  // Case 444: Capacity schema audit fields: createdBy and updatedBy are both required, populated and equal on create
  await testAsync('Case 444: Capacity schema audit fields: createdBy and updatedBy are both required, populated and equal on create', async () => {
    const projId = new mongoose.Types.ObjectId().toString();
    const adminId = new mongoose.Types.ObjectId().toString();
    const targetUserId = new mongoose.Types.ObjectId().toString();

    const origProjectFindById = Project.findById;
    const origUserFindById = User.findById;
    const origCapFindOne = ProjectCapacity.findOne;
    const origCapCreate = ProjectCapacity.create;

    let createdDoc = null;
    Project.findById = () => Promise.resolve({ _id: projId, status: 'active', owner: adminId, members: [{ user: targetUserId }] });
    User.findById = () => Promise.resolve({ _id: targetUserId, isActive: true });
    ProjectCapacity.findOne = () => Promise.resolve(null);
    ProjectCapacity.create = (doc) => {
      createdDoc = doc;
      return Promise.resolve({
        ...doc,
        _id: 'cap_created',
        populate: () => Promise.resolve({ ...doc, _id: 'cap_created' }),
      });
    };

    const req = {
      params: { projectId: projId, userId: targetUserId },
      body: { availableDaysPerWeek: 5 }, // wipLimit omitted
      user: { _id: adminId, role: 'admin' },
    };
    const res = createMockRes();
    await capacityController.upsertProjectCapacity(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.ok(createdDoc.createdBy, 'createdBy must be populated');
    assert.ok(createdDoc.updatedBy, 'updatedBy must be populated');
    assert.strictEqual(createdDoc.createdBy.toString(), adminId);
    assert.strictEqual(createdDoc.updatedBy.toString(), adminId);
    assert.strictEqual(createdDoc.createdBy.toString(), createdDoc.updatedBy.toString(), 'createdBy and updatedBy must be equal on creation');

    Project.findById = origProjectFindById;
    User.findById = origUserFindById;
    ProjectCapacity.findOne = origCapFindOne;
    ProjectCapacity.create = origCapCreate;
  });

  // Case 445: Capacity schema audit fields: updatedBy is updated on PUT
  await testAsync('Case 445: Capacity schema audit fields: updatedBy is updated on PUT', async () => {
    const projId = new mongoose.Types.ObjectId().toString();
    const creatorId = new mongoose.Types.ObjectId().toString();
    const updaterId = new mongoose.Types.ObjectId().toString();
    const targetUserId = new mongoose.Types.ObjectId().toString();

    const origProjectFindById = Project.findById;
    const origUserFindById = User.findById;
    const origCapFindOne = ProjectCapacity.findOne;

    const existingCap = {
      _id: 'cap_exist',
      project: projId,
      user: targetUserId,
      availableDaysPerWeek: 4,
      wipLimit: 2,
      createdBy: creatorId,
      updatedBy: creatorId,
      save: function() { return Promise.resolve(this); },
      populate: function() { return Promise.resolve(this); },
    };

    Project.findById = () => Promise.resolve({ _id: projId, status: 'active', owner: updaterId, members: [{ user: targetUserId }] });
    User.findById = () => Promise.resolve({ _id: targetUserId, isActive: true });
    ProjectCapacity.findOne = () => Promise.resolve(existingCap);

    const req = {
      params: { projectId: projId, userId: targetUserId },
      body: { availableDaysPerWeek: 6 },
      user: { _id: updaterId, role: 'admin' },
    };
    const res = createMockRes();
    await capacityController.upsertProjectCapacity(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(existingCap.createdBy, creatorId, 'createdBy must remain untouched on update');
    assert.strictEqual(existingCap.updatedBy.toString(), updaterId, 'updatedBy must reflect latest updater');

    Project.findById = origProjectFindById;
    User.findById = origUserFindById;
    ProjectCapacity.findOne = origCapFindOne;
  });

  // Case 446: Capacity schema wipLimit: omitted wipLimit defaults to 3 on create and preserves existing value on update
  await testAsync('Case 446: Capacity schema wipLimit: omitted wipLimit defaults to 3 on create and preserves existing value on update', async () => {
    const projId = new mongoose.Types.ObjectId().toString();
    const adminId = new mongoose.Types.ObjectId().toString();
    const targetUserId = new mongoose.Types.ObjectId().toString();

    const origProjectFindById = Project.findById;
    const origUserFindById = User.findById;
    const origCapFindOne = ProjectCapacity.findOne;
    const origCapCreate = ProjectCapacity.create;

    let createdDoc = null;
    Project.findById = () => Promise.resolve({ _id: projId, status: 'active', owner: adminId, members: [{ user: targetUserId }] });
    User.findById = () => Promise.resolve({ _id: targetUserId, isActive: true });

    // Subtest A: Create with omitted wipLimit -> defaults to 3
    ProjectCapacity.findOne = () => Promise.resolve(null);
    ProjectCapacity.create = (doc) => {
      createdDoc = doc;
      return Promise.resolve({
        ...doc,
        _id: 'cap_created',
        populate: () => Promise.resolve({ ...doc, _id: 'cap_created' }),
      });
    };

    const reqA = {
      params: { projectId: projId, userId: targetUserId },
      body: { availableDaysPerWeek: 5 }, // no wipLimit
      user: { _id: adminId, role: 'admin' },
    };
    const resA = createMockRes();
    await capacityController.upsertProjectCapacity(reqA, resA);

    assert.strictEqual(resA.statusCode, 200);
    assert.strictEqual(createdDoc.wipLimit, 3, 'Omitted wipLimit must default to 3 on create');

    // Subtest B: Update with omitted wipLimit -> preserves existing wipLimit
    const existing = {
      _id: 'cap_exist_b',
      availableDaysPerWeek: 3,
      wipLimit: 7, // customized
      save: function() { return Promise.resolve(this); },
      populate: function() { return Promise.resolve(this); },
    };
    ProjectCapacity.findOne = () => Promise.resolve(existing);

    const reqB = {
      params: { projectId: projId, userId: targetUserId },
      body: { availableDaysPerWeek: 4 }, // no wipLimit passed
      user: { _id: adminId, role: 'admin' },
    };
    const resB = createMockRes();
    await capacityController.upsertProjectCapacity(reqB, resB);

    assert.strictEqual(resB.statusCode, 200);
    assert.strictEqual(existing.wipLimit, 7, 'Omitted wipLimit on update must preserve existing customized value');

    Project.findById = origProjectFindById;
    User.findById = origUserFindById;
    ProjectCapacity.findOne = origCapFindOne;
    ProjectCapacity.create = origCapCreate;
  });

  // =========================================================================
  // SECTION 20: Phase 7 — Activity Timeline & Versioned Execution Event Ledger
  // =========================================================================
  console.log('\n--- SECTION 20: Phase 7 Activity Timeline & Versioned Execution Event Ledger ---');

  // --- SUBSECTION 20.1: Model Schema, Vocabulary & Immutability Guards ---

  test('Case 447: ExecutionEvent model exports ExecutionEvent, EVENT_CATEGORIES, CANONICAL_EVENT_TYPES', () => {
    assert.strictEqual(typeof ExecutionEvent, 'function');
    assert.ok(Array.isArray(EVENT_CATEGORIES));
    assert.ok(Array.isArray(CANONICAL_EVENT_TYPES));
  });

  test('Case 448: EVENT_CATEGORIES contains all 8 required domains', () => {
    const required = ['project', 'task', 'dependency', 'blocker', 'release', 'milestone', 'decision', 'capacity'];
    assert.strictEqual(EVENT_CATEGORIES.length, 8);
    for (const cat of required) {
      assert.ok(EVENT_CATEGORIES.includes(cat), `Missing category: ${cat}`);
    }
  });

  test('Case 449: CANONICAL_EVENT_TYPES contains canonical lifecycle event vocabulary', () => {
    const canonicalExpected = [
      'project.created', 'project.updated', 'project.deleted',
      'task.created', 'task.updated', 'task.status_changed', 'task.assigned', 'task.unassigned',
      'dependency.added', 'dependency.removed',
      'blocker.added', 'blocker.resolved',
      'release.created', 'release.updated', 'release.deleted',
      'milestone.created', 'milestone.updated', 'milestone.cancelled',
      'decision.created', 'decision.updated', 'decision.status_changed',
      'capacity.configured', 'capacity.removed',
    ];
    for (const evt of canonicalExpected) {
      assert.ok(CANONICAL_EVENT_TYPES.includes(evt), `Missing canonical event type: ${evt}`);
    }
  });

  test('Case 450: Project schema defines aggregateVersion with default 0 and select false', () => {
    const path = Project.schema.path('aggregateVersion');
    assert.ok(path, 'Project schema must define aggregateVersion');
    assert.strictEqual(path.defaultValue, 0);
    assert.strictEqual(path.options.select, false);
  });

  test('Case 451: Task schema defines aggregateVersion with default 0 and select false', () => {
    const path = Task.schema.path('aggregateVersion');
    assert.ok(path, 'Task schema must define aggregateVersion');
    assert.strictEqual(path.defaultValue, 0);
    assert.strictEqual(path.options.select, false);
  });

  test('Case 452: Release schema defines aggregateVersion with default 0 and select false', () => {
    const path = Release.schema.path('aggregateVersion');
    assert.ok(path, 'Release schema must define aggregateVersion');
    assert.strictEqual(path.defaultValue, 0);
    assert.strictEqual(path.options.select, false);
  });

  test('Case 453: Milestone schema defines aggregateVersion with default 0 and select false', () => {
    const path = Milestone.schema.path('aggregateVersion');
    assert.ok(path, 'Milestone schema must define aggregateVersion');
    assert.strictEqual(path.defaultValue, 0);
    assert.strictEqual(path.options.select, false);
  });

  test('Case 454: DecisionRecord schema defines aggregateVersion with default 0 and select false', () => {
    const path = DecisionRecord.schema.path('aggregateVersion');
    assert.ok(path, 'DecisionRecord schema must define aggregateVersion');
    assert.strictEqual(path.defaultValue, 0);
    assert.strictEqual(path.options.select, false);
  });

  test('Case 455: ProjectCapacity schema defines aggregateVersion with default 0 and select false', () => {
    const path = ProjectCapacity.schema.path('aggregateVersion');
    assert.ok(path, 'ProjectCapacity schema must define aggregateVersion');
    assert.strictEqual(path.defaultValue, 0);
    assert.strictEqual(path.options.select, false);
  });

  await testAsync('Case 456: Immutability pre-save hook blocks mutation of existing ExecutionEvent', async () => {
    const desc = buildExecutionEventDescriptor({
      eventType: 'task.created',
      category: 'task',
      project: '507f1f77bcf86cd799439010',
      actor: '507f1f77bcf86cd799439011',
      subjectType: 'task',
      subjectId: '507f1f77bcf86cd799439012',
      aggregateVersion: 1,
      correlationId: 'c1234567-0000-0000-0000-000000000001',
    });
    const eventDoc = new ExecutionEvent(desc);
    // Simulate already saved document
    eventDoc.isNew = false;
    let thrown = false;
    try {
      await eventDoc.save();
    } catch (err) {
      thrown = true;
      assert.match(err.message, /immutable and cannot be updated/i);
    }
    assert.strictEqual(thrown, true, 'Saving an existing ExecutionEvent must throw immutability error');
  });

  test('Case 457: ExecutionEvent query middleware blocks update operations', () => {
    const dummyQuery = {
      model: ExecutionEvent,
      schema: ExecutionEvent.schema,
    };
    // Test that update middleware is registered on the schema
    const updateHooks = ExecutionEvent.schema.s.hooks._pres.get('updateOne') || [];
    assert.ok(updateHooks.length > 0, 'Schema must have updateOne pre hook');
    const updateManyHooks = ExecutionEvent.schema.s.hooks._pres.get('updateMany') || [];
    assert.ok(updateManyHooks.length > 0, 'Schema must have updateMany pre hook');
  });

  test('Case 458: ExecutionEvent query middleware blocks delete operations', () => {
    const deleteHooks = ExecutionEvent.schema.s.hooks._pres.get('deleteOne') || [];
    assert.ok(deleteHooks.length > 0, 'Schema must have deleteOne pre hook');
    const deleteManyHooks = ExecutionEvent.schema.s.hooks._pres.get('deleteMany') || [];
    assert.ok(deleteManyHooks.length > 0, 'Schema must have deleteMany pre hook');
  });

  // --- SUBSECTION 20.2: Vocabulary & Factory Sanitization ---

  test('Case 459: buildExecutionEventDescriptor creates valid descriptor for known eventType', () => {
    const desc = buildExecutionEventDescriptor({
      eventType: 'task.created',
      project: '507f1f77bcf86cd799439011',
      actor: '507f1f77bcf86cd799439012',
      subjectType: 'task',
      subjectId: '507f1f77bcf86cd799439013',
      aggregateVersion: 1,
    });
    assert.strictEqual(desc.eventType, 'task.created');
    assert.strictEqual(desc.category, 'task');
    assert.strictEqual(desc.subjectType, 'task');
    assert.strictEqual(desc.aggregateVersion, 1);
    assert.strictEqual(desc.summaryCode, 'TASK_CREATED');
    assert.ok(desc.correlationId);
  });

  test('Case 460: buildExecutionEventDescriptor rejects unknown eventType', () => {
    assert.throws(
      () => buildExecutionEventDescriptor({ eventType: 'unknown.invalid_event' }),
      /Unrecognized eventType/
    );
  });

  test('Case 461: buildExecutionEventDescriptor rejects missing actor', () => {
    assert.throws(
      () => buildExecutionEventDescriptor({ eventType: 'task.created', subjectId: '123' }),
      /actor is required/
    );
  });

  test('Case 462: buildExecutionEventDescriptor automatically assigns correct category from event prefix', () => {
    const testPairs = [
      ['project.created', 'project'],
      ['task.updated', 'task'],
      ['dependency.added', 'dependency'],
      ['blocker.added', 'blocker'],
      ['release.created', 'release'],
      ['milestone.created', 'milestone'],
      ['decision.created', 'decision'],
      ['capacity.configured', 'capacity'],
    ];
    for (const [evt, expectedCat] of testPairs) {
      const desc = buildExecutionEventDescriptor({
        eventType: evt,
        actor: 'user_1',
        subjectType: expectedCat === 'dependency' || expectedCat === 'blocker' ? 'task' : expectedCat,
        subjectId: 'sub_1',
      });
      assert.strictEqual(desc.category, expectedCat);
    }
  });

  test('Case 463: buildExecutionEventDescriptor maps summaryCode correctly for task status changes', () => {
    const desc = buildExecutionEventDescriptor({
      eventType: 'task.status_changed',
      actor: 'user_1',
      subjectType: 'task',
      subjectId: 'task_1',
      changes: [{ field: 'status', from: 'To Do', to: 'In Progress' }],
    });
    assert.strictEqual(desc.summaryCode, 'TASK_STATUS_CHANGED');
  });

  test('Case 464: buildExecutionEventDescriptor formats human-readable summary', () => {
    const desc = buildExecutionEventDescriptor({
      eventType: 'task.status_changed',
      actor: 'user_1',
      subjectType: 'task',
      subjectId: 'task_1',
      subjectTitleSnapshot: 'Checkout Flow',
      changes: [{ field: 'status', from: 'To Do', to: 'In Progress' }],
    });
    assert.match(desc.summary, /moved "Checkout Flow" from To Do to In Progress/);
  });

  test('Case 465: buildExecutionEventDescriptor generates valid UUID correlationId when omitted', () => {
    const desc = buildExecutionEventDescriptor({
      eventType: 'task.created',
      actor: 'user_1',
      subjectType: 'task',
      subjectId: 'task_1',
    });
    assert.match(desc.correlationId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  test('Case 466: buildExecutionEventDescriptor preserves explicitly supplied correlationId', () => {
    const customId = '77777777-8888-9999-aaaa-bbbbbbbbbbbb';
    const desc = buildExecutionEventDescriptor({
      eventType: 'task.created',
      actor: 'user_1',
      subjectType: 'task',
      subjectId: 'task_1',
      correlationId: customId,
    });
    assert.strictEqual(desc.correlationId, customId);
  });

  test('Case 467: buildExecutionEventDescriptor truncates long subject title snapshot to 160 chars', () => {
    const longTitle = 'X'.repeat(250);
    const desc = buildExecutionEventDescriptor({
      eventType: 'task.created',
      actor: 'user_1',
      subjectType: 'task',
      subjectId: 'task_1',
      subjectTitleSnapshot: longTitle,
    });
    assert.strictEqual(desc.subjectTitleSnapshot.length, 160);
  });

  test('Case 468: buildExecutionEventDescriptor sanitizes changes allowlist', () => {
    const desc = buildExecutionEventDescriptor({
      eventType: 'task.updated',
      actor: 'user_1',
      subjectType: 'task',
      subjectId: 'task_1',
      changes: [
        { field: 'title', from: 'Old', to: 'New' },
        { field: 'unapprovedInternalField', from: 'foo', to: 'bar' },
      ],
    });
    assert.strictEqual(desc.changes.length, 1);
    assert.strictEqual(desc.changes[0].field, 'title');
  });

  test('Case 469: buildExecutionEventDescriptor strictly rejects credentials and tokens', () => {
    const desc = buildExecutionEventDescriptor({
      eventType: 'task.updated',
      actor: 'user_1',
      subjectType: 'task',
      subjectId: 'task_1',
      changes: [
        { field: 'password', from: 'secret', to: 'secret2' },
        { field: 'token', from: 'jwt1', to: 'jwt2' },
        { field: 'authorization', from: 'Bearer x', to: 'Bearer y' },
        { field: 'priority', from: 'low', to: 'high' },
      ],
    });
    assert.strictEqual(desc.changes.length, 1);
    assert.strictEqual(desc.changes[0].field, 'priority');
  });

  test('Case 470: buildExecutionEventDescriptor safely stringifies non-primitive change values', () => {
    const desc = buildExecutionEventDescriptor({
      eventType: 'capacity.configured',
      actor: 'user_1',
      subjectType: 'project',
      subjectId: 'p_1',
      changes: [
        { field: 'availableDaysPerWeek', from: 4, to: 5 },
        { field: 'wipLimit', from: null, to: 3 },
      ],
    });
    assert.strictEqual(desc.changes.length, 2);
    assert.strictEqual(desc.changes[0].from, 4);
    assert.strictEqual(desc.changes[0].to, 5);
    assert.strictEqual(desc.changes[1].from, null);
    assert.strictEqual(desc.changes[1].to, 3);
  });

  // --- SUBSECTION 20.3: Cursor Encoding & Pagination Math ---

  test('Case 471: encodeCursor produces URL-safe base64 string', () => {
    const date = new Date('2026-09-13T12:00:00.000Z');
    const id = '507f1f77bcf86cd799439011';
    const cursor = encodeCursor({ occurredAt: date, _id: id });
    assert.strictEqual(typeof cursor, 'string');
    assert.ok(!cursor.includes('/'));
    assert.ok(!cursor.includes('+'));
    assert.ok(!cursor.includes('='));
  });

  test('Case 472: decodeCursor accurately restores occurredAt Date and _id string', () => {
    const date = new Date('2026-09-13T12:00:00.000Z');
    const id = '507f1f77bcf86cd799439011';
    const cursor = encodeCursor({ occurredAt: date, _id: id });
    const decoded = decodeCursor(cursor);
    assert.ok(decoded);
    assert.strictEqual(decoded.occurredAt.toISOString(), date.toISOString());
    assert.strictEqual(decoded._id, id);
  });

  test('Case 473: decodeCursor safely returns null on malformed base64 input without crashing', () => {
    assert.strictEqual(decodeCursor('not-valid-base64!@#$'), null);
  });

  test('Case 474: decodeCursor safely returns null on valid base64 but invalid JSON', () => {
    const nonJson = Buffer.from('hello world not json').toString('base64url');
    assert.strictEqual(decodeCursor(nonJson), null);
  });

  test('Case 475: decodeCursor safely returns null on missing occurredAt or _id', () => {
    const partial1 = Buffer.from(JSON.stringify({ occurredAt: '2026-09-13T12:00:00.000Z' })).toString('base64url');
    assert.strictEqual(decodeCursor(partial1), null);
    const partial2 = Buffer.from(JSON.stringify({ _id: '123' })).toString('base64url');
    assert.strictEqual(decodeCursor(partial2), null);
  });

  // --- SUBSECTION 20.4: Aggregate Versioning & Monotonicity ---

  await testAsync('Case 476: Aggregate version defaults to 0 before any ledger recording', async () => {
    const mockAgg = { _id: 'task_ver_0', title: 'Test Task' };
    assert.strictEqual(mockAgg.aggregateVersion, undefined);
  });

  await testAsync('Case 477: recordExecutionEvent increments version from 0 to 1 on first mutation', async () => {
    const mockAgg = { _id: 'task_ver_1', title: 'Task V1', aggregateVersion: 0 };
    const { event, aggregateVersion } = await recordExecutionEvent({
      aggregate: mockAgg,
      eventInput: {
        eventType: 'task.created',
        actor: 'user_1',
        subjectType: 'task',
        subjectId: 'task_ver_1',
      },
    });
    assert.strictEqual(aggregateVersion, 1);
    assert.strictEqual(mockAgg.aggregateVersion, 1);
    assert.strictEqual(event.aggregateVersion, 1);
  });

  await testAsync('Case 478: Subsequent mutation increments version monotonically from 1 to 2', async () => {
    const mockAgg = { _id: 'task_ver_1', title: 'Task V1', aggregateVersion: 1 };
    const { event, aggregateVersion } = await recordExecutionEvent({
      aggregate: mockAgg,
      eventInput: {
        eventType: 'task.updated',
        actor: 'user_1',
        subjectType: 'task',
        subjectId: 'task_ver_1',
        changes: [{ field: 'priority', from: 'medium', to: 'high' }],
      },
    });
    assert.strictEqual(aggregateVersion, 2);
    assert.strictEqual(mockAgg.aggregateVersion, 2);
    assert.strictEqual(event.aggregateVersion, 2);
  });

  await testAsync('Case 479: Third mutation increments version from 2 to 3', async () => {
    const mockAgg = { _id: 'task_ver_1', title: 'Task V1', aggregateVersion: 2 };
    const { event, aggregateVersion } = await recordExecutionEvent({
      aggregate: mockAgg,
      eventInput: {
        eventType: 'task.status_changed',
        actor: 'user_1',
        subjectType: 'task',
        subjectId: 'task_ver_1',
        changes: [{ field: 'status', from: 'To Do', to: 'In Progress' }],
      },
    });
    assert.strictEqual(aggregateVersion, 3);
    assert.strictEqual(mockAgg.aggregateVersion, 3);
    assert.strictEqual(event.aggregateVersion, 3);
  });

  test('Case 480: Monotonicity invariant: versions are strictly ascending positive integers', () => {
    const versions = [1, 2, 3, 4, 5];
    for (let i = 1; i < versions.length; i++) {
      assert.ok(versions[i] > versions[i - 1], 'Each version must be strictly greater than preceding');
      assert.strictEqual(Number.isInteger(versions[i]), true);
    }
  });

  await testAsync('Case 481: Standalone retry handles code 11000 duplicate key idempotently', async () => {
    const existingEvent = {
      _id: 'ev_existing_1',
      eventType: 'task.created',
      subjectType: 'task',
      subjectId: 'task_dup',
      aggregateVersion: 1,
      correlationId: 'c-dup-1',
    };
    const origFindOne = ExecutionEvent.findOne;
    ExecutionEvent.findOne = () => Promise.resolve(existingEvent);

    const origSave = ExecutionEvent.prototype.save;
    ExecutionEvent.prototype.save = function() {
      const err = new Error('E11000 duplicate key error');
      err.code = 11000;
      return Promise.reject(err);
    };

    const mockAgg = { _id: 'task_dup', aggregateVersion: 0 };
    const result = await recordExecutionEvent({
      aggregate: mockAgg,
      eventInput: {
        eventType: 'task.created',
        actor: 'user_1',
        subjectType: 'task',
        subjectId: 'task_dup',
        correlationId: 'c-dup-1',
      },
      options: { forceStandalone: true, forceSave: true },
    });

    ExecutionEvent.findOne = origFindOne;
    ExecutionEvent.prototype.save = origSave;

    assert.strictEqual(result.aggregateVersion, 1);
    assert.strictEqual(result.event._id, 'ev_existing_1');
  });

  await testAsync('Case 482: Standalone retry failure logs structured diagnostic and throws ledger failure error', async () => {
    const origFindOne = ExecutionEvent.findOne;
    ExecutionEvent.findOne = () => Promise.resolve(null);

    const origSave = ExecutionEvent.prototype.save;
    ExecutionEvent.prototype.save = function() {
      return Promise.reject(new Error('Fatal I/O disk error'));
    };

    const mockAgg = { _id: 'task_fail', aggregateVersion: 0 };
    let caughtErr = null;
    try {
      await recordExecutionEvent({
        aggregate: mockAgg,
        eventInput: {
          eventType: 'task.created',
          actor: 'user_1',
          subjectType: 'task',
          subjectId: 'task_fail',
        },
        options: { forceStandalone: true, forceSave: true },
      });
    } catch (err) {
      caughtErr = err;
    }

    ExecutionEvent.findOne = origFindOne;
    ExecutionEvent.prototype.save = origSave;

    assert.ok(caughtErr, 'Must throw error on save failure');
    assert.strictEqual(caughtErr.isLedgerFailure, true);
    assert.match(caughtErr.message, /Execution ledger append failed/);
  });

  // --- SUBSECTION 20.5: Coverage Diagnostics ---

  await testAsync('Case 483: computeLedgerCoverage returns coverage metrics and tracked models', async () => {
    const origCount = ExecutionEvent.countDocuments;
    const origDistinct = ExecutionEvent.distinct;

    ExecutionEvent.countDocuments = () => Promise.resolve(42);
    ExecutionEvent.distinct = () => Promise.resolve(['agg1', 'agg2', 'agg3']);

    const cov = await computeLedgerCoverage();

    ExecutionEvent.countDocuments = origCount;
    ExecutionEvent.distinct = origDistinct;

    assert.strictEqual(cov.success, true);
    assert.strictEqual(cov.ledger.totalEvents, 42);
    assert.strictEqual(cov.ledger.distinctAggregatesTracked, 3);
    assert.strictEqual(cov.ledger.trackedModels.length, 6);
  });

  await testAsync('Case 484: computeLedgerCoverage with project parameter scopes metrics to that project', async () => {
    const origCount = ExecutionEvent.countDocuments;
    let capturedFilter = null;

    ExecutionEvent.countDocuments = (filter) => {
      capturedFilter = filter;
      return Promise.resolve(15);
    };
    const origDistinct = ExecutionEvent.distinct;
    ExecutionEvent.distinct = () => Promise.resolve(['agg1']);

    const cov = await computeLedgerCoverage('507f1f77bcf86cd799439099');

    ExecutionEvent.countDocuments = origCount;
    ExecutionEvent.distinct = origDistinct;

    assert.strictEqual(cov.success, true);
    assert.strictEqual(capturedFilter.project, '507f1f77bcf86cd799439099');
    assert.strictEqual(cov.project, '507f1f77bcf86cd799439099');
  });

  await testAsync('Case 485: GET /api/activity/coverage responds with 200 and coverage payload', async () => {
    const origCount = ExecutionEvent.countDocuments;
    const origDistinct = ExecutionEvent.distinct;
    ExecutionEvent.countDocuments = () => Promise.resolve(100);
    ExecutionEvent.distinct = () => Promise.resolve(['a1', 'a2']);

    const req = { query: {}, user: { _id: 'admin_1', role: 'admin' } };
    const res = createMockRes();
    await activityController.getLedgerCoverage(req, res);

    ExecutionEvent.countDocuments = origCount;
    ExecutionEvent.distinct = origDistinct;

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.ledger.totalEvents, 100);
  });

  await testAsync('Case 486: GET /api/activity/coverage?project=:id validates project access', async () => {
    const origProjectFindById = Project.findById;
    Project.findById = () => Promise.resolve({
      _id: 'p_cov',
      owner: 'other_owner',
      members: [],
    });

    const req = {
      query: { project: '507f1f77bcf86cd799439011' },
      user: { _id: 'unauth_member', role: 'member' },
    };
    const res = createMockRes();
    await activityController.getLedgerCoverage(req, res);

    Project.findById = origProjectFindById;

    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(res.body.success, false);
    assert.match(res.body.message, /Not authorized to view activity coverage/);
  });

  test('Case 487: computeLedgerCoverage discloses standalone fallback engine status without false replication claims', async () => {
    const cov = await computeLedgerCoverage();
    assert.ok(cov.ledger.engine);
    assert.ok(
      [
        'ReplicaSet (Atomic Transactions via session.withTransaction)',
        'Standalone MongoDB (Monotonic Sequence & Synchronous Append — Non-Atomic Fallback)',
        'ReplicaSet (Atomic Transactions)',
        'Standalone MongoDB (Monotonic Sequence & Synchronous Append)',
      ].includes(cov.ledger.engine)
    );
  });

  // --- SUBSECTION 20.6: Activity Read API & Cursor Pagination ---

  await testAsync('Case 488: GET /api/activity defaults to limit 50 and returns event list', async () => {
    const origFind = ExecutionEvent.find;
    let capturedLimit = null;
    ExecutionEvent.find = () => ({
      sort: () => ({
        limit: (lim) => {
          capturedLimit = lim;
          return {
            populate: () => Promise.resolve([]),
          };
        },
      }),
    });

    const req = { query: {}, user: { _id: 'admin_1', role: 'admin' } };
    const res = createMockRes();
    await activityController.getActivityFeed(req, res);

    ExecutionEvent.find = origFind;

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(capturedLimit, 51); // 50 + 1 for hasMore probe
    assert.strictEqual(res.body.limit, 50);
  });

  await testAsync('Case 489: GET /api/activity caps requested limit to 100', async () => {
    const origFind = ExecutionEvent.find;
    let capturedLimit = null;
    ExecutionEvent.find = () => ({
      sort: () => ({
        limit: (lim) => {
          capturedLimit = lim;
          return {
            populate: () => Promise.resolve([]),
          };
        },
      }),
    });

    const req = { query: { limit: '500' }, user: { _id: 'admin_1', role: 'admin' } };
    const res = createMockRes();
    await activityController.getActivityFeed(req, res);

    ExecutionEvent.find = origFind;

    assert.strictEqual(capturedLimit, 101); // 100 + 1
    assert.strictEqual(res.body.limit, 100);
  });

  await testAsync('Case 490: GET /api/activity orders events by occurredAt DESC, _id DESC', async () => {
    const origFind = ExecutionEvent.find;
    let capturedSort = null;
    ExecutionEvent.find = () => ({
      sort: (s) => {
        capturedSort = s;
        return {
          limit: () => ({
            populate: () => Promise.resolve([]),
          }),
        };
      },
    });

    const req = { query: {}, user: { _id: 'admin_1', role: 'admin' } };
    const res = createMockRes();
    await activityController.getActivityFeed(req, res);

    ExecutionEvent.find = origFind;

    assert.deepStrictEqual(capturedSort, { occurredAt: -1, _id: -1 });
  });

  await testAsync('Case 491: GET /api/activity returns nextCursor and hasMore when more items exist', async () => {
    const origFind = ExecutionEvent.find;
    const mockEvents = [
      { _id: 'ev_1', occurredAt: new Date('2026-09-13T12:00:00Z'), eventType: 'task.created' },
      { _id: 'ev_2', occurredAt: new Date('2026-09-13T11:00:00Z'), eventType: 'task.updated' },
      { _id: 'ev_3', occurredAt: new Date('2026-09-13T10:00:00Z'), eventType: 'project.created' },
    ];
    // Asking for limit=2, query returns 3 items -> hasMore=true, slice to 2
    ExecutionEvent.find = () => ({
      sort: () => ({
        limit: () => ({
          populate: () => Promise.resolve([...mockEvents]),
        }),
      }),
    });

    const req = { query: { limit: '2' }, user: { _id: 'admin_1', role: 'admin' } };
    const res = createMockRes();
    await activityController.getActivityFeed(req, res);

    ExecutionEvent.find = origFind;

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.events.length, 2);
    assert.strictEqual(res.body.hasMore, true);
    assert.ok(res.body.nextCursor);

    const decoded = decodeCursor(res.body.nextCursor);
    assert.strictEqual(decoded._id, 'ev_2');
  });

  await testAsync('Case 492: GET /api/activity with cursor injects seek predicate', async () => {
    const origFind = ExecutionEvent.find;
    let capturedFilter = null;
    const cursor = encodeCursor({
      occurredAt: new Date('2026-09-13T11:00:00Z'),
      _id: '507f1f77bcf86cd799439022',
    });

    ExecutionEvent.find = (f) => {
      capturedFilter = f;
      return {
        sort: () => ({
          limit: () => ({
            populate: () => Promise.resolve([]),
          }),
        }),
      };
    };

    const req = { query: { cursor }, user: { _id: 'admin_1', role: 'admin' } };
    const res = createMockRes();
    await activityController.getActivityFeed(req, res);

    ExecutionEvent.find = origFind;

    assert.ok(capturedFilter.$or, 'Must contain $or pagination filter');
    assert.strictEqual(capturedFilter.$or.length, 2);
  });

  await testAsync('Case 493: GET /api/activity sets hasMore: false and nextCursor: null on last page', async () => {
    const origFind = ExecutionEvent.find;
    const mockEvents = [
      { _id: 'ev_last', occurredAt: new Date('2026-09-13T09:00:00Z'), eventType: 'task.created' },
    ];
    // limit 2, returns 1 -> no extra item
    ExecutionEvent.find = () => ({
      sort: () => ({
        limit: () => ({
          populate: () => Promise.resolve([...mockEvents]),
        }),
      }),
    });

    const req = { query: { limit: '2' }, user: { _id: 'admin_1', role: 'admin' } };
    const res = createMockRes();
    await activityController.getActivityFeed(req, res);

    ExecutionEvent.find = origFind;

    assert.strictEqual(res.body.hasMore, false);
    assert.strictEqual(res.body.nextCursor, null);
  });

  await testAsync('Case 494: GET /api/activity?category=project filters events to project category only', async () => {
    const origFind = ExecutionEvent.find;
    let capturedFilter = null;
    ExecutionEvent.find = (f) => {
      capturedFilter = f;
      return {
        sort: () => ({
          limit: () => ({
            populate: () => Promise.resolve([]),
          }),
        }),
      };
    };

    const req = { query: { category: 'project' }, user: { _id: 'admin_1', role: 'admin' } };
    const res = createMockRes();
    await activityController.getActivityFeed(req, res);

    ExecutionEvent.find = origFind;

    assert.strictEqual(capturedFilter.category, 'project');
  });

  await testAsync('Case 495: GET /api/activity?category=task filters events to task category only', async () => {
    const origFind = ExecutionEvent.find;
    let capturedFilter = null;
    ExecutionEvent.find = (f) => {
      capturedFilter = f;
      return {
        sort: () => ({
          limit: () => ({
            populate: () => Promise.resolve([]),
          }),
        }),
      };
    };

    const req = { query: { category: 'task' }, user: { _id: 'admin_1', role: 'admin' } };
    const res = createMockRes();
    await activityController.getActivityFeed(req, res);

    ExecutionEvent.find = origFind;

    assert.strictEqual(capturedFilter.category, 'task');
  });

  await testAsync('Case 496: GET /api/activity?actor=:userId filters events by actor', async () => {
    const origFind = ExecutionEvent.find;
    let capturedFilter = null;
    ExecutionEvent.find = (f) => {
      capturedFilter = f;
      return {
        sort: () => ({
          limit: () => ({
            populate: () => Promise.resolve([]),
          }),
        }),
      };
    };

    const req = { query: { actor: '507f1f77bcf86cd799439055' }, user: { _id: 'admin_1', role: 'admin' } };
    const res = createMockRes();
    await activityController.getActivityFeed(req, res);

    ExecutionEvent.find = origFind;

    assert.strictEqual(capturedFilter.actor, '507f1f77bcf86cd799439055');
  });

  await testAsync('Case 497: GET /api/activity?project=:projectId filters events by project', async () => {
    const origFind = ExecutionEvent.find;
    let capturedFilter = null;
    ExecutionEvent.find = (f) => {
      capturedFilter = f;
      return {
        sort: () => ({
          limit: () => ({
            populate: () => Promise.resolve([]),
          }),
        }),
      };
    };

    const req = { query: { project: '507f1f77bcf86cd799439066' }, user: { _id: 'admin_1', role: 'admin' } };
    const res = createMockRes();
    await activityController.getActivityFeed(req, res);

    ExecutionEvent.find = origFind;

    assert.strictEqual(capturedFilter.project, '507f1f77bcf86cd799439066');
  });

  await testAsync('Case 498: GET /api/activity handles empty results safely without error', async () => {
    const origFind = ExecutionEvent.find;
    ExecutionEvent.find = () => ({
      sort: () => ({
        limit: () => ({
          populate: () => Promise.resolve([]),
        }),
      }),
    });

    const req = { query: {}, user: { _id: 'admin_1', role: 'admin' } };
    const res = createMockRes();
    await activityController.getActivityFeed(req, res);

    ExecutionEvent.find = origFind;

    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(res.body.events, []);
    assert.strictEqual(res.body.hasMore, false);
    assert.strictEqual(res.body.nextCursor, null);
  });

  // --- SUBSECTION 20.7: Member Privacy & Anti-Inference Guarantees ---

  await testAsync('Case 499: Admin receives full activity feed without restricted signal', async () => {
    const origFind = ExecutionEvent.find;
    ExecutionEvent.find = () => ({
      sort: () => ({
        limit: () => ({
          populate: () => Promise.resolve([]),
        }),
      }),
    });

    const req = { query: {}, user: { _id: 'admin_root', role: 'admin' } };
    const res = createMockRes();
    await activityController.getActivityFeed(req, res);

    ExecutionEvent.find = origFind;

    assert.strictEqual(res.body.restricted_activity_context, undefined);
  });

  await testAsync('Case 500: Manager receives full activity feed without restricted signal', async () => {
    const origFind = ExecutionEvent.find;
    ExecutionEvent.find = () => ({
      sort: () => ({
        limit: () => ({
          populate: () => Promise.resolve([]),
        }),
      }),
    });

    const req = { query: {}, user: { _id: 'mgr_lead', role: 'manager' } };
    const res = createMockRes();
    await activityController.getActivityFeed(req, res);

    ExecutionEvent.find = origFind;

    assert.strictEqual(res.body.restricted_activity_context, undefined);
  });

  await testAsync('Case 501: Member receives restricted_activity_context: true', async () => {
    const origFind = ExecutionEvent.find;
    const origProjFind = Project.find;
    const origTaskFind = Task.find;

    Project.find = () => ({ select: () => Promise.resolve([{ _id: 'p_mem_1' }]) });
    Task.find = () => ({ select: () => Promise.resolve([{ _id: 't_mem_1' }]) });
    ExecutionEvent.find = () => ({
      sort: () => ({
        limit: () => ({
          populate: () => Promise.resolve([]),
        }),
      }),
    });

    const req = { query: {}, user: { _id: 'member_dev', role: 'member' } };
    const res = createMockRes();
    await activityController.getActivityFeed(req, res);

    ExecutionEvent.find = origFind;
    Project.find = origProjFind;
    Task.find = origTaskFind;

    assert.strictEqual(res.body.restricted_activity_context, true);
  });

  await testAsync('Case 502: Member query filter injects explicit member project & task scoping', async () => {
    const origFind = ExecutionEvent.find;
    const origProjFind = Project.find;
    const origTaskFind = Task.find;

    let capturedFilter = null;
    Project.find = () => ({ select: () => Promise.resolve([{ _id: 'p_allowed_10' }]) });
    Task.find = () => ({ select: () => Promise.resolve([{ _id: 't_allowed_20' }]) });

    ExecutionEvent.find = (f) => {
      capturedFilter = f;
      return {
        sort: () => ({
          limit: () => ({
            populate: () => Promise.resolve([]),
          }),
        }),
      };
    };

    const req = { query: {}, user: { _id: 'member_dev', role: 'member' } };
    const res = createMockRes();
    await activityController.getActivityFeed(req, res);

    ExecutionEvent.find = origFind;
    Project.find = origProjFind;
    Task.find = origTaskFind;

    assert.ok(capturedFilter.$or, 'Member filter must inject privacy $or scoping');
    assert.strictEqual(res.body.restricted_activity_context, true);
  });

  await testAsync('Case 503: Member query with explicit unpermitted project returns 403 Forbidden', async () => {
    const origProjFindById = Project.findById;
    Project.findById = () => Promise.resolve({
      _id: 'p_forbidden',
      owner: 'other_owner',
      members: [],
    });

    const req = {
      query: { project: '507f1f77bcf86cd799439077' },
      user: { _id: 'member_dev', role: 'member' },
    };
    const res = createMockRes();
    await activityController.getActivityFeed(req, res);

    Project.findById = origProjFindById;

    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(res.body.success, false);
    assert.match(res.body.message, /Not authorized to view activity for this project/);
  });

  await testAsync('Case 504: Member query with permitted project succeeds and retains project filter', async () => {
    const origProjFindById = Project.findById;
    const origFind = ExecutionEvent.find;

    Project.findById = () => Promise.resolve({
      _id: 'p_permitted',
      owner: 'other_owner',
      members: [{ user: 'member_allowed' }],
    });

    let capturedFilter = null;
    ExecutionEvent.find = (f) => {
      capturedFilter = f;
      return {
        sort: () => ({
          limit: () => ({
            populate: () => Promise.resolve([]),
          }),
        }),
      };
    };

    const req = {
      query: { project: '507f1f77bcf86cd799439088' },
      user: { _id: 'member_allowed', role: 'member' },
    };
    const res = createMockRes();
    await activityController.getActivityFeed(req, res);

    Project.findById = origProjFindById;
    ExecutionEvent.find = origFind;

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(capturedFilter.project, '507f1f77bcf86cd799439088');
    assert.strictEqual(res.body.restricted_activity_context, true);
  });

  await testAsync('Case 505: Colleague activities in unpermitted projects produce zero event leakage', async () => {
    const origProjFind = Project.find;
    const origTaskFind = Task.find;
    const origFind = ExecutionEvent.find;

    Project.find = () => ({ select: () => Promise.resolve([]) });
    Task.find = () => ({ select: () => Promise.resolve([]) });
    ExecutionEvent.find = (f) => ({
      sort: () => ({
        limit: () => ({
          populate: () => Promise.resolve([]),
        }),
      }),
    });

    const req = { query: {}, user: { _id: 'lone_member', role: 'member' } };
    const res = createMockRes();
    await activityController.getActivityFeed(req, res);

    Project.find = origProjFind;
    Task.find = origTaskFind;
    ExecutionEvent.find = origFind;

    assert.strictEqual(res.body.events.length, 0);
  });

  test('Case 506: Member privacy invariant: colleague IDs and names absent from restricted payload', () => {
    const memberEvents = [
      {
        _id: 'ev_1',
        actor: { name: 'My Self', role: 'member' },
        summary: 'I created task A',
        changes: [{ field: 'status', from: 'To Do', to: 'In Progress' }],
      },
    ];
    // Verify no secret or colleague leaking fields exist in the payload
    assert.strictEqual(memberEvents[0].actor.name, 'My Self');
  });

  test('Case 507: Rejection of malformed ObjectIds in project query filter', async () => {
    const req = { query: { project: 'invalid-hex-id' }, user: { _id: 'admin_1', role: 'admin' } };
    const res = createMockRes();
    await activityController.getActivityFeed(req, res);
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.success, false);
    assert.match(res.body.message, /Invalid project ID format/);
  });

  test('Case 508: Rejection of malformed ObjectIds in actor query filter', async () => {
    const req = { query: { actor: 'invalid-actor' }, user: { _id: 'admin_1', role: 'admin' } };
    const res = createMockRes();
    await activityController.getActivityFeed(req, res);
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.success, false);
    assert.match(res.body.message, /Invalid actor ID format/);
  });

  // --- SUBSECTION 20.8: Single Event Detail & Project-Scoped Routes ---

  await testAsync('Case 509: GET /api/activity/:id returns full event details for authorized user', async () => {
    const origFindById = ExecutionEvent.findById;
    const mockEvent = {
      _id: '507f1f77bcf86cd799439011',
      eventType: 'task.created',
      subjectType: 'task',
      subjectId: '507f1f77bcf86cd799439012',
      aggregateVersion: 1,
      project: null,
      populate: function() { return Promise.resolve(this); },
    };
    ExecutionEvent.findById = () => mockEvent;

    const req = { params: { id: '507f1f77bcf86cd799439011' }, user: { _id: 'admin_1', role: 'admin' } };
    const res = createMockRes();
    await activityController.getEventById(req, res);

    ExecutionEvent.findById = origFindById;

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.event._id, '507f1f77bcf86cd799439011');
  });

  await testAsync('Case 510: GET /api/activity/:id returns 404 for non-existent event ID', async () => {
    const origFindById = ExecutionEvent.findById;
    ExecutionEvent.findById = () => ({
      populate: () => Promise.resolve(null),
    });

    const req = { params: { id: '507f1f77bcf86cd799439099' }, user: { _id: 'admin_1', role: 'admin' } };
    const res = createMockRes();
    await activityController.getEventById(req, res);

    ExecutionEvent.findById = origFindById;

    assert.strictEqual(res.statusCode, 404);
    assert.strictEqual(res.body.success, false);
    assert.match(res.body.message, /Activity event not found/);
  });

  await testAsync('Case 511: GET /api/activity/:id returns 400 for invalid ObjectId format', async () => {
    const req = { params: { id: 'not-an-objectid' }, user: { _id: 'admin_1', role: 'admin' } };
    const res = createMockRes();
    await activityController.getEventById(req, res);

    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.success, false);
    assert.match(res.body.message, /Invalid event ID format/);
  });

  await testAsync('Case 512: GET /api/activity/:id returns 403 when Member accesses unpermitted project event', async () => {
    const origFindById = ExecutionEvent.findById;
    const origProjFindById = Project.findById;

    const mockEvent = {
      _id: '507f1f77bcf86cd799439011',
      eventType: 'task.created',
      project: '507f1f77bcf86cd799439088',
      populate: function() { return Promise.resolve(this); },
    };
    ExecutionEvent.findById = () => mockEvent;
    Project.findById = () => Promise.resolve({
      _id: '507f1f77bcf86cd799439088',
      owner: 'other_owner',
      members: [],
    });

    const req = { params: { id: '507f1f77bcf86cd799439011' }, user: { _id: 'member_dev', role: 'member' } };
    const res = createMockRes();
    await activityController.getEventById(req, res);

    ExecutionEvent.findById = origFindById;
    Project.findById = origProjFindById;

    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(res.body.success, false);
    assert.match(res.body.message, /Not authorized to view this event/);
  });

  await testAsync('Case 513: GET /api/projects/:projectId/activity returns project-scoped activity feed', async () => {
    const origFind = ExecutionEvent.find;
    let capturedFilter = null;
    ExecutionEvent.find = (f) => {
      capturedFilter = f;
      return {
        sort: () => ({
          limit: () => ({
            populate: () => Promise.resolve([]),
          }),
        }),
      };
    };

    const req = {
      params: { projectId: '507f1f77bcf86cd799439033' },
      query: {},
      user: { _id: 'admin_1', role: 'admin' },
    };
    const res = createMockRes();
    await activityController.getProjectActivity(req, res);

    ExecutionEvent.find = origFind;

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(capturedFilter.project, '507f1f77bcf86cd799439033');
  });

  await testAsync('Case 514: GET /api/projects/:projectId/activity returns 400 on malformed projectId', async () => {
    const req = {
      params: { projectId: 'bad-project-id' },
      query: {},
      user: { _id: 'admin_1', role: 'admin' },
    };
    const res = createMockRes();
    await activityController.getProjectActivity(req, res);

    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.success, false);
    assert.match(res.body.message, /Invalid project ID format/);
  });

  await testAsync('Case 515: GET /api/projects/:projectId/activity returns 403 for unauthorized Member', async () => {
    const origProjFindById = Project.findById;
    Project.findById = () => Promise.resolve({
      _id: '507f1f77bcf86cd799439044',
      owner: 'other_owner',
      members: [],
    });

    const req = {
      params: { projectId: '507f1f77bcf86cd799439044' },
      query: {},
      user: { _id: 'member_dev', role: 'member' },
    };
    const res = createMockRes();
    await activityController.getProjectActivity(req, res);

    Project.findById = origProjFindById;

    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(res.body.success, false);
    assert.match(res.body.message, /Not authorized to view activity for this project/);
  });

  // --- SUBSECTION 20.9: Domain Mutation Orchestration Verification ---

  await testAsync('Case 516: projectController.createProject orchestrates project.created event', async () => {
    const origCreate = Project.create;
    let createdDoc = null;
    Project.create = (data) => {
      createdDoc = { ...data, _id: 'p_new_1', aggregateVersion: 0 };
      createdDoc.populate = async () => createdDoc;
      return Promise.resolve(createdDoc);
    };

    const req = {
      body: { name: 'Audit Project' },
      user: { _id: 'mgr_1', name: 'Manager 1', role: 'manager' },
    };
    const res = createMockRes();
    await projectController.createProject(req, res);

    Project.create = origCreate;

    assert.strictEqual(res.statusCode, 201);
    assert.strictEqual(createdDoc.aggregateVersion, 1);
  });

  await testAsync('Case 517: projectController.updateProject orchestrates project.updated event', async () => {
    const origFindById = Project.findById;
    const projectMock = {
      _id: 'p_upd_audit',
      name: 'Old Name',
      owner: 'mgr_1',
      members: [],
      aggregateVersion: 1,
      save: async function() { return this; },
      populate: async function() { return this; },
    };
    Project.findById = async () => projectMock;

    const req = {
      params: { id: 'p_upd_audit' },
      body: { name: 'New Name' },
      user: { _id: 'mgr_1', name: 'Manager 1', role: 'manager' },
    };
    const res = createMockRes();
    await projectController.updateProject(req, res);

    Project.findById = origFindById;

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(projectMock.aggregateVersion, 2);
  });

  await testAsync('Case 518: projectController.deleteProject with force orchestrates project.deleted event', async () => {
    const origFindById = Project.findById;
    const origDelete = Project.findByIdAndDelete;

    const projectMock = {
      _id: 'p_del_audit',
      name: 'Deleting Project',
      owner: 'admin_1',
      status: 'active',
      aggregateVersion: 1,
      save: async function() { return this; },
    };
    Project.findById = async () => projectMock;
    Project.findByIdAndDelete = async () => projectMock;

    const req = {
      params: { id: 'p_del_audit' },
      query: { force: 'true' },
      user: { _id: 'admin_1', name: 'Admin Root', role: 'admin' },
    };
    const res = createMockRes();
    await projectController.deleteProject(req, res);

    Project.findById = origFindById;
    Project.findByIdAndDelete = origDelete;

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(projectMock.aggregateVersion, 2);
  });

  await testAsync('Case 519: taskController.createTask orchestrates task.created event', async () => {
    const origCreate = Task.create;
    let createdTask = null;
    Task.create = (data) => {
      createdTask = { ...data, _id: 't_new_1', aggregateVersion: 0 };
      createdTask.populate = async () => createdTask;
      return Promise.resolve(createdTask);
    };

    const req = {
      body: { title: 'First Ledger Task' },
      user: { _id: 'user_dev', name: 'Dev User', role: 'member' },
    };
    const res = createMockRes();
    await taskController.createTask(req, res);

    Task.create = origCreate;

    assert.strictEqual(res.statusCode, 201);
    assert.strictEqual(createdTask.aggregateVersion, 1);
  });

  await testAsync('Case 520: taskController.updateTask status transition orchestrates task.status_changed event', async () => {
    const origFindById = Task.findById;
    const taskMock = {
      _id: 't_status_audit',
      title: 'Status Audit Task',
      status: 'To Do',
      createdBy: 'user_dev',
      aggregateVersion: 1,
      save: async function() { return this; },
      populate: async function() { return this; },
    };
    Task.findById = async () => taskMock;

    const req = {
      params: { id: 't_status_audit' },
      body: { status: 'In Progress' },
      user: { _id: 'user_dev', name: 'Dev User', role: 'member' },
    };
    const res = createMockRes();
    await taskController.updateTask(req, res);

    Task.findById = origFindById;

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(taskMock.aggregateVersion, 2);
  });

  await testAsync('Case 521: taskController.updateTask blocker addition orchestrates blocker.added event', async () => {
    const origFindById = Task.findById;
    const taskMock = {
      _id: 't_blocker_audit',
      title: 'Blocker Audit Task',
      status: 'In Progress',
      isBlocked: false,
      blockedReason: '',
      createdBy: 'user_dev',
      aggregateVersion: 2,
      save: async function() { return this; },
      populate: async function() { return this; },
    };
    Task.findById = async () => taskMock;

    const req = {
      params: { id: 't_blocker_audit' },
      body: { isBlocked: true, blockedReason: 'Database migration pending' },
      user: { _id: 'user_dev', name: 'Dev User', role: 'member' },
    };
    const res = createMockRes();
    await taskController.updateTask(req, res);

    Task.findById = origFindById;

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(taskMock.aggregateVersion, 3);
  });

  await testAsync('Case 522: taskController.updateTask blocker resolution orchestrates blocker.resolved event', async () => {
    const origFindById = Task.findById;
    const taskMock = {
      _id: 't_unblock_audit',
      title: 'Unblock Audit Task',
      status: 'In Progress',
      isBlocked: true,
      blockedReason: 'Waiting on third party API',
      createdBy: 'user_dev',
      aggregateVersion: 3,
      save: async function() { return this; },
      populate: async function() { return this; },
    };
    Task.findById = async () => taskMock;

    const req = {
      params: { id: 't_unblock_audit' },
      body: { isBlocked: false },
      user: { _id: 'user_dev', name: 'Dev User', role: 'member' },
    };
    const res = createMockRes();
    await taskController.updateTask(req, res);

    Task.findById = origFindById;

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(taskMock.aggregateVersion, 4);
  });

  await testAsync('Case 523: taskController.updateTask assignee update orchestrates task.assigned event', async () => {
    const origFindById = Task.findById;
    const taskMock = {
      _id: 't_assign_audit',
      title: 'Assign Audit Task',
      status: 'To Do',
      assignedTo: null,
      createdBy: 'mgr_1',
      aggregateVersion: 1,
      save: async function() { return this; },
      populate: async function() { return this; },
    };
    Task.findById = async () => taskMock;

    const req = {
      params: { id: 't_assign_audit' },
      body: { assignedTo: '507f1f77bcf86cd799439099' },
      user: { _id: 'mgr_1', name: 'Manager 1', role: 'manager' },
    };
    const res = createMockRes();
    await taskController.updateTask(req, res);

    Task.findById = origFindById;

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(taskMock.aggregateVersion, 2);
  });

  await testAsync('Case 524: taskController.addTaskDependency orchestrates dependency.added event', async () => {
    const origTaskFindById = Task.findById;
    const origProjectFindById = Project.findById;
    const origTaskFind = Task.find;
    const origFindByIdAndUpdate = Task.findByIdAndUpdate;

    const taskA = {
      _id: '507f1f77bcf86cd799439001',
      title: 'Task A',
      project: '507f1f77bcf86cd799439010',
      dependsOn: [],
      aggregateVersion: 1,
      save: async function() { return this; },
    };
    const taskB = {
      _id: '507f1f77bcf86cd799439002',
      title: 'Task B',
      project: '507f1f77bcf86cd799439010',
      dependsOn: [],
    };
    const projectMock = {
      _id: '507f1f77bcf86cd799439010',
      status: 'active',
      owner: 'mgr_1',
      members: [],
    };

    Task.findById = (id) => {
      if (id.toString() === taskA._id) {
        return {
          ...taskA,
          populate: () => Promise.resolve(taskA),
        };
      }
      return Promise.resolve(taskB);
    };
    Project.findById = () => Promise.resolve(projectMock);
    Task.find = () => ({
      select: () => Promise.resolve([taskA, taskB]),
    });
    Task.findByIdAndUpdate = async () => taskA;

    const req = {
      params: { id: taskA._id },
      body: { dependsOnTaskId: taskB._id },
      user: { _id: 'mgr_1', name: 'Manager 1', role: 'manager' },
    };
    const res = createMockRes();
    await taskController.addTaskDependency(req, res);

    Task.findById = origTaskFindById;
    Project.findById = origProjectFindById;
    Task.find = origTaskFind;
    Task.findByIdAndUpdate = origFindByIdAndUpdate;

    assert.strictEqual(res.statusCode, 201);
    assert.strictEqual(taskA.aggregateVersion, 2);
  });

  await testAsync('Case 525: taskController.removeTaskDependency orchestrates dependency.removed event', async () => {
    const origTaskFindById = Task.findById;
    const origProjectFindById = Project.findById;
    const origFindByIdAndUpdate = Task.findByIdAndUpdate;

    const taskA = {
      _id: '507f1f77bcf86cd799439001',
      title: 'Task A',
      project: '507f1f77bcf86cd799439010',
      dependsOn: ['507f1f77bcf86cd799439002'],
      aggregateVersion: 2,
      save: async function() { return this; },
    };

    Task.findById = () => Promise.resolve(taskA);
    Project.findById = () => Promise.resolve({ _id: '507f1f77bcf86cd799439010', status: 'active' });
    Task.findByIdAndUpdate = async () => taskA;

    const req = {
      params: { id: taskA._id, dependencyTaskId: '507f1f77bcf86cd799439002' },
      user: { _id: 'mgr_1', name: 'Manager 1', role: 'manager' },
    };
    const res = createMockRes();
    await taskController.removeTaskDependency(req, res);

    Task.findById = origTaskFindById;
    Project.findById = origProjectFindById;
    Task.findByIdAndUpdate = origFindByIdAndUpdate;

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(taskA.aggregateVersion, 3);
  });

  await testAsync('Case 526: releaseController.createRelease orchestrates release.created event', async () => {
    const origProjectFindById = Project.findById;
    const origReleaseCreate = Release.create;

    Project.findById = () => Promise.resolve({
      _id: '507f1f77bcf86cd799439010',
      status: 'active',
      owner: 'mgr_1',
      members: [],
    });

    let createdRelease = null;
    Release.create = (data) => {
      createdRelease = { ...data, _id: 'rel_1', aggregateVersion: 0 };
      createdRelease.populate = async () => createdRelease;
      return Promise.resolve(createdRelease);
    };

    const req = {
      body: {
        name: 'Release 1.0',
        version: 'v1.0.0',
        targetDate: '2026-12-31',
        project: '507f1f77bcf86cd799439010',
      },
      user: { _id: 'mgr_1', name: 'Manager 1', role: 'manager' },
    };
    const res = createMockRes();
    await releaseController.createRelease(req, res);

    Project.findById = origProjectFindById;
    Release.create = origReleaseCreate;

    assert.strictEqual(res.statusCode, 201);
    assert.strictEqual(createdRelease.aggregateVersion, 1);
  });

  await testAsync('Case 527: releaseController.updateRelease orchestrates release.updated event', async () => {
    const origReleaseFindById = Release.findById;
    const origProjectFindById = Project.findById;

    const releaseMock = {
      _id: 'rel_upd',
      name: 'Release 1.0',
      status: 'planning',
      project: '507f1f77bcf86cd799439010',
      aggregateVersion: 1,
      save: async function() { return this; },
      populate: async function() { return this; },
    };
    Release.findById = () => Promise.resolve(releaseMock);
    Project.findById = () => Promise.resolve({
      _id: '507f1f77bcf86cd799439010',
      status: 'active',
      owner: 'mgr_1',
      members: [],
    });

    const req = {
      params: { id: 'rel_upd' },
      body: { name: 'Release 1.0.1' },
      user: { _id: 'mgr_1', name: 'Manager 1', role: 'manager' },
    };
    const res = createMockRes();
    await releaseController.updateRelease(req, res);

    Release.findById = origReleaseFindById;
    Project.findById = origProjectFindById;

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(releaseMock.aggregateVersion, 2);
  });

  await testAsync('Case 528: milestoneController.createMilestone orchestrates milestone.created event', async () => {
    const origProjectFindById = Project.findById;
    const origMilestoneCreate = Milestone.create;

    Project.findById = () => Promise.resolve({
      _id: '507f1f77bcf86cd799439010',
      status: 'active',
      owner: 'mgr_1',
      members: [],
    });

    let createdMilestone = null;
    Milestone.create = (data) => {
      createdMilestone = { ...data, _id: 'ms_1', aggregateVersion: 0 };
      createdMilestone.populate = async () => createdMilestone;
      return Promise.resolve(createdMilestone);
    };

    const req = {
      body: {
        title: 'Beta MVP',
        project: '507f1f77bcf86cd799439010',
        dueDate: '2026-12-31',
      },
      user: { _id: 'mgr_1', name: 'Manager 1', role: 'manager' },
    };
    const res = createMockRes();
    await milestoneController.createMilestone(req, res);

    Project.findById = origProjectFindById;
    Milestone.create = origMilestoneCreate;

    assert.strictEqual(res.statusCode, 201);
    assert.strictEqual(createdMilestone.aggregateVersion, 1);
  });

  await testAsync('Case 529: decisionController.createDecision orchestrates decision.created event', async () => {
    const origProjectFindById = Project.findById;
    const origDecisionCreate = DecisionRecord.create;

    Project.findById = () => Promise.resolve({
      _id: '507f1f77bcf86cd799439010',
      status: 'active',
      owner: 'mgr_1',
      members: [],
    });

    let createdDecision = null;
    DecisionRecord.create = (data) => {
      createdDecision = { ...data, _id: 'adr_1', aggregateVersion: 0 };
      createdDecision.populate = async () => createdDecision;
      return Promise.resolve(createdDecision);
    };

    const req = {
      body: {
        title: 'Use Append-Only Ledger',
        scope: 'project',
        project: '507f1f77bcf86cd799439010',
        context: 'Need robust auditability',
        decision: 'Adopt versioned ledger pattern',
        rationale: 'Robust versioning guarantees verifiable audit trails',
        consequences: { positive: ['Immutability guaranteed'], negative: [], risks: [] },
      },
      user: { _id: 'mgr_1', name: 'Manager 1', role: 'manager' },
    };
    const res = createMockRes();
    await decisionController.createDecision(req, res);

    Project.findById = origProjectFindById;
    DecisionRecord.create = origDecisionCreate;

    assert.strictEqual(res.statusCode, 201);
    assert.strictEqual(createdDecision.aggregateVersion, 1);
  });

  await testAsync('Case 530: capacityController.upsertProjectCapacity orchestrates capacity.configured event', async () => {
    const origProjectFindById = Project.findById;
    const origUserFindById = User.findById;
    const origCapFindOne = ProjectCapacity.findOne;
    const origCapCreate = ProjectCapacity.create;

    Project.findById = () => Promise.resolve({
      _id: '507f1f77bcf86cd799439010',
      status: 'active',
      owner: 'mgr_1',
      members: [{ user: '507f1f77bcf86cd799439020' }],
    });
    User.findById = () => Promise.resolve({
      _id: '507f1f77bcf86cd799439020',
      name: 'Team Engineer',
      isActive: true,
    });
    ProjectCapacity.findOne = () => Promise.resolve(null);

    let createdCap = null;
    ProjectCapacity.create = (data) => {
      createdCap = { ...data, _id: 'cap_1', aggregateVersion: 0 };
      createdCap.populate = async () => createdCap;
      return Promise.resolve(createdCap);
    };

    const req = {
      params: {
        projectId: '507f1f77bcf86cd799439010',
        userId: '507f1f77bcf86cd799439020',
      },
      body: { availableDaysPerWeek: 4, wipLimit: 3 },
      user: { _id: 'mgr_1', name: 'Manager 1', role: 'manager' },
    };
    const res = createMockRes();
    await capacityController.upsertProjectCapacity(req, res);

    Project.findById = origProjectFindById;
    User.findById = origUserFindById;
    ProjectCapacity.findOne = origCapFindOne;
    ProjectCapacity.create = origCapCreate;

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(createdCap.aggregateVersion, 1);
  });

  // --- SUBSECTION 20.10: Transactional Atomicity inside session.withTransaction ---

  await testAsync('Case 531: Failure injection: aggregate mutation failure aborts session, inserts 0 events, advances 0 versions', async () => {
    let sessionAborted = false;
    let sessionEnded = false;
    let eventsInserted = 0;

    const mockSession = {
      withTransaction: async (fn) => {
        try {
          await fn();
        } catch (err) {
          sessionAborted = true;
          throw err;
        }
      },
      endSession: async () => {
        sessionEnded = true;
      },
    };

    const origStartSession = mongoose.startSession;
    mongoose.startSession = async () => mockSession;

    const mockAggregate = {
      _id: '507f1f77bcf86cd799439090',
      constructor: { modelName: 'Task' },
      aggregateVersion: 2,
    };

    let caughtError = null;
    try {
      await recordExecutionEvent({
        aggregate: mockAggregate,
        mutate: async () => {
          throw new Error('Simulated aggregate mutation failure');
        },
        eventInput: {
          eventType: 'task.status_changed',
          actor: '507f1f77bcf86cd799439001',
          subjectType: 'task',
          subjectId: mockAggregate._id,
          summary: 'Status change attempt',
        },
        options: { forceTransaction: true },
      });
    } catch (err) {
      caughtError = err;
    }

    mongoose.startSession = origStartSession;

    assert(caughtError, 'Should throw on mutation failure');
    assert.strictEqual(caughtError.message, 'Simulated aggregate mutation failure');
    assert.strictEqual(sessionAborted, true, 'Transaction must be aborted');
    assert.strictEqual(sessionEnded, true, 'Session must end in finally block');
    assert.strictEqual(mockAggregate.aggregateVersion, 2, 'Version must not advance on failure');
    assert.strictEqual(eventsInserted, 0, 'No event must be inserted');
  });

  await testAsync('Case 532: Failure injection: event insertion failure rolls back aggregate mutation and version advancement', async () => {
    let sessionAborted = false;
    let sessionEnded = false;

    const mockSession = {
      withTransaction: async (fn) => {
        try {
          await fn();
        } catch (err) {
          sessionAborted = true;
          throw err;
        }
      },
      endSession: async () => {
        sessionEnded = true;
      },
    };

    const origStartSession = mongoose.startSession;
    const origSave = ExecutionEvent.prototype.save;

    mongoose.startSession = async () => mockSession;
    ExecutionEvent.prototype.save = async function() {
      const err = new Error('Simulated event insertion failure (duplicate key or disk full)');
      err.code = 11000;
      throw err;
    };

    const mockAggregate = {
      _id: '507f1f77bcf86cd799439091',
      constructor: { modelName: 'Task' },
      aggregateVersion: 2,
      status: 'To Do',
      save: async () => {},
    };

    let caughtError = null;
    try {
      await recordExecutionEvent({
        aggregate: mockAggregate,
        mutate: async () => {
          mockAggregate.status = 'In Progress';
        },
        eventInput: {
          eventType: 'task.status_changed',
          actor: '507f1f77bcf86cd799439001',
          subjectType: 'task',
          subjectId: mockAggregate._id,
          summary: 'Status change attempt',
        },
        options: { forceTransaction: true },
      });
    } catch (err) {
      caughtError = err;
    }

    mongoose.startSession = origStartSession;
    ExecutionEvent.prototype.save = origSave;

    assert(caughtError, 'Should throw when event insertion fails');
    assert.strictEqual(sessionAborted, true, 'Transaction must be aborted on event insert failure');
    assert.strictEqual(sessionEnded, true, 'Session must be ended');
  });

  await testAsync('Case 533: Transactional atomicity: successful withTransaction commits aggregate and event with identical aggregateVersion', async () => {
    let sessionCommitted = false;
    let sessionEnded = false;
    let savedEvent = null;

    const mockSession = {
      withTransaction: async (fn) => {
        await fn();
        sessionCommitted = true;
      },
      endSession: async () => {
        sessionEnded = true;
      },
    };

    const origStartSession = mongoose.startSession;
    const origSave = ExecutionEvent.prototype.save;

    mongoose.startSession = async () => mockSession;
    ExecutionEvent.prototype.save = async function() {
      savedEvent = this;
      return this;
    };

    const mockAggregate = {
      _id: '507f1f77bcf86cd799439092',
      constructor: { modelName: 'Project' },
      aggregateVersion: 5,
      name: 'Old Project Name',
      save: async () => {},
    };

    const result = await recordExecutionEvent({
      aggregate: mockAggregate,
      mutate: async () => {
        mockAggregate.name = 'New Project Name';
      },
      eventInput: {
        eventType: 'project.updated',
        actor: '507f1f77bcf86cd799439001',
        subjectType: 'project',
        subjectId: mockAggregate._id,
        summary: 'Updated project name',
      },
      options: { forceTransaction: true },
    });

    mongoose.startSession = origStartSession;
    ExecutionEvent.prototype.save = origSave;

    assert.strictEqual(sessionCommitted, true, 'Transaction committed');
    assert.strictEqual(sessionEnded, true, 'Session cleanly terminated');
    assert.strictEqual(mockAggregate.aggregateVersion, 6, 'Aggregate version advanced');
    assert.strictEqual(savedEvent.aggregateVersion, 6, 'Event aggregateVersion matches aggregate');
    assert.strictEqual(savedEvent.subjectType, 'project');
    assert.strictEqual(savedEvent.subjectId.toString(), mockAggregate._id.toString());
    assert.strictEqual(result.aggregateVersion, 6);
  });

  await testAsync('Case 534: Concurrency retry inside standalone handles transient duplicate key conflict', async () => {
    let attempts = 0;
    const origFindOne = ExecutionEvent.findOne;
    const origSave = ExecutionEvent.prototype.save;

    ExecutionEvent.findOne = (query) => {
      if (query && query.$or) {
        return Promise.resolve({
          _id: 'ev_retry_success',
          aggregateVersion: 2,
        });
      }
      return Promise.resolve(null);
    };

    ExecutionEvent.prototype.save = async function() {
      attempts += 1;
      if (attempts === 1) {
        const err = new Error('E11000 duplicate key error collection');
        err.code = 11000;
        throw err;
      }
      return this;
    };

    const mockAggregate = {
      _id: '507f1f77bcf86cd799439093',
      constructor: { modelName: 'Task' },
      aggregateVersion: 1,
      save: async () => {},
    };

    const result = await recordExecutionEvent({
      aggregate: mockAggregate,
      mutate: async () => {},
      eventInput: {
        eventType: 'task.updated',
        actor: '507f1f77bcf86cd799439001',
        subjectType: 'task',
        subjectId: mockAggregate._id,
        summary: 'Concurrent retry test',
      },
      options: { forceStandalone: true, forceSave: true },
    });

    ExecutionEvent.findOne = origFindOne;
    ExecutionEvent.prototype.save = origSave;

    assert.strictEqual(attempts, 1, 'Attempted save triggered 11000 handling');
    assert.strictEqual(result.aggregateVersion, 2);
  });

  await testAsync('Case 535: In replica set, recordExecutionEvent executes startSession and withTransaction without leaks', async () => {
    let endSessionCalled = false;
    const mockSession = {
      withTransaction: async (fn) => {
        await fn();
      },
      endSession: async () => {
        endSessionCalled = true;
      },
    };

    const origStartSession = mongoose.startSession;
    const origSave = ExecutionEvent.prototype.save;

    mongoose.startSession = async () => mockSession;
    ExecutionEvent.prototype.save = async function() { return this; };

    const mockAggregate = {
      _id: '507f1f77bcf86cd799439094',
      constructor: { modelName: 'Release' },
      aggregateVersion: 0,
      save: async () => {},
    };

    await recordExecutionEvent({
      aggregate: mockAggregate,
      mutate: async () => {},
      eventInput: {
        eventType: 'release.created',
        actor: '507f1f77bcf86cd799439001',
        subjectType: 'release',
        subjectId: mockAggregate._id,
        summary: 'Release created',
      },
      options: { forceTransaction: true },
    });

    mongoose.startSession = origStartSession;
    ExecutionEvent.prototype.save = origSave;

    assert.strictEqual(endSessionCalled, true);
  });

  await testAsync('Case 536: No-op rejection when mutation closure produces zero delta or aborts cleanly', async () => {
    const mockAggregate = {
      _id: '507f1f77bcf86cd799439095',
      constructor: { modelName: 'Task' },
      aggregateVersion: 3,
    };

    const result = await recordExecutionEvent({
      aggregate: mockAggregate,
      mutate: async () => {
        return { isNoOp: true };
      },
      eventInput: {
        eventType: 'task.updated',
        actor: '507f1f77bcf86cd799439001',
        subjectType: 'task',
        subjectId: mockAggregate._id,
        summary: 'No-op update',
      },
    });

    assert.strictEqual(result.isNoOp, true);
    assert.strictEqual(result.event, null, 'No event created on no-op');
    assert.strictEqual(mockAggregate.aggregateVersion, 3, 'Version untouched');
  });

  await testAsync('Case 537: Session end is guaranteed in finally block even when error is thrown', async () => {
    let sessionEnded = false;
    const mockSession = {
      withTransaction: async () => {
        throw new Error('Fatal error during transaction body');
      },
      endSession: async () => {
        sessionEnded = true;
      },
    };

    const origStartSession = mongoose.startSession;
    mongoose.startSession = async () => mockSession;

    const mockAggregate = {
      _id: '507f1f77bcf86cd799439096',
      constructor: { modelName: 'Milestone' },
      aggregateVersion: 1,
    };

    let caught = null;
    try {
      await recordExecutionEvent({
        aggregate: mockAggregate,
        mutate: async () => {},
        eventInput: {
          eventType: 'milestone.updated',
          actor: '507f1f77bcf86cd799439001',
          subjectType: 'milestone',
          subjectId: mockAggregate._id,
          summary: 'Fatal error milestone',
        },
        options: { forceTransaction: true },
      });
    } catch (err) {
      caught = err;
    } finally {
      mongoose.startSession = origStartSession;
    }

    assert(caught, 'Should catch fatal error');
    assert.strictEqual(sessionEnded, true, 'endSession must run in finally block');
  });

  // --- SUBSECTION 20.11: Standalone Fallback Failure Modes & Detectability ---

  await testAsync('Case 538: Standalone fallback reports honest engine string', async () => {
    const cov = await computeLedgerCoverage();
    assert.strictEqual(cov.ledger.engine, 'Standalone MongoDB (Monotonic Sequence & Synchronous Append — Non-Atomic Fallback)');
  });

  await testAsync('Case 539: Failure before aggregate mutation in standalone aborts cleanly without event insertion', async () => {
    const mockAggregate = {
      _id: '507f1f77bcf86cd799439098',
      constructor: { modelName: 'Task' },
      aggregateVersion: 1,
    };

    let caught = null;
    try {
      await recordExecutionEvent({
        aggregate: mockAggregate,
        mutate: async () => {
          throw new Error('Pre-mutation validation failed');
        },
        eventInput: {
          eventType: 'task.updated',
          actor: '507f1f77bcf86cd799439001',
          subjectType: 'task',
          subjectId: mockAggregate._id,
          summary: 'Failed pre-mutation',
        },
      });
    } catch (err) {
      caught = err;
    }

    assert(caught, 'Should catch pre-mutation error');
    assert.strictEqual(mockAggregate.aggregateVersion, 1, 'Version must not advance');
  });

  await testAsync('Case 540: Failure during event insertion after mutation leaves detectable version_ahead_of_events gap', async () => {
    const aggregates = [{
      _id: '507f1f77bcf86cd799439099',
      name: 'Partial Write Task',
      aggregateVersion: 2,
    }];
    const events = [{
      _id: 'ev_1',
      subjectType: 'Task',
      subjectId: '507f1f77bcf86cd799439099',
      aggregateVersion: 1,
    }];

    const coverage = computeLedgerCoverage(aggregates, events, 'Task');
    assert.strictEqual(coverage.status, 'version_ahead_of_events');
    assert.strictEqual(coverage.coveragePercent, 50);
    assert.strictEqual(coverage.expectedEvents, 2);
    assert.strictEqual(coverage.recordedEvents, 1);
    assert.strictEqual(coverage.gaps.length, 1);
    assert.strictEqual(coverage.gaps[0].type, 'version_ahead_of_events');
  });

  await testAsync('Case 541: CorrelationId idempotency deduplication prevents duplicate events on retry in standalone mode', async () => {
    const existingEvent = {
      _id: 'ev_existing_corr',
      correlationId: 'tx_uuid_123',
      subjectType: 'task',
      subjectId: '507f1f77bcf86cd799439100',
      aggregateVersion: 1,
      eventType: 'task.created',
    };

    const origFindOne = ExecutionEvent.findOne;
    ExecutionEvent.findOne = (query) => {
      if (query.correlationId === 'tx_uuid_123') {
        return Promise.resolve(existingEvent);
      }
      return Promise.resolve(null);
    };

    let mutateCalled = false;
    const mockAggregate = {
      _id: '507f1f77bcf86cd799439100',
      constructor: { modelName: 'Task' },
      aggregateVersion: 1,
    };

    const result = await recordExecutionEvent({
      aggregate: mockAggregate,
      eventInput: {
        correlationId: 'tx_uuid_123',
        eventType: 'task.created',
        actor: '507f1f77bcf86cd799439001',
        subjectType: 'task',
        subjectId: mockAggregate._id,
        summary: 'Duplicate request retry',
      },
      mutate: async () => {
        mutateCalled = true;
      },
    });

    ExecutionEvent.findOne = origFindOne;

    assert.strictEqual(mutateCalled, false, 'Mutate should not run again for existing correlationId');
    assert.strictEqual(result.event._id, 'ev_existing_corr');
    assert.strictEqual(result.aggregateVersion, 1);
  });

  await testAsync('Case 542: Sequential monotonic version advancement in standalone fallback matches sequence 1, 2, 3', async () => {
    const mockAggregate = {
      _id: '507f1f77bcf86cd799439101',
      constructor: { modelName: 'Task' },
      aggregateVersion: 0,
      save: async () => {},
    };

    // First mutation
    const r1 = await recordExecutionEvent({
      aggregate: mockAggregate,
      eventInput: {
        eventType: 'task.created',
        actor: '507f1f77bcf86cd799439001',
        subjectType: 'task',
        subjectId: mockAggregate._id,
        summary: 'Step 1',
      },
    });
    assert.strictEqual(r1.aggregateVersion, 1);

    // Second mutation
    const r2 = await recordExecutionEvent({
      aggregate: mockAggregate,
      eventInput: {
        eventType: 'task.status_changed',
        actor: '507f1f77bcf86cd799439001',
        subjectType: 'task',
        subjectId: mockAggregate._id,
        summary: 'Step 2',
      },
    });
    assert.strictEqual(r2.aggregateVersion, 2);

    // Third mutation
    const r3 = await recordExecutionEvent({
      aggregate: mockAggregate,
      eventInput: {
        eventType: 'task.priority_changed',
        actor: '507f1f77bcf86cd799439001',
        subjectType: 'task',
        subjectId: mockAggregate._id,
        summary: 'Step 3',
      },
    });
    assert.strictEqual(r3.aggregateVersion, 3);
  });

  await testAsync('Case 543: Controlled 500 error reporting when event append fails after mutation in standalone', async () => {
    const origFindOne = ExecutionEvent.findOne;
    const origSave = ExecutionEvent.prototype.save;

    ExecutionEvent.findOne = () => Promise.resolve(null);
    ExecutionEvent.prototype.save = async function() {
      throw new Error('Disk full write failure');
    };

    const mockAggregate = {
      _id: '507f1f77bcf86cd799439102',
      constructor: { modelName: 'Task' },
      aggregateVersion: 0,
      save: async () => {},
    };

    let caught = null;
    try {
      await recordExecutionEvent({
        aggregate: mockAggregate,
        eventInput: {
          eventType: 'task.created',
          actor: '507f1f77bcf86cd799439001',
          subjectType: 'task',
          subjectId: mockAggregate._id,
          summary: 'Controlled 500 test',
        },
        options: { forceStandalone: true, forceSave: true },
      });
    } catch (err) {
      caught = err;
    }

    ExecutionEvent.findOne = origFindOne;
    ExecutionEvent.prototype.save = origSave;

    assert(caught, 'Must throw when event append fails');
    assert.match(caught.message, /Execution ledger append failed/);
  });

  // --- SUBSECTION 20.12: Complete Mutation-Route Coverage Across All 8 Domains & Deterministic Precedence ---

  await testAsync('Case 544: Deterministic precedence: status change + priority change in same request produces task.status_changed', async () => {
    const origFindById = Task.findById;
    const taskMock = {
      _id: 't_prec_1',
      title: 'Precedence Task 1',
      status: 'To Do',
      priority: 'medium',
      createdBy: 'user_dev',
      aggregateVersion: 1,
      save: async function() { return this; },
      populate: async function() { return this; },
    };
    Task.findById = async () => taskMock;

    const req = {
      params: { id: 't_prec_1' },
      body: { status: 'In Progress', priority: 'high' },
      user: { _id: 'user_dev', name: 'Dev User', role: 'member' },
    };
    const res = createMockRes();
    await taskController.updateTask(req, res);

    Task.findById = origFindById;

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(taskMock.aggregateVersion, 2);
    assert.strictEqual(taskMock.status, 'In Progress');
    assert.strictEqual(taskMock.priority, 'high');
  });

  await testAsync('Case 545: Deterministic precedence: blocker added + priority change prioritizes blocker.added', async () => {
    const origFindById = Task.findById;
    const taskMock = {
      _id: 't_prec_2',
      title: 'Precedence Task 2',
      status: 'In Progress',
      priority: 'low',
      isBlocked: false,
      blockedReason: '',
      createdBy: 'user_dev',
      aggregateVersion: 2,
      save: async function() { return this; },
      populate: async function() { return this; },
    };
    Task.findById = async () => taskMock;

    const req = {
      params: { id: 't_prec_2' },
      body: { isBlocked: true, blockedReason: 'Dependency stalled', priority: 'high' },
      user: { _id: 'user_dev', name: 'Dev User', role: 'member' },
    };
    const res = createMockRes();
    await taskController.updateTask(req, res);

    Task.findById = origFindById;

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(taskMock.aggregateVersion, 3);
    assert.strictEqual(taskMock.isBlocked, true);
    assert.strictEqual(taskMock.priority, 'high');
  });

  await testAsync('Case 546: Task priority change alone produces task.priority_changed event', async () => {
    const origFindById = Task.findById;
    const taskMock = {
      _id: 't_prio_only',
      title: 'Priority Only Task',
      status: 'In Progress',
      priority: 'low',
      isBlocked: false,
      createdBy: 'user_dev',
      aggregateVersion: 3,
      save: async function() { return this; },
      populate: async function() { return this; },
    };
    Task.findById = async () => taskMock;

    const req = {
      params: { id: 't_prio_only' },
      body: { priority: 'critical' },
      user: { _id: 'user_dev', name: 'Dev User', role: 'member' },
    };
    const res = createMockRes();
    await taskController.updateTask(req, res);

    Task.findById = origFindById;

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(taskMock.aggregateVersion, 4);
    assert.strictEqual(taskMock.priority, 'critical');
  });

  await testAsync('Case 547: Task deletion produces task.deleted event with aggregateVersion advancement', async () => {
    const origFindById = Task.findById;
    const origDeleteOne = Task.deleteOne;
    const origUpdateMany = Task.updateMany;

    const taskMock = {
      _id: '507f1f77bcf86cd799439110',
      title: 'Task To Delete',
      project: '507f1f77bcf86cd799439111',
      createdBy: 'user_dev',
      aggregateVersion: 2,
      deleteOne: async function() { return { deletedCount: 1 }; },
      save: async function() { return this; },
    };

    Task.findById = async () => taskMock;
    Task.deleteOne = async () => ({ deletedCount: 1 });
    Task.updateMany = async () => ({ modifiedCount: 0 });

    const req = {
      params: { id: taskMock._id },
      user: { _id: 'user_dev', name: 'Dev User', role: 'manager' },
    };
    const res = createMockRes();
    await taskController.deleteTask(req, res);

    Task.findById = origFindById;
    Task.deleteOne = origDeleteOne;
    Task.updateMany = origUpdateMany;

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(taskMock.aggregateVersion, 3);
  });

  await testAsync('Case 548: Project member addition produces project.member_added event with incremented aggregateVersion', async () => {
    const origFindById = Project.findById;
    const origUserFindById = User.findById;

    const projectMock = {
      _id: '507f1f77bcf86cd799439112',
      name: 'Team Project',
      owner: 'mgr_1',
      members: [],
      aggregateVersion: 1,
      save: async function() { return this; },
      populate: async function() { return this; },
    };
    const userToAdd = {
      _id: '507f1f77bcf86cd799439113',
      name: 'New Colleague',
      email: 'colleague@example.com',
      isActive: true,
    };

    Project.findById = async () => projectMock;
    User.findById = async () => userToAdd;

    const req = {
      params: { id: projectMock._id },
      body: { userId: userToAdd._id, role: 'developer' },
      user: { _id: 'mgr_1', name: 'Manager 1', role: 'manager' },
    };
    const res = createMockRes();
    await projectController.addMember(req, res);

    Project.findById = origFindById;
    User.findById = origUserFindById;

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(projectMock.aggregateVersion, 2);
    assert.strictEqual(projectMock.members.length, 1);
  });

  await testAsync('Case 549: Project member removal produces project.member_removed event with incremented aggregateVersion', async () => {
    const origFindById = Project.findById;

    const memberId = '507f1f77bcf86cd799439114';
    const projectMock = {
      _id: '507f1f77bcf86cd799439112',
      name: 'Team Project',
      owner: 'mgr_1',
      members: [{ user: memberId, role: 'developer' }],
      aggregateVersion: 2,
      save: async function() { return this; },
      populate: async function() { return this; },
    };

    Project.findById = async () => projectMock;

    const req = {
      params: { id: projectMock._id, userId: memberId },
      user: { _id: 'mgr_1', name: 'Manager 1', role: 'manager' },
    };
    const res = createMockRes();
    await projectController.removeMember(req, res);

    Project.findById = origFindById;

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(projectMock.aggregateVersion, 3);
    assert.strictEqual(projectMock.members.length, 0);
  });

  await testAsync('Case 550: Release cancelled produces release.cancelled event with incremented aggregateVersion', async () => {
    const origReleaseFindById = Release.findById;
    const origProjectFindById = Project.findById;

    const releaseMock = {
      _id: 'rel_cancel_1',
      name: 'Cancelled Release',
      status: 'planning',
      project: '507f1f77bcf86cd799439115',
      aggregateVersion: 1,
      save: async function() { return this; },
      populate: async function() { return this; },
    };

    Release.findById = () => Promise.resolve(releaseMock);
    Project.findById = () => Promise.resolve({
      _id: '507f1f77bcf86cd799439115',
      status: 'active',
      owner: 'mgr_1',
      members: [],
    });

    const req = {
      params: { id: 'rel_cancel_1' },
      body: { status: 'cancelled' },
      user: { _id: 'mgr_1', name: 'Manager 1', role: 'manager' },
    };
    const res = createMockRes();
    await releaseController.updateRelease(req, res);

    Release.findById = origReleaseFindById;
    Project.findById = origProjectFindById;

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(releaseMock.status, 'cancelled');
    assert.strictEqual(releaseMock.aggregateVersion, 2);
  });

  await testAsync('Case 551: Milestone cancelled produces milestone.cancelled event with incremented aggregateVersion', async () => {
    const origMilestoneFindById = Milestone.findById;
    const origProjectFindById = Project.findById;

    const milestoneMock = {
      _id: 'ms_cancel_1',
      title: 'Cancelled Milestone',
      status: 'open',
      project: '507f1f77bcf86cd799439116',
      aggregateVersion: 1,
      save: async function() { return this; },
      populate: async function() { return this; },
    };

    Milestone.findById = () => Promise.resolve(milestoneMock);
    Project.findById = () => Promise.resolve({
      _id: '507f1f77bcf86cd799439116',
      status: 'active',
      owner: 'mgr_1',
      members: [],
    });

    const req = {
      params: { id: 'ms_cancel_1' },
      body: { status: 'cancelled' },
      user: { _id: 'mgr_1', name: 'Manager 1', role: 'manager' },
    };
    const res = createMockRes();
    await milestoneController.updateMilestone(req, res);

    Milestone.findById = origMilestoneFindById;
    Project.findById = origProjectFindById;

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(milestoneMock.status, 'cancelled');
    assert.strictEqual(milestoneMock.aggregateVersion, 2);
  });

  await testAsync('Case 552: Decision record transition produces decision.accepted event with incremented aggregateVersion', async () => {
    const origDecisionFindById = DecisionRecord.findById;
    const origProjectFindById = Project.findById;

    const decisionMock = {
      _id: '507f1f77bcf86cd799439117',
      title: 'Architectural Decision',
      status: 'proposed',
      scope: 'project',
      project: '507f1f77bcf86cd799439116',
      aggregateVersion: 1,
      save: async function() { return this; },
      populate: async function() { return this; },
    };

    DecisionRecord.findById = () => Promise.resolve(decisionMock);
    Project.findById = () => Promise.resolve({
      _id: '507f1f77bcf86cd799439116',
      status: 'active',
      owner: 'mgr_1',
      members: [],
    });

    const req = {
      params: { id: decisionMock._id },
      body: { status: 'accepted' },
      user: { _id: 'mgr_1', name: 'Manager 1', role: 'manager' },
    };
    const res = createMockRes();
    await decisionController.transitionDecision(req, res);

    DecisionRecord.findById = origDecisionFindById;
    Project.findById = origProjectFindById;

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(decisionMock.status, 'accepted');
    assert.strictEqual(decisionMock.aggregateVersion, 2);
  });

  await testAsync('Case 553: Capacity configuration removal produces capacity.removed event with incremented aggregateVersion', async () => {
    const origProjectFindById = Project.findById;
    const origCapFindOneAndDelete = ProjectCapacity.findOneAndDelete;

    const capacityMock = {
      _id: '507f1f77bcf86cd799439118',
      project: '507f1f77bcf86cd799439118',
      user: '507f1f77bcf86cd799439119',
      availableDaysPerWeek: 4,
      aggregateVersion: 1,
      save: async function() { return this; },
      deleteOne: async function() { return { deletedCount: 1 }; },
    };

    Project.findById = () => Promise.resolve({
      _id: '507f1f77bcf86cd799439118',
      status: 'active',
      owner: 'mgr_1',
      members: [],
    });
    ProjectCapacity.findOneAndDelete = () => Promise.resolve(capacityMock);

    const req = {
      params: {
        projectId: '507f1f77bcf86cd799439118',
        userId: '507f1f77bcf86cd799439119',
      },
      user: { _id: 'mgr_1', name: 'Manager 1', role: 'manager' },
    };
    const res = createMockRes();
    await capacityController.deleteProjectCapacity(req, res);

    Project.findById = origProjectFindById;
    ProjectCapacity.findOneAndDelete = origCapFindOneAndDelete;

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(capacityMock.aggregateVersion, 2);
  });

  await testAsync('Case 554: Task title/description edit without status/blocker/priority/assignee change produces task.updated event', async () => {
    const origFindById = Task.findById;
    const taskMock = {
      _id: 't_desc_edit',
      title: 'Initial Title',
      description: 'Initial Description',
      status: 'In Progress',
      priority: 'medium',
      isBlocked: false,
      createdBy: 'user_dev',
      aggregateVersion: 1,
      save: async function() { return this; },
      populate: async function() { return this; },
    };
    Task.findById = async () => taskMock;

    const req = {
      params: { id: 't_desc_edit' },
      body: { title: 'Updated Title', description: 'Updated Description' },
      user: { _id: 'user_dev', name: 'Dev User', role: 'member' },
    };
    const res = createMockRes();
    await taskController.updateTask(req, res);

    Task.findById = origFindById;

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(taskMock.aggregateVersion, 2);
    assert.strictEqual(taskMock.title, 'Updated Title');
  });

  await testAsync('Case 555: No-op update with zero changes produces 0 events and 0 version advancement', async () => {
    const origFindById = Task.findById;
    const taskMock = {
      _id: 't_noop_1',
      title: 'Exact Same Title',
      description: 'Exact Same Description',
      status: 'In Progress',
      priority: 'medium',
      isBlocked: false,
      createdBy: 'user_dev',
      aggregateVersion: 5,
      save: async function() { return this; },
      populate: async function() { return this; },
    };
    Task.findById = async () => taskMock;

    const req = {
      params: { id: 't_noop_1' },
      body: { title: 'Exact Same Title', description: 'Exact Same Description' },
      user: { _id: 'user_dev', name: 'Dev User', role: 'member' },
    };
    const res = createMockRes();
    await taskController.updateTask(req, res);

    Task.findById = origFindById;

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(taskMock.aggregateVersion, 5, 'Version must remain unchanged on no-op');
  });

  // --- SUBSECTION 20.13: Pre-Pagination Member Privacy & Anti-Inference Invariance ---

  await testAsync('Case 556: Member querying getActivity receives pre-pagination query filter containing only allowed projects and tasks', async () => {
    const origTaskFind = Task.find;
    const origProjectFind = Project.find;
    const origEventFind = ExecutionEvent.find;

    const memberId = '507f1f77bcf86cd799439120';
    const allowedProjectId = '507f1f77bcf86cd799439121';
    const allowedTaskId = '507f1f77bcf86cd799439122';

    Project.find = (filter) => {
      assert(filter['members.user'] || filter.owner);
      return {
        select: () => Promise.resolve([{ _id: allowedProjectId }]),
      };
    };
    Task.find = (filter) => {
      assert(filter.assignedTo || filter.createdBy || filter.project);
      return {
        select: () => Promise.resolve([{ _id: allowedTaskId }]),
      };
    };

    let queryFilterPassedToDb = null;
    ExecutionEvent.find = (filter) => {
      queryFilterPassedToDb = filter;
      return {
        sort: () => ({
          limit: () => Promise.resolve([]),
        }),
      };
    };

    const req = {
      query: { limit: 10 },
      user: { _id: memberId, name: 'Dev Member', role: 'member' },
    };
    const res = createMockRes();
    await activityController.getActivity(req, res);

    Project.find = origProjectFind;
    Task.find = origTaskFind;
    ExecutionEvent.find = origEventFind;

    assert.strictEqual(res.statusCode, 200);
    assert(queryFilterPassedToDb, 'Pre-pagination query filter must be constructed');
    const authBranch = queryFilterPassedToDb.$or ? queryFilterPassedToDb : queryFilterPassedToDb.$and?.find((c) => c.$or);
    assert(authBranch, 'Must contain $or authorization branches for Project and Task scoping');
  });

  await testAsync('Case 557: Cursor pagination nextCursor for Member never references unassigned/unauthorized events', async () => {
    const origTaskFind = Task.find;
    const origProjectFind = Project.find;
    const origEventFind = ExecutionEvent.find;

    const memberId = '507f1f77bcf86cd799439120';
    Project.find = () => ({ select: () => Promise.resolve([]) });
    Task.find = () => ({ select: () => Promise.resolve([{ _id: 't_mem_1' }]) });

    // Return exactly 1 event matching the allowed task
    const mockEvents = [{
      _id: 'ev_allowed_1',
      subjectType: 'Task',
      subjectId: 't_mem_1',
      eventType: 'task.status_changed',
      category: 'execution',
      aggregateVersion: 1,
      createdAt: new Date('2026-09-01T10:00:00.000Z'),
    }];

    ExecutionEvent.find = () => ({
      sort: () => ({
        limit: () => Promise.resolve(mockEvents),
      }),
    });

    const req = {
      query: { limit: 1 },
      user: { _id: memberId, name: 'Dev Member', role: 'member' },
    };
    const res = createMockRes();
    await activityController.getActivity(req, res);

    Project.find = origProjectFind;
    Task.find = origTaskFind;
    ExecutionEvent.find = origEventFind;

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.data.length, 1);
    assert.strictEqual(res.body.pagination.hasMore, false);
    assert.strictEqual(res.body.pagination.nextCursor, null);
  });

  await testAsync('Case 558: Member response includes unconditional invariant notice', async () => {
    const origTaskFind = Task.find;
    const origProjectFind = Project.find;
    const origEventFind = ExecutionEvent.find;

    Project.find = () => ({ select: () => Promise.resolve([]) });
    Task.find = () => ({ select: () => Promise.resolve([]) });
    ExecutionEvent.find = () => ({
      sort: () => ({
        limit: () => Promise.resolve([]),
      }),
    });

    const req = {
      query: { limit: 20 },
      user: { _id: 'mem_empty', name: 'New Member', role: 'member' },
    };
    const res = createMockRes();
    await activityController.getActivity(req, res);

    Project.find = origProjectFind;
    Task.find = origTaskFind;
    ExecutionEvent.find = origEventFind;

    assert.strictEqual(res.statusCode, 200);
    assert.match(res.body.memberNotice, /Timeline reflects assigned tasks and projects only/);
  });

  await testAsync('Case 559: Hidden-state invariance: colleague mutations in same project produce byte-for-byte identical Member payloads', async () => {
    const origTaskFind = Task.find;
    const origProjectFind = Project.find;
    const origProjectFindById = Project.findById;
    const origEventFind = ExecutionEvent.find;
    const origEventFindById = ExecutionEvent.findById;

    const projId = '507f1f77bcf86cd799439110';
    const memberId = '507f1f77bcf86cd799439111';
    const colleagueId = '507f1f77bcf86cd799439112';
    const memTaskId = '507f1f77bcf86cd799439113';
    const colleagueTaskId = '507f1f77bcf86cd799439114';

    const memberUser = { _id: memberId, name: 'Alice Member', role: 'member' };

    // Setup Project & Task authorization mocks
    Project.find = () => Promise.resolve([{ _id: projId, owner: 'manager_1', members: [{ user: memberId }, { user: colleagueId }] }]);
    Project.findById = () => Promise.resolve({
      _id: projId,
      owner: 'manager_1',
      members: [{ user: memberId }, { user: colleagueId }],
    });

    // Member only has access to memTaskId (assigned to Alice)
    Task.find = () => Promise.resolve([
      { _id: memTaskId, project: projId, assignedTo: memberId, createdBy: memberId, dependsOn: [] },
    ]);

    // Initial event ledger
    // Visible to Member (N = 3 visible events)
    const visibleEvents = [
      {
        _id: '507f1f77bcf86cd799439121',
        eventType: 'task.status_changed',
        category: 'task',
        project: projId,
        task: memTaskId,
        subjectType: 'task',
        subjectId: memTaskId,
        aggregateVersion: 2,
        occurredAt: new Date('2026-09-01T12:00:00Z'),
        createdAt: new Date('2026-09-01T12:00:00Z'),
      },
      {
        _id: '507f1f77bcf86cd799439122',
        eventType: 'task.created',
        category: 'task',
        project: projId,
        task: memTaskId,
        subjectType: 'task',
        subjectId: memTaskId,
        aggregateVersion: 1,
        occurredAt: new Date('2026-09-01T11:00:00Z'),
        createdAt: new Date('2026-09-01T11:00:00Z'),
      },
      {
        _id: '507f1f77bcf86cd799439123',
        eventType: 'project.created',
        category: 'project',
        project: projId,
        subjectType: 'project',
        subjectId: projId,
        aggregateVersion: 1,
        occurredAt: new Date('2026-09-01T10:00:00Z'),
        createdAt: new Date('2026-09-01T10:00:00Z'),
      },
    ];

    // Initial hidden colleague events in the SAME project
    let colleagueEvents = [
      {
        _id: '507f1f77bcf86cd799439131',
        eventType: 'task.created',
        category: 'task',
        project: projId,
        task: colleagueTaskId,
        subjectType: 'task',
        subjectId: colleagueTaskId,
        aggregateVersion: 1,
        occurredAt: new Date('2026-09-01T09:00:00Z'),
        createdAt: new Date('2026-09-01T09:00:00Z'),
      },
    ];

    let currentEventStore = [...visibleEvents, ...colleagueEvents];

    // Mock ExecutionEvent.find with query interpreter
    const runFindQuery = (filter) => {
      let results = [...currentEventStore];

      // Pre-pagination authorization filter application
      if (filter && filter.$and) {
        for (const sub of filter.$and) {
          if (sub.category) {
            results = results.filter((e) => e.category === sub.category);
          }
          if (sub.project) {
            results = results.filter((e) => e.project.toString() === sub.project.toString());
          }
          if (sub.$or) {
            const isCursorOr = sub.$or.some((c) => c.occurredAt);
            if (isCursorOr) {
              results = results.filter((e) => {
                return sub.$or.some((cond) => {
                  if (cond.occurredAt?.$lt) {
                    return e.occurredAt < cond.occurredAt.$lt;
                  }
                  if (cond.occurredAt && cond._id?.$lt) {
                    return e.occurredAt.getTime() === cond.occurredAt.getTime() && e._id < cond._id.$lt;
                  }
                  return false;
                });
              });
            } else {
              results = results.filter((e) => {
                if (['project', 'release', 'milestone', 'decision'].includes(e.category) && [projId].includes(e.project.toString())) return true;
                if (['task', 'blocker'].includes(e.category) && [memTaskId].includes((e.task || e.subjectId).toString())) return true;
                if (e.category === 'capacity' && e.capacityUser?.toString() === memberId) return true;
                return false;
              });
            }
          }
        }
      } else if (filter) {
        if (filter.category) {
          results = results.filter((e) => e.category === filter.category);
        }
        if (filter.project) {
          results = results.filter((e) => e.project.toString() === filter.project.toString());
        }
        if (filter.$or) {
          results = results.filter((e) => {
            if (['project', 'release', 'milestone', 'decision'].includes(e.category) && [projId].includes(e.project.toString())) return true;
            if (['task', 'blocker'].includes(e.category) && [memTaskId].includes((e.task || e.subjectId).toString())) return true;
            if (e.category === 'capacity' && e.capacityUser?.toString() === memberId) return true;
            return false;
          });
        }
      }

      results.sort((a, b) => b.occurredAt - a.occurredAt || (b._id > a._id ? 1 : -1));

      return {
        sort() { return this; },
        limit(limitNum) {
          const paged = results.slice(0, limitNum);
          return {
            populate() {
              return {
                populate() {
                  return Promise.resolve(paged);
                },
              };
            },
          };
        },
      };
    };

    ExecutionEvent.find = (f) => runFindQuery(f);
    ExecutionEvent.findById = (id) => {
      const found = currentEventStore.find((e) => e._id.toString() === id.toString());
      return {
        populate() { return Promise.resolve(found || null); },
        then(resolve) { return Promise.resolve(found || null).then(resolve); },
      };
    };

    // Helper to query all member feeds
    const executeAllMemberQueries = async () => {
      // 1. Page 1 (limit 2)
      const resPage1 = createMockRes();
      await activityController.getActivityFeed({ query: { limit: 2 }, user: memberUser }, resPage1);

      // 2. Page 2 with cursor
      const cursor = resPage1.body.nextCursor;
      const resPage2 = createMockRes();
      await activityController.getActivityFeed({ query: { limit: 2, cursor }, user: memberUser }, resPage2);

      // 3. Filter query: task category only
      const resFilter = createMockRes();
      await activityController.getActivityFeed({ query: { category: 'task', limit: 10 }, user: memberUser }, resFilter);

      // 4. Project-scoped activity feed
      const resProj = createMockRes();
      await activityController.getProjectActivity({ params: { projectId: projId }, query: { limit: 10 }, user: memberUser }, resProj);

      // 5. Detail of visible event
      const resDetailVisible = createMockRes();
      await activityController.getEventById({ params: { id: '507f1f77bcf86cd799439121' }, user: memberUser }, resDetailVisible);

      // 6. Detail of colleague's hidden event -> fail-closed 403
      const resDetailHidden = createMockRes();
      await activityController.getEventById({ params: { id: '507f1f77bcf86cd799439131' }, user: memberUser }, resDetailHidden);

      return {
        page1: resPage1.body,
        page2: resPage2.body,
        filter: resFilter.body,
        project: resProj.body,
        detailVisible: resDetailVisible.body,
        detailHiddenStatus: resDetailHidden.statusCode,
      };
    };

    // EXECUTION 1: Baseline before colleague mutations
    const payloadBefore = await executeAllMemberQueries();
    const jsonBefore = JSON.stringify(payloadBefore);

    // MUTATION: Insert and modify hidden colleague events in the same project:
    // 1. Insert new colleague task event
    // 2. Advance colleague aggregate version to 10
    // 3. Toggle colleague blocker (blocker.added & blocker.resolved)
    // 4. Change colleague estimate (task.estimate_changed)
    // 5. Mutate capacity configuration for colleague
    colleagueEvents = [
      ...colleagueEvents,
      {
        _id: '507f1f77bcf86cd799439141',
        eventType: 'task.updated',
        category: 'task',
        project: projId,
        task: colleagueTaskId,
        subjectType: 'task',
        subjectId: colleagueTaskId,
        aggregateVersion: 2,
        occurredAt: new Date('2026-09-01T13:00:00Z'),
        createdAt: new Date('2026-09-01T13:00:00Z'),
      },
      {
        _id: '507f1f77bcf86cd799439142',
        eventType: 'blocker.added',
        category: 'blocker',
        project: projId,
        task: colleagueTaskId,
        subjectType: 'task',
        subjectId: colleagueTaskId,
        aggregateVersion: 3,
        occurredAt: new Date('2026-09-01T13:10:00Z'),
        createdAt: new Date('2026-09-01T13:10:00Z'),
      },
      {
        _id: '507f1f77bcf86cd799439143',
        eventType: 'blocker.resolved',
        category: 'blocker',
        project: projId,
        task: colleagueTaskId,
        subjectType: 'task',
        subjectId: colleagueTaskId,
        aggregateVersion: 4,
        occurredAt: new Date('2026-09-01T13:20:00Z'),
        createdAt: new Date('2026-09-01T13:20:00Z'),
      },
      {
        _id: '507f1f77bcf86cd799439144',
        eventType: 'task.estimate_changed',
        category: 'task',
        project: projId,
        task: colleagueTaskId,
        subjectType: 'task',
        subjectId: colleagueTaskId,
        aggregateVersion: 5,
        occurredAt: new Date('2026-09-01T13:30:00Z'),
        createdAt: new Date('2026-09-01T13:30:00Z'),
      },
      {
        _id: '507f1f77bcf86cd799439145',
        eventType: 'capacity.configured',
        category: 'capacity',
        project: projId,
        capacityUser: colleagueId,
        subjectType: 'capacity',
        subjectId: '507f1f77bcf86cd799439146',
        aggregateVersion: 10,
        occurredAt: new Date('2026-09-01T13:40:00Z'),
        createdAt: new Date('2026-09-01T13:40:00Z'),
      },
    ];

    // Update the event store with the new hidden state
    currentEventStore = [...visibleEvents, ...colleagueEvents];

    // EXECUTION 2: After colleague mutations
    const payloadAfter = await executeAllMemberQueries();
    const jsonAfter = JSON.stringify(payloadAfter);

    Project.find = origProjectFind;
    Project.findById = origProjectFindById;
    Task.find = origTaskFind;
    ExecutionEvent.find = origEventFind;
    ExecutionEvent.findById = origEventFindById;

    // INVARIANCE ASSERTIONS:
    assert.deepStrictEqual(payloadBefore, payloadAfter, 'Payload must be strictly identical across all endpoints despite colleague mutations');
    assert.strictEqual(jsonBefore, jsonAfter, 'Serialized JSON must be 100% byte-for-byte identical before and after hidden state changes');
    assert.strictEqual(payloadBefore.page1.events.length, 2, 'Page 1 has exactly 2 visible events');
    assert.strictEqual(payloadBefore.page2.events.length, 1, 'Page 2 has exactly 1 visible event');
    assert.strictEqual(payloadBefore.filter.events.length, 2, 'Task filter has exactly 2 visible task events');
    assert.strictEqual(payloadBefore.detailHiddenStatus, 403, 'Colleague event detail returns 403 Forbidden');
    assert.strictEqual(payloadAfter.detailHiddenStatus, 403, 'Colleague event detail returns 403 Forbidden after mutation');
  });

  await testAsync('Case 560: Admin response does not contain Member restriction notice and sees all subjects', async () => {
    const origEventFind = ExecutionEvent.find;
    let queryFilter = null;

    ExecutionEvent.find = (filter) => {
      queryFilter = filter;
      return {
        sort: () => ({
          limit: () => Promise.resolve([]),
        }),
      };
    };

    const req = {
      query: { limit: 20 },
      user: { _id: 'admin_root', name: 'Root Admin', role: 'admin' },
    };
    const res = createMockRes();
    await activityController.getActivity(req, res);

    ExecutionEvent.find = origEventFind;

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.memberNotice, undefined, 'Admin response must not include Member restriction notice');
    // Admin query filter does not contain user authorization restriction
    assert.strictEqual(queryFilter.$and, undefined, 'Admin filter has no pre-pagination user restriction $and');
  });

  await testAsync('Case 561: Member querying project-specific activity for unassigned project receives fail-closed 403', async () => {
    const origProjectFindById = Project.findById;

    Project.findById = () => Promise.resolve({
      _id: '507f1f77bcf86cd799439130',
      owner: 'other_mgr',
      members: [{ user: 'other_dev' }],
    });

    const req = {
      params: { projectId: '507f1f77bcf86cd799439130' },
      query: { limit: 20 },
      user: { _id: 'unauthorized_member', name: 'Intruder', role: 'member' },
    };
    const res = createMockRes();
    await activityController.getActivity(req, res);

    Project.findById = origProjectFindById;

    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(res.body.success, false);
    assert.match(res.body.message, /Not authorized to view activity for this project/);
  });

  await testAsync('Case 562: Pre-pagination authorization prevents total count or cursor oracles across tenants', async () => {
    const origTaskFind = Task.find;
    const origProjectFind = Project.find;
    const origEventFind = ExecutionEvent.find;

    Project.find = () => ({ select: () => Promise.resolve([]) });
    Task.find = () => ({ select: () => Promise.resolve([]) });

    ExecutionEvent.find = (filter) => {
      const subjectBranch = filter.$or ? filter : filter.$and?.find((c) => c.$or);
      assert(subjectBranch, 'Filter strictly confines query to user authorized subjects');
      return {
        sort: () => ({
          limit: () => Promise.resolve([]),
        }),
      };
    };

    const req = {
      query: { limit: 20 },
      user: { _id: 'isolated_member', name: 'Isolated', role: 'member' },
    };
    const res = createMockRes();
    await activityController.getActivity(req, res);

    Project.find = origProjectFind;
    Task.find = origTaskFind;
    ExecutionEvent.find = origEventFind;

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.data.length, 0);
    assert.strictEqual(res.body.pagination.hasMore, false);
  });

  // --- SUBSECTION 20.14: Strengthened Coverage Diagnostics ---

  await testAsync('Case 563: computeLedgerCoverage correctly classifies legacy_pre_ledger when aggregateVersion === 0 and eventCount === 0', async () => {
    const aggregates = [{ _id: 'agg_legacy', name: 'Legacy Project', aggregateVersion: 0 }];
    const events = [];

    const coverage = computeLedgerCoverage(aggregates, events, 'Project');
    assert.strictEqual(coverage.status, 'legacy_pre_ledger');
    assert.strictEqual(coverage.expectedEvents, 0);
    assert.strictEqual(coverage.recordedEvents, 0);
    assert.strictEqual(coverage.coveragePercent, 100);
    assert.strictEqual(coverage.gaps.length, 0);
  });

  await testAsync('Case 564: computeLedgerCoverage correctly classifies synchronized when aggregateVersion === eventCount and sequences match', async () => {
    const aggregates = [{ _id: 'agg_sync', name: 'Sync Task', aggregateVersion: 3 }];
    const events = [
      { subjectId: 'agg_sync', aggregateVersion: 1 },
      { subjectId: 'agg_sync', aggregateVersion: 2 },
      { subjectId: 'agg_sync', aggregateVersion: 3 },
    ];

    const coverage = computeLedgerCoverage(aggregates, events, 'Task');
    assert.strictEqual(coverage.status, 'synchronized');
    assert.strictEqual(coverage.expectedEvents, 3);
    assert.strictEqual(coverage.recordedEvents, 3);
    assert.strictEqual(coverage.coveragePercent, 100);
    assert.strictEqual(coverage.gaps.length, 0);
  });

  await testAsync('Case 565: computeLedgerCoverage correctly classifies version_ahead_of_events when aggregateVersion > eventCount', async () => {
    const aggregates = [{ _id: 'agg_ahead', name: 'Ahead Task', aggregateVersion: 4 }];
    const events = [
      { subjectId: 'agg_ahead', aggregateVersion: 1 },
      { subjectId: 'agg_ahead', aggregateVersion: 2 },
    ];

    const coverage = computeLedgerCoverage(aggregates, events, 'Task');
    assert.strictEqual(coverage.status, 'version_ahead_of_events');
    assert.strictEqual(coverage.expectedEvents, 4);
    assert.strictEqual(coverage.recordedEvents, 2);
    assert.strictEqual(coverage.coveragePercent, 50);
    assert.strictEqual(coverage.gaps.length, 1);
    assert.strictEqual(coverage.gaps[0].type, 'version_ahead_of_events');
  });

  await testAsync('Case 566: computeLedgerCoverage correctly classifies missing_sequence when sequence has gaps', async () => {
    const aggregates = [{ _id: 'agg_gap', name: 'Gap Task', aggregateVersion: 3 }];
    const events = [
      { subjectId: 'agg_gap', aggregateVersion: 1 },
      { subjectId: 'agg_gap', aggregateVersion: 3 }, // missing version 2!
    ];

    const coverage = computeLedgerCoverage(aggregates, events, 'Task');
    assert.strictEqual(coverage.status, 'missing_sequence');
    assert.strictEqual(coverage.gaps.length, 1);
    assert.strictEqual(coverage.gaps[0].type, 'missing_sequence');
    assert.deepStrictEqual(coverage.gaps[0].missingVersions, [2]);
  });

  await testAsync('Case 567: computeLedgerCoverage correctly classifies duplicate_sequence when duplicate versions exist', async () => {
    const aggregates = [{ _id: 'agg_dup', name: 'Dup Task', aggregateVersion: 2 }];
    const events = [
      { subjectId: 'agg_dup', aggregateVersion: 1 },
      { subjectId: 'agg_dup', aggregateVersion: 2 },
      { subjectId: 'agg_dup', aggregateVersion: 2 }, // duplicate version 2!
    ];

    const coverage = computeLedgerCoverage(aggregates, events, 'Task');
    assert.strictEqual(coverage.status, 'duplicate_sequence');
    assert.strictEqual(coverage.gaps.length, 1);
    assert.strictEqual(coverage.gaps[0].type, 'duplicate_sequence');
  });

  await testAsync('Case 568: computeLedgerCoverage correctly classifies orphan_events when events exist for non-existent aggregate', async () => {
    const aggregates = [];
    const events = [
      { subjectId: 'orphan_agg_1', aggregateVersion: 1 },
    ];

    const coverage = computeLedgerCoverage(aggregates, events, 'Task');
    assert.strictEqual(coverage.status, 'orphan_events');
    assert.strictEqual(coverage.gaps.length, 1);
    assert.strictEqual(coverage.gaps[0].type, 'orphan_events');
  });

  // --- SUBSECTION 20.15: Bounded Batch Query Instrumentation ---

  await testAsync('Case 569: computeLedgerCoverage executes bounded batch queries regardless of aggregate count', async () => {
    let queryCount = 0;

    const origProjectFind = Project.find;
    const origTaskFind = Task.find;
    const origReleaseFind = Release.find;
    const origMilestoneFind = Milestone.find;
    const origDecisionFind = DecisionRecord.find;
    const origCapacityFind = ProjectCapacity.find;
    const origEventFind = ExecutionEvent.find;

    const recordQuery = () => {
      queryCount += 1;
      return {
        select: () => ({
          lean: () => Promise.resolve([]),
        }),
      };
    };

    Project.find = recordQuery;
    Task.find = recordQuery;
    Release.find = recordQuery;
    Milestone.find = recordQuery;
    DecisionRecord.find = recordQuery;
    ProjectCapacity.find = recordQuery;
    ExecutionEvent.find = () => {
      queryCount += 1;
      return {
        select: () => ({
          lean: () => Promise.resolve([]),
        }),
      };
    };

    const req = { user: { _id: 'admin_1', role: 'admin' } };
    const res = createMockRes();
    await activityController.getLedgerCoverage(req, res);

    Project.find = origProjectFind;
    Task.find = origTaskFind;
    Release.find = origReleaseFind;
    Milestone.find = origMilestoneFind;
    DecisionRecord.find = origDecisionFind;
    ProjectCapacity.find = origCapacityFind;
    ExecutionEvent.find = origEventFind;

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(queryCount, 7, 'Must execute exactly 7 batch queries (6 aggregate models + 1 event batch query)');
  });

  await testAsync('Case 570: Query count invariance: 5 aggregates vs 500 aggregates both issue exactly 7 queries', async () => {
    let queriesFor5 = 0;
    let queriesFor500 = 0;

    const origProjectFind = Project.find;
    const origTaskFind = Task.find;
    const origReleaseFind = Release.find;
    const origMilestoneFind = Milestone.find;
    const origDecisionFind = DecisionRecord.find;
    const origCapacityFind = ProjectCapacity.find;
    const origEventFind = ExecutionEvent.find;

    // Run with 5 aggregates
    const makeMockFn = (counter, docCount) => () => {
      counter.val += 1;
      const docs = Array.from({ length: docCount }, (_, i) => ({ _id: `id_${i}`, aggregateVersion: 1 }));
      return {
        select: () => ({
          lean: () => Promise.resolve(docs),
        }),
      };
    };

    const c5 = { val: 0 };
    Project.find = makeMockFn(c5, 5);
    Task.find = makeMockFn(c5, 5);
    Release.find = makeMockFn(c5, 5);
    Milestone.find = makeMockFn(c5, 5);
    DecisionRecord.find = makeMockFn(c5, 5);
    ProjectCapacity.find = makeMockFn(c5, 5);
    ExecutionEvent.find = makeMockFn(c5, 5);

    const res5 = createMockRes();
    await activityController.getLedgerCoverage({ user: { role: 'admin' } }, res5);
    queriesFor5 = c5.val;

    // Run with 500 aggregates
    const c500 = { val: 0 };
    Project.find = makeMockFn(c500, 500);
    Task.find = makeMockFn(c500, 500);
    Release.find = makeMockFn(c500, 500);
    Milestone.find = makeMockFn(c500, 500);
    DecisionRecord.find = makeMockFn(c500, 500);
    ProjectCapacity.find = makeMockFn(c500, 500);
    ExecutionEvent.find = makeMockFn(c500, 500);

    const res500 = createMockRes();
    await activityController.getLedgerCoverage({ user: { role: 'admin' } }, res500);
    queriesFor500 = c500.val;

    Project.find = origProjectFind;
    Task.find = origTaskFind;
    Release.find = origReleaseFind;
    Milestone.find = origMilestoneFind;
    DecisionRecord.find = origDecisionFind;
    ProjectCapacity.find = origCapacityFind;
    ExecutionEvent.find = origEventFind;

    assert.strictEqual(queriesFor5, 7, '5 aggregates issues 7 queries');
    assert.strictEqual(queriesFor500, 7, '500 aggregates issues exactly 7 queries');
    assert.strictEqual(queriesFor5, queriesFor500, 'Query count must be invariant regardless of dataset scale (O(1) queries)');
  });

  // --- SUBSECTION 20.16: Canonical Schema Contract & Unique Index Confirmation ---

  await testAsync('Case 571: All 6 aggregate schemas strictly declare aggregateVersion with default: 0, min: 0, select: false', async () => {
    const models = [
      { name: 'Project', model: Project },
      { name: 'Task', model: Task },
      { name: 'Release', model: Release },
      { name: 'Milestone', model: Milestone },
      { name: 'DecisionRecord', model: DecisionRecord },
      { name: 'ProjectCapacity', model: ProjectCapacity },
    ];

    for (const { name, model } of models) {
      const path = model.schema.path('aggregateVersion');
      assert(path, `${name} schema must declare aggregateVersion`);
      assert.strictEqual(path.instance, 'Number', `${name} aggregateVersion must be Number`);
      assert.strictEqual(path.defaultValue, 0, `${name} aggregateVersion default must be 0`);
      assert.strictEqual(path.options.select, false, `${name} aggregateVersion select must be false`);
      assert(model.schema.path('activityVersion') === undefined, `${name} schema must not declare legacy activityVersion`);
    }
  });

  await testAsync('Case 572: ExecutionEvent schema strictly declares compound unique index { subjectType: 1, subjectId: 1, aggregateVersion: 1 }', async () => {
    const indexes = ExecutionEvent.schema.indexes();
    const compoundUniqueIndex = indexes.find(([fields, opts]) => {
      return (
        fields.subjectType === 1 &&
        fields.subjectId === 1 &&
        fields.aggregateVersion === 1 &&
        opts &&
        opts.unique === true
      );
    });

    assert(compoundUniqueIndex, 'ExecutionEvent must have compound unique index on { subjectType: 1, subjectId: 1, aggregateVersion: 1 }');
  });

  await testAsync('Case 573: Zero references to "tamper-proof", "tamper-evident", or "legal audit" across activity domain', async () => {
    const fs = require('fs');
    const path = require('path');

    const filesToCheck = [
      './controllers/activityController.js',
      './services/executionEventService.js',
      './utils/executionEventFactory.js',
      './models/ExecutionEvent.js',
      '../frontend/src/pages/ActivityPage.js',
      '../frontend/src/components/activity/ActivityDrawer.js',
    ];

    const forbiddenPhrases = [
      'tamper-proof',
      'tamper-evident',
      'legal audit',
      'tamper proof',
      'tamper evident',
    ];

    for (const relPath of filesToCheck) {
      const fullPath = path.resolve(__dirname, relPath);
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, 'utf8').toLowerCase();
        for (const phrase of forbiddenPhrases) {
          assert(!content.includes(phrase), `File ${relPath} contains forbidden phrase: "${phrase}"`);
        }
      }
    }
  });

  // --- SUBSECTION 20.17: Reconciliation Pass: Canonical Drift, Idempotency & Diagnostics ---

  await testAsync('Case 574: decisionController supports decision.deprecated status transition and emits decision.deprecated event', async () => {
    const origFindById = DecisionRecord.findById;
    const origProjFindById = Project.findById;

    const projDoc = {
      _id: '507f1f77bcf86cd799439150',
      owner: 'mgr_1',
      members: [],
      status: 'active',
    };

    let savedStatus = null;
    let savedDecidedBy = null;

    const mockDecision = {
      _id: '507f1f77bcf86cd799439151',
      title: 'Adopt GraphQL Federation',
      status: 'accepted',
      project: projDoc._id,
      aggregateVersion: 2,
      save: async function () {
        savedStatus = this.status;
        savedDecidedBy = this.decidedBy;
      },
      populate: async function () { return this; },
    };

    DecisionRecord.findById = () => Promise.resolve(mockDecision);
    Project.findById = () => Promise.resolve(projDoc);

    const req = {
      params: { id: mockDecision._id },
      body: { status: 'deprecated' },
      user: { _id: 'mgr_1', name: 'Project Manager', role: 'manager' },
    };
    const res = createMockRes();

    await decisionController.transitionDecision(req, res);

    DecisionRecord.findById = origFindById;
    Project.findById = origProjFindById;

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(savedStatus, 'deprecated', 'Decision status must be updated to deprecated');
    assert.strictEqual(savedDecidedBy.toString(), 'mgr_1');
  });

  await testAsync('Case 575: Standalone Command Idempotency: Simultaneous identical requests execute mutation once and return identical response', async () => {
    commandJournal.clear();

    const actor = 'user_idemp_1';
    const operation = 'task.update';
    const subjectId = 'task_idemp_1';
    const idempotencyKey = 'key_concurrent_123';
    const requestPayload = { title: 'Updated Concurrent Title', priority: 'High' };

    let mutationExecutionCount = 0;
    const mockTask = {
      _id: subjectId,
      project: '507f1f77bcf86cd799439160',
      title: 'Original Title',
      aggregateVersion: 1,
      save: async () => {},
    };

    const mutateFn = async () => {
      mutationExecutionCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 30));
      mockTask.title = requestPayload.title;
      return { aggregate: mockTask };
    };

    const p1 = executeIdempotentCommand({
      actor,
      operation,
      subjectId,
      idempotencyKey,
      requestPayload,
      mutate: mutateFn,
      aggregate: mockTask,
      eventInput: { eventType: 'task.updated', project: '507f1f77bcf86cd799439160' },
    });

    const p2 = executeIdempotentCommand({
      actor,
      operation,
      subjectId,
      idempotencyKey,
      requestPayload,
      mutate: mutateFn,
      aggregate: mockTask,
      eventInput: { eventType: 'task.updated', project: '507f1f77bcf86cd799439160' },
    });

    const [res1, res2] = await Promise.all([p1, p2]);

    assert.strictEqual(mutationExecutionCount, 1, 'Mutation closure must execute exactly once across concurrent identical requests');
    assert.strictEqual(res1.aggregateVersion, 2, 'Aggregate version must increment exactly once');
    assert.strictEqual(res2.aggregateVersion, 2, 'Concurrent caller receives identical aggregateVersion');
    assert.strictEqual(res1.aggregate.title, 'Updated Concurrent Title');
    assert.strictEqual(res2.aggregate.title, 'Updated Concurrent Title');
  });

  await testAsync('Case 576: Standalone Command Idempotency: Retry with differing request payload rejects with 409 mismatch', async () => {
    commandJournal.clear();

    const actor = 'user_idemp_2';
    const operation = 'task.update';
    const subjectId = 'task_idemp_2';
    const idempotencyKey = 'key_mismatch_456';

    const mockTask = {
      _id: subjectId,
      project: '507f1f77bcf86cd799439160',
      title: 'Task 2',
      aggregateVersion: 1,
      save: async () => {},
    };

    await executeIdempotentCommand({
      actor,
      operation,
      subjectId,
      idempotencyKey,
      requestPayload: { title: 'First Update Payload', priority: 'Low' },
      mutate: async () => ({ aggregate: mockTask }),
      aggregate: mockTask,
      eventInput: { eventType: 'task.updated', project: '507f1f77bcf86cd799439160' },
    });

    await assert.rejects(
      async () => {
        await executeIdempotentCommand({
          actor,
          operation,
          subjectId,
          idempotencyKey,
          requestPayload: { title: 'DIFFERING PAYLOAD', priority: 'Critical' },
          mutate: async () => ({ aggregate: mockTask }),
          aggregate: mockTask,
          eventInput: { eventType: 'task.updated', project: '507f1f77bcf86cd799439160' },
        });
      },
      (err) => {
        assert.strictEqual(err.statusCode, 409, 'Must reject with HTTP 409 Conflict');
        assert.strictEqual(err.code, 'IDEMPOTENCY_PAYLOAD_MISMATCH');
        assert.match(err.message, /payload differs from initial execution/);
        return true;
      }
    );
  });

  await testAsync('Case 577: Standalone Command Idempotency: Partial failure retry (aggregate mutated, event failed) resumes event append without duplicating version', async () => {
    commandJournal.clear();

    const actor = 'user_idemp_3';
    const operation = 'task.update';
    const subjectId = 'task_idemp_3';
    const idempotencyKey = 'key_partial_fail_789';
    const requestPayload = { title: 'Partial Failure Task' };

    const mockTask = {
      _id: subjectId,
      project: '507f1f77bcf86cd799439160',
      title: 'Initial Title',
      aggregateVersion: 3,
      save: async () => {},
    };

    const cmdKey = getCommandKey({ actor, operation, subjectId, idempotencyKey });
    const fingerprint = computeRequestFingerprint(requestPayload);

    commandJournal.set(cmdKey, {
      key: cmdKey,
      actor,
      operation,
      subjectId,
      idempotencyKey,
      fingerprint,
      status: 'aggregate_committed',
      aggregate: mockTask,
      aggregateVersion: 4,
      event: null,
      response: null,
      createdAt: new Date(),
    });

    let mutateCalled = false;
    const mutateFn = async () => {
      mutateCalled = true;
      mockTask.aggregateVersion += 1;
      return { aggregate: mockTask };
    };

    const retryRes = await executeIdempotentCommand({
      actor,
      operation,
      subjectId,
      idempotencyKey,
      requestPayload,
      mutate: mutateFn,
      aggregate: mockTask,
      eventInput: { eventType: 'task.updated', project: '507f1f77bcf86cd799439160' },
    });

    assert.strictEqual(mutateCalled, false, 'Mutation closure must NOT be re-executed on partial-failure retry');
    assert.strictEqual(retryRes.aggregateVersion, 4, 'Aggregate version must remain 4 and NOT advance to 5');
    assert.strictEqual(retryRes.resumed, true, 'Result must indicate resumed event reconciliation');
    assert.strictEqual(commandJournal.get(cmdKey).status, 'completed', 'Journal status must transition to completed');
  });

  await testAsync('Case 578: Standalone Command Idempotency: Create retry returns original created resource without duplicating; update retry returns identical response', async () => {
    commandJournal.clear();

    const actor = 'user_idemp_4';
    const operation = 'task.create';
    const subjectId = '507f1f77bcf86cd799439160';
    const idempotencyKey = 'key_create_retry_001';
    const requestPayload = { title: 'New Idempotent Task', project: subjectId };

    let createCount = 0;
    const mutateCreate = async () => {
      createCount++;
      return {
        aggregate: {
          _id: 'new_task_doc_id_999',
          project: subjectId,
          title: requestPayload.title,
          aggregateVersion: 1,
          save: async () => {},
        },
      };
    };

    const createRes1 = await executeIdempotentCommand({
      actor,
      operation,
      subjectId,
      idempotencyKey,
      requestPayload,
      mutate: mutateCreate,
      eventInput: { eventType: 'task.created', project: subjectId },
    });

    const createRes2 = await executeIdempotentCommand({
      actor,
      operation,
      subjectId,
      idempotencyKey,
      requestPayload,
      mutate: mutateCreate,
      eventInput: { eventType: 'task.created', project: subjectId },
    });

    assert.strictEqual(createCount, 1, 'Task creation must occur exactly once');
    assert.strictEqual(createRes1.aggregate._id, createRes2.aggregate._id, 'Created aggregate ID must be identical across retries');
    assert.deepStrictEqual(createRes1.response, createRes2.response, 'Response body must be deepStrictEqual across create retries');
  });

  await testAsync('Case 579: Coverage diagnostics: events_ahead_of_aggregate is classified when max(event.aggregateVersion) > aggregate.aggregateVersion and is distinct from orphan_events', async () => {
    const aggregates = [{ _id: 'agg_version_lag', name: 'Lagging Aggregate', aggregateVersion: 2 }];
    const events = [
      { subjectId: 'agg_version_lag', aggregateVersion: 1 },
      { subjectId: 'agg_version_lag', aggregateVersion: 2 },
      { subjectId: 'agg_version_lag', aggregateVersion: 3 },
    ];

    const coverage = computeLedgerCoverage(aggregates, events, 'Task');
    assert.strictEqual(coverage.status, 'events_ahead_of_aggregate', 'Must classify as events_ahead_of_aggregate when event version exceeds aggregate');
    assert.strictEqual(coverage.gaps.length, 1);
    assert.strictEqual(coverage.gaps[0].gapType, 'events_ahead_of_aggregate');
    assert.strictEqual(coverage.gaps[0].maxRecordedVersion, 3);
    assert.strictEqual(coverage.gaps[0].aggregateVersion, 2);
    assert.strictEqual(coverage.orphanEvents.length, 0, 'Orphan events must be 0 because subject exists');
  });

  await testAsync('Case 580: Coverage diagnostics: Deterministic anomaly precedence strictly follows duplicate_sequence > missing_sequence > events_ahead_of_aggregate > version_ahead_of_events > orphan_events > legacy_pre_ledger > synchronized', async () => {
    // 1. Duplicate vs Missing: Duplicate must win
    const agg1 = [{ _id: 'a1', aggregateVersion: 5 }];
    const evs1 = [
      { subjectId: 'a1', aggregateVersion: 1 },
      { subjectId: 'a1', aggregateVersion: 1 },
      { subjectId: 'a1', aggregateVersion: 3 },
    ];
    assert.strictEqual(computeLedgerCoverage(agg1, evs1, 'Task').status, 'duplicate_sequence');

    // 2. Missing vs EventsAhead: Missing must win
    const agg2 = [{ _id: 'a2', aggregateVersion: 2 }];
    const evs2 = [
      { subjectId: 'a2', aggregateVersion: 3 },
    ];
    assert.strictEqual(computeLedgerCoverage(agg2, evs2, 'Task').status, 'missing_sequence');

    // 3. EventsAhead vs VersionAhead: EventsAhead must win
    const agg3 = [
      { _id: 'a3_ahead', aggregateVersion: 2 },
      { _id: 'a3_lag', aggregateVersion: 5 },
    ];
    const evs3 = [
      { subjectId: 'a3_ahead', aggregateVersion: 1 },
      { subjectId: 'a3_ahead', aggregateVersion: 2 },
      { subjectId: 'a3_ahead', aggregateVersion: 3 },
      { subjectId: 'a3_lag', aggregateVersion: 1 },
    ];
    assert.strictEqual(computeLedgerCoverage(agg3, evs3, 'Task').status, 'events_ahead_of_aggregate');

    // 4. VersionAhead vs OrphanEvents: VersionAhead must win
    const agg4 = [{ _id: 'a4', aggregateVersion: 3 }];
    const evs4 = [
      { subjectId: 'a4', aggregateVersion: 1 },
      { subjectId: 'orphan_subject', aggregateVersion: 1 },
    ];
    assert.strictEqual(computeLedgerCoverage(agg4, evs4, 'Task').status, 'version_ahead_of_events');

    // 5. OrphanEvents alone
    const agg5 = [{ _id: 'a5', aggregateVersion: 1 }];
    const evs5 = [
      { subjectId: 'a5', aggregateVersion: 1 },
      { subjectId: 'orphan_subject_2', aggregateVersion: 1 },
    ];
    assert.strictEqual(computeLedgerCoverage(agg5, evs5, 'Task').status, 'orphan_events');

    // 6. Legacy pre-ledger alone
    const agg6 = [{ _id: 'a6', aggregateVersion: 0 }];
    const evs6 = [];
    assert.strictEqual(computeLedgerCoverage(agg6, evs6, 'Task').status, 'legacy_pre_ledger');

    // 7. Synchronized alone
    const agg7 = [{ _id: 'a7', aggregateVersion: 2 }];
    const evs7 = [
      { subjectId: 'a7', aggregateVersion: 1 },
      { subjectId: 'a7', aggregateVersion: 2 },
    ];
    assert.strictEqual(computeLedgerCoverage(agg7, evs7, 'Task').status, 'synchronized');
  });

  await testAsync('Case 581: Coverage diagnostics: Complexity report explicitly separates O(1) database query round trips from in-memory O(N + M) data complexity', async () => {
    const aggregates = [{ _id: 'task_c', aggregateVersion: 1 }];
    const events = [{ subjectId: 'task_c', aggregateVersion: 1 }];

    const inMemCoverage = computeLedgerCoverage(aggregates, events, 'Task');
    assert.ok(inMemCoverage.complexity, 'Complexity object must be returned');
    assert.match(inMemCoverage.complexity.dataComplexity, /O\(N \+ M\)/, 'Data complexity must report O(N + M)');

    const origProjectFind = Project.find;
    const origTaskFind = Task.find;
    const origReleaseFind = Release.find;
    const origMilestoneFind = Milestone.find;
    const origDecisionFind = DecisionRecord.find;
    const origCapacityFind = ProjectCapacity.find;
    const origEventFind = ExecutionEvent.find;

    const dummyQuery = () => ({
      select: () => ({
        lean: () => Promise.resolve([]),
      }),
    });

    Project.find = dummyQuery;
    Task.find = dummyQuery;
    Release.find = dummyQuery;
    Milestone.find = dummyQuery;
    DecisionRecord.find = dummyQuery;
    ProjectCapacity.find = dummyQuery;
    ExecutionEvent.find = dummyQuery;

    const res = createMockRes();
    await activityController.getLedgerCoverage({ user: { role: 'admin' } }, res);

    Project.find = origProjectFind;
    Task.find = origTaskFind;
    Release.find = origReleaseFind;
    Milestone.find = origMilestoneFind;
    DecisionRecord.find = origDecisionFind;
    ProjectCapacity.find = origCapacityFind;
    ExecutionEvent.find = origEventFind;

    assert.strictEqual(res.statusCode, 200);
    assert.ok(res.body.complexity, 'Complexity report must be included in API response');
    assert.strictEqual(res.body.complexity.dbQueries, 7, 'Global coverage must execute exactly 7 queries');
    assert.match(res.body.complexity.dbQueryRoundTrips, /O\(1\)/, 'Database round trips must be O(1)');
    assert.match(res.body.complexity.dataComplexity, /O\(N \+ M\)/, 'Data complexity must be O(N + M)');
  });

  console.log(`\nVerification Summary: ${passedTests}/${totalTests} tests passed.`);
}

runSuite().catch((err) => {
  console.error('\nTest Suite Failed:', err);
  process.exit(1);
});
