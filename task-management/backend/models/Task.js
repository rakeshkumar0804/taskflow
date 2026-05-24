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
  },
  { timestamps: true },
);

// Auto-set completedAt when status becomes 'Done'
taskSchema.pre("save", function (next) {
  if (this.isModified("status")) {
    this.completedAt =
      this.status === "Done" ? new Date() : null;
  }
  next();
});

module.exports = mongoose.model("Task", taskSchema);
