import mongoose from 'mongoose';

const GoalSchema = new mongoose.Schema({
    thrustArea: { type: String, default: "Operational Excellence" },
    title: { type: String, required: true },
    uom: { type: String, enum: ['Numeric', '%', 'Timeline', 'Zero-based'], default: 'Numeric' },
    target: { type: String, required: true },
    weightage: { type: Number, required: true },
    actualAchievement: { type: String, default: "0" },
    status: { type: String, enum: ['Not Started', 'On Track', 'Completed'], default: 'Not Started' },
    isShared: { type: Boolean, default: false },
    sharedGoalId: { type: String, default: null },
    isPrimaryOwner: { type: Boolean, default: false }
});

const GoalSheetSchema = new mongoose.Schema({
    employeeId: { type: String, required: true },
    employeeName: { type: String, required: true },
    goals: [GoalSchema],
    quarter: { type: String, default: "Phase 1 — Goal Setting" }, // Dynamically managed by Admin Cycle Switcher
    totalWeightage: { type: Number, required: true, default: 0 },
    approvalStatus: { type: String, enum: ['Pending', 'Approved', 'Returned', 'Unlock Requested'], default: 'Pending' },
    isLocked: { type: Boolean, default: false },
    checkInDiscussions: [{
        comment: { type: String },
        timestamp: { type: Date, default: Date.now }
    }]
}, { timestamps: true });

export default mongoose.model('GoalSheet', GoalSheetSchema);