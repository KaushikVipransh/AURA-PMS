import mongoose from 'mongoose';

const AuditLogSchema = new mongoose.Schema({
    employeeName: { type: String, required: true },
    actionType: { type: String, required: true }, // e.g., "ADMIN_FORCE_UNLOCK", "CORPORATE_BROADCAST"
    changedBy: { type: String, default: "System Admin" },
    details: { type: String, required: true },
    timestamp: { type: Date, default: Date.now }
}, { timestamps: true });

export default mongoose.model('AuditLog', AuditLogSchema);