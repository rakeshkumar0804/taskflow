const mongoose = require('mongoose');

const alternativeSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Alternative title is required'],
      trim: true,
      maxlength: [120, 'Alternative title cannot exceed 120 characters'],
    },
    reasonRejected: {
      type: String,
      required: [true, 'Rejection reason is required'],
      trim: true,
      maxlength: [600, 'Rejection reason cannot exceed 600 characters'],
    },
  },
  { _id: false }
);

const decisionRecordSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Decision title is required'],
      trim: true,
      maxlength: [120, 'Title cannot exceed 120 characters'],
    },
    context: {
      type: String,
      required: [true, 'Context is required'],
      trim: true,
      maxlength: [3000, 'Context cannot exceed 3000 characters'],
    },
    decision: {
      type: String,
      required: [true, 'Decision statement is required'],
      trim: true,
      maxlength: [3000, 'Decision statement cannot exceed 3000 characters'],
    },
    rationale: {
      type: String,
      required: [true, 'Rationale is required'],
      trim: true,
      maxlength: [3000, 'Rationale cannot exceed 3000 characters'],
    },

    alternatives: {
      type: [alternativeSchema],
      default: [],
      validate: [
        {
          validator: (val) => Array.isArray(val) && val.length <= 10,
          message: 'Maximum 10 alternatives allowed',
        },
      ],
    },

    consequences: {
      positive: {
        type: [
          {
            type: String,
            trim: true,
            maxlength: [600, 'Positive consequence cannot exceed 600 characters'],
          },
        ],
        default: [],
        validate: [
          {
            validator: (val) => Array.isArray(val) && val.length <= 10,
            message: 'Maximum 10 positive consequences allowed',
          },
        ],
      },
      negative: {
        type: [
          {
            type: String,
            trim: true,
            maxlength: [600, 'Negative consequence cannot exceed 600 characters'],
          },
        ],
        default: [],
        validate: [
          {
            validator: (val) => Array.isArray(val) && val.length <= 10,
            message: 'Maximum 10 negative consequences allowed',
          },
        ],
      },
      risks: {
        type: [
          {
            type: String,
            trim: true,
            maxlength: [600, 'Risk cannot exceed 600 characters'],
          },
        ],
        default: [],
        validate: [
          {
            validator: (val) => Array.isArray(val) && val.length <= 10,
            message: 'Maximum 10 risks allowed',
          },
        ],
      },
    },

    status: {
      type: String,
      enum: ['proposed', 'accepted', 'rejected', 'superseded', 'withdrawn', 'deprecated'],
      default: 'proposed',
    },

    project: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: [true, 'Project reference is required'],
    },

    linkedTasks: {
      type: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Task',
        },
      ],
      default: [],
      validate: [
        {
          validator: (val) => Array.isArray(val) && val.length <= 25,
          message: 'Maximum 25 linked tasks allowed',
        },
      ],
    },

    linkedMilestones: {
      type: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Milestone',
        },
      ],
      default: [],
      validate: [
        {
          validator: (val) => Array.isArray(val) && val.length <= 15,
          message: 'Maximum 15 linked milestones allowed',
        },
      ],
    },

    linkedReleases: {
      type: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Release',
        },
      ],
      default: [],
      validate: [
        {
          validator: (val) => Array.isArray(val) && val.length <= 10,
          message: 'Maximum 10 linked releases allowed',
        },
      ],
    },

    proposedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Proposer reference is required'],
    },

    decidedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    decidedAt: {
      type: Date,
      default: null,
    },

    supersededBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'DecisionRecord',
      default: null,
    },
    aggregateVersion: {
      type: Number,
      default: 0,
      min: 0,
      select: false,
    },
  },
  { timestamps: true }
);

// Explicit compound & single-field indexes
decisionRecordSchema.index({ project: 1, status: 1, createdAt: -1 });
decisionRecordSchema.index({ project: 1, updatedAt: -1 });
decisionRecordSchema.index({ linkedTasks: 1 });
decisionRecordSchema.index({ linkedMilestones: 1 });
decisionRecordSchema.index({ linkedReleases: 1 });

module.exports = mongoose.model('DecisionRecord', decisionRecordSchema);
