import mongoose from 'mongoose';

const EscalationSchema = new mongoose.Schema({
    employeeName: { type: String, required: true },
    managerName: { type: String, default: "L1 Team Manager" },
    violationType: { type: String, enum: ['SUBMISSION_DELAY', 'APPROVAL_DELAY'], required: true },
    daysOverdue: { type: Number, required: true },
    
    // Explicit Notification Tracking Variables for Section 5.3
    notificationChainState: { 
        type: String, 
        enum: ['Employee Alert Sent', 'Manager Alert Sent', 'Skip-Level / HR Core Escalated'], 
        default: 'Employee Alert Sent' 
    },
    resolutionComment: { type: String, default: "" },
    status: { type: String, enum: ['Active', 'Resolved'], default: 'Active' }
}, { timestamps: true });

export default mongoose.model('Escalation', EscalationSchema);