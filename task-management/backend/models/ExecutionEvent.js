const mongoose = require('mongoose');

const CANONICAL_EVENT_TYPES = [
  // Project
  'project.created',
  'project.updated',
  'project.status_changed',
  'project.member_added',
  'project.member_removed',
  // Reserved for controlled retention/migration tooling; no public hard-delete route.
  'project.deleted',

  // Task
  'task.created',
  'task.updated',
  'task.status_changed',
  'task.assigned',
  'task.unassigned',
  'task.priority_changed',
  'task.estimate_changed',
  'task.milestone_linked',
  'task.milestone_unlinked',
  'task.verification_linked',
  'task.verification_updated',
  'task.deleted',

  // Dependency
  'dependency.added',
  'dependency.removed',

  // Blocker
  'blocker.added',
  'blocker.activated',
  'blocker.updated',
  'blocker.resolved',
  'blocker.eta_changed',

  // Release
  'release.created',
  'release.updated',
  'release.status_changed',
  'release.cancelled',
  // Reserved for controlled retention/migration tooling; public DELETE cancels.
  'release.deleted',

  // Milestone
  'milestone.created',
  'milestone.updated',
  'milestone.status_changed',
  'milestone.cancelled',

  // Decision
  'decision.created',
  'decision.proposed',
  'decision.updated',
  'decision.status_changed',
  'decision.accepted',
  'decision.rejected',
  'decision.withdrawn',
  'decision.deprecated',
  'decision.superseded',

  // Capacity
  'capacity.configured',
  'capacity.updated',
  'capacity.removed',
];

const CANONICAL_CATEGORIES = [
  'project',
  'task',
  'dependency',
  'blocker',
  'release',
  'milestone',
  'decision',
  'capacity',
];

const CANONICAL_SUBJECT_TYPES = [
  'project',
  'task',
  'release',
  'milestone',
  'decision',
  'capacity',
];

const changeEntrySchema = new mongoose.Schema(
  {
    field: { type: String, required: true, trim: true },
    from: { type: mongoose.Schema.Types.Mixed, default: null },
    to: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { _id: false }
);

const executionEventSchema = new mongoose.Schema(
  {
    schemaVersion: {
      type: Number,
      default: 1,
      immutable: true,
    },
    eventType: {
      type: String,
      required: [true, 'Event type is required'],
      enum: CANONICAL_EVENT_TYPES,
      immutable: true,
    },
    category: {
      type: String,
      required: [true, 'Category is required'],
      enum: CANONICAL_CATEGORIES,
      immutable: true,
    },
    project: {
      type: mongoose.Schema.Types.Mixed,
      ref: 'Project',
      required: [true, 'Project reference is required'],
      immutable: true,
    },
    actor: {
      type: mongoose.Schema.Types.Mixed,
      ref: 'User',
      required: [true, 'Actor reference is required'],
      immutable: true,
    },
    actorSnapshot: {
      name: { type: String, trim: true, default: '' },
      role: { type: String, trim: true, default: '' },
    },
    subjectType: {
      type: String,
      required: [true, 'Subject type is required'],
      enum: CANONICAL_SUBJECT_TYPES,
      immutable: true,
    },
    subjectId: {
      type: mongoose.Schema.Types.Mixed,
      required: [true, 'Subject ID is required'],
      immutable: true,
    },
    subjectTitleSnapshot: {
      type: String,
      maxlength: [160, 'Subject title snapshot cannot exceed 160 characters'],
      trim: true,
      default: '',
      immutable: true,
    },
    task: {
      type: mongoose.Schema.Types.Mixed,
      ref: 'Task',
      default: null,
      immutable: true,
    },
    release: {
      type: mongoose.Schema.Types.Mixed,
      ref: 'Release',
      default: null,
      immutable: true,
    },
    milestone: {
      type: mongoose.Schema.Types.Mixed,
      ref: 'Milestone',
      default: null,
      immutable: true,
    },
    decision: {
      type: mongoose.Schema.Types.Mixed,
      ref: 'DecisionRecord',
      default: null,
      immutable: true,
    },
    capacityUser: {
      type: mongoose.Schema.Types.Mixed,
      ref: 'User',
      default: null,
      immutable: true,
    },
    aggregateVersion: {
      type: Number,
      min: 1,
      required: [true, 'Aggregate version is required and must be >= 1'],
      immutable: true,
    },
    correlationId: {
      type: String,
      required: [true, 'Correlation ID is required'],
      trim: true,
      immutable: true,
    },
    summaryCode: {
      type: String,
      required: [true, 'Summary code is required'],
      trim: true,
      immutable: true,
    },
    changes: {
      type: [changeEntrySchema],
      default: [],
      immutable: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
      immutable: true,
    },
    occurredAt: {
      type: Date,
      required: [true, 'Occurrence date is required'],
      immutable: true,
    },
  },
  {
    timestamps: false,
    versionKey: false,
  }
);

// Canonical performance and uniqueness indexes
executionEventSchema.index({ project: 1, occurredAt: -1, _id: -1 });
executionEventSchema.index({ subjectType: 1, subjectId: 1, aggregateVersion: 1 }, { unique: true });
executionEventSchema.index({ actor: 1, occurredAt: -1 });
executionEventSchema.index({ eventType: 1, occurredAt: -1 });
executionEventSchema.index({ task: 1, occurredAt: -1 });
executionEventSchema.index({ release: 1, occurredAt: -1 });
executionEventSchema.index({ milestone: 1, occurredAt: -1 });
executionEventSchema.index({ decision: 1, occurredAt: -1 });
// A correlation may legitimately span more than one aggregate event. Event
// sequence uniqueness is enforced by the aggregate version compound index.
executionEventSchema.index({ correlationId: 1 });

// Application-level immutability enforcement hooks
executionEventSchema.pre('save', function (next) {
  if (!this.isNew) {
    return next(new Error('ExecutionEvent documents are immutable and cannot be updated.'));
  }
  next();
});

const rejectMutation = function (next) {
  next(new Error('ExecutionEvent documents are immutable; updates and deletions are rejected.'));
};

executionEventSchema.pre('updateOne', rejectMutation);
executionEventSchema.pre('updateMany', rejectMutation);
executionEventSchema.pre('findOneAndUpdate', rejectMutation);
executionEventSchema.pre('deleteOne', rejectMutation);
executionEventSchema.pre('deleteMany', rejectMutation);
executionEventSchema.pre('findOneAndDelete', rejectMutation);

module.exports = {
  ExecutionEvent: mongoose.model('ExecutionEvent', executionEventSchema),
  CANONICAL_EVENT_TYPES,
  CANONICAL_CATEGORIES,
  EVENT_CATEGORIES: CANONICAL_CATEGORIES,
  CANONICAL_SUBJECT_TYPES,
};
