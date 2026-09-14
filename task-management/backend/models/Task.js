const mongoose = require("mongoose");

const commentSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    text: { type: String, required: true, trim: true },
  },
  { timestamps: true },
);

const githubEvidenceSchema = new mongoose.Schema(
  {
    repository: { type: String, trim: true, maxlength: 200 },
    pullRequestNumber: { type: Number, min: 1 },
    pullRequestUrl: { type: String, trim: true, maxlength: 500 },
    commitSha: { type: String, trim: true, maxlength: 100 },
    state: { type: String, enum: ['open', 'closed', 'merged'], default: 'open' },
    ciStatus: { type: String, enum: ['unknown', 'pending', 'success', 'failure'], default: 'unknown' },
    lastSyncedAt: { type: Date, default: null },
  },
  { _id: false }
);

const taskSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "Task title is required"],
      trim: true,
      maxlength: [
        100,
        "Title cannot exceed 100 characters",
      ],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [
        1000,
        "Description cannot exceed 1000 characters",
      ],
    },
    status: {
      type: String,
      enum: ["To Do", "In Progress", "Done"],
      default: "To Do",
    },
    priority: {
      type: String,
      enum: ["low", "medium", "high", "critical"],
      default: "medium",
    },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    project: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Project",
      default: null,
    },
    dueDate: {
      type: Date,
      default: null,
    },
    tags: [{ type: String, trim: true }],
    comments: [commentSchema],
    completedAt: {
      type: Date,
      default: null,
    },
    isBlocked: {
      type: Boolean,
      default: false,
    },
    blockedReason: {
      type: String,
      trim: true,
      maxlength: [300, "Blocked reason cannot exceed 300 characters"],
      default: "",
    },
    milestone: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Milestone",
      default: null,
    },
    dependsOn: {
      type: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Task",
        },
      ],
      default: [],
    },
    estimateDays: {
      type: Number,
      min: 1,
      max: 60,
      default: null,
    },
    blockerEta: {
      type: Date,
      default: null,
    },
    verificationStatus: {
      type: String,
      enum: ['unlinked', 'in_review', 'changes_requested', 'ci_failed', 'ready', 'verified'],
      default: 'unlinked',
    },
    githubEvidence: { type: githubEvidenceSchema, default: null },
    aggregateVersion: {
      type: Number,
      default: 0,
      min: 0,
      select: false,
    },
  },
  { timestamps: true },
);

taskSchema.index({ milestone: 1 });
taskSchema.index({ dependsOn: 1 });

// Auto-set completedAt when status becomes 'Done'
taskSchema.pre("save", function (next) {
  if (this.isModified("status")) {
    this.completedAt =
      this.status === "Done" ? new Date() : null;
  }
  next();
});

module.exports = mongoose.model("Task", taskSchema);
