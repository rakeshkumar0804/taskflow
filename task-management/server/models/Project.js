const mongoose = require('mongoose');

const projectSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    color: { type: String, default: '#6366f1' },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    members: [
      {
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        role: { type: String, enum: ['manager', 'member'], default: 'member' },
      },
    ],
    status: { type: String, enum: ['active', 'archived'], default: 'active' },
    dueDate: { type: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Project', projectSchema);
