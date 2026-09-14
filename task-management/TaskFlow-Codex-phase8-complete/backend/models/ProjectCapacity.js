const mongoose = require('mongoose');

const projectCapacitySchema = new mongoose.Schema(
  {
    project: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: [true, 'Project reference is required'],
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User reference is required'],
    },
    availableDaysPerWeek: {
      type: Number,
      required: [true, 'Available days per week is required'],
      min: [0.5, 'Available days per week must be at least 0.5'],
      max: [7.0, 'Available days per week cannot exceed 7.0'],
      validate: {
        validator: (val) => Number.isFinite(val) && Math.round(val * 2) === val * 2,
        message: 'Available days per week must be in increments of 0.5',
      },
    },
    wipLimit: {
      type: Number,
      default: 3,
      min: [1, 'WIP limit must be at least 1'],
      max: [10, 'WIP limit cannot exceed 10'],
      validate: {
        validator: (val) => Number.isInteger(val),
        message: 'WIP limit must be an integer between 1 and 10',
      },
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'CreatedBy user reference is required'],
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'UpdatedBy user reference is required'],
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

// Indexes per canonical specification
projectCapacitySchema.index({ project: 1, user: 1 }, { unique: true });
projectCapacitySchema.index({ project: 1, updatedAt: -1 });
projectCapacitySchema.index({ user: 1, updatedAt: -1 });

module.exports = mongoose.model('ProjectCapacity', projectCapacitySchema);
