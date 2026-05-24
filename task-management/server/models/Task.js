const mongoose = require("mongoose");

const commentSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    text: { type: String, required: true },
  },
  { timestamps: true },
);

const taskSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    project: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Project",
      required: true,
    },
    assignedTo: [
      { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    ],
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    status: {
      type: String,
      enum: ["To Do", "In Progress", "Review", "Done"],
      default: "To Do",
    },
    priority: {
      type: String,
      enum: ["low", "medium", "high", "urgent"],
      default: "medium",
    },
    dueDate: { type: Date },
    tags: [{ type: String }],
    comments: [commentSchema],
    order: { type: Number, default: 0 },
  },
  { timestamps: true },
);

taskSchema.index({ project: 1, status: 1 });
taskSchema.index({ assignedTo: 1 });

module.exports = mongoose.model("Task", taskSchema);
