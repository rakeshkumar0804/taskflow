const mongoose = require('mongoose');

const milestoneSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Milestone title is required'],
      trim: true,
      maxlength: [100, 'Milestone title cannot exceed 100 characters'],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [500, 'Description cannot exceed 500 characters'],
      default: '',
    },
    dueDate: {
      type: Date,
      required: [true, 'Due date is required'],
    },
    status: {
      type: String,
      enum: ['open', 'at-risk', 'completed', 'cancelled'],
      default: 'open',
    },
    sequence: {
      type: Number,
      min: [1, 'Sequence must be an integer >= 1'],
      default: 1,
    },
    project: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: [true, 'Project reference is required'],
    },
    release: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Release',
      default: null,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'CreatedBy user reference is required'],
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

milestoneSchema.index({ project: 1, status: 1 });
milestoneSchema.index({ release: 1 });
milestoneSchema.index({ dueDate: 1 });
milestoneSchema.index({ project: 1, sequence: 1 });

module.exports = mongoose.model('Milestone', milestoneSchema);
