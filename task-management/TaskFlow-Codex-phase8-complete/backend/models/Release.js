const mongoose = require('mongoose');

const releaseSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Release name is required'],
      trim: true,
      maxlength: [80, 'Release name cannot exceed 80 characters'],
    },
    version: {
      type: String,
      required: [true, 'Version is required'],
      trim: true,
      maxlength: [30, 'Version cannot exceed 30 characters'],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [1000, 'Description cannot exceed 1000 characters'],
      default: '',
    },
    targetDate: {
      type: Date,
      required: [true, 'Target date is required'],
    },
    status: {
      type: String,
      enum: ['planning', 'active', 'code-freeze', 'shipped', 'cancelled'],
      default: 'planning',
    },
    project: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: [true, 'Project reference is required'],
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

releaseSchema.index({ project: 1, status: 1 });
releaseSchema.index({ targetDate: 1 });
releaseSchema.index({ project: 1, version: 1 }, { unique: true });

module.exports = mongoose.model('Release', releaseSchema);
