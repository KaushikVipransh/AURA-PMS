import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import GoalSheet from './models/GoalSheet.js';
import AuditLog from './models/AuditLog.js';
import Escalation from './models/Escalation.js'; // Section 5.3 Active Model Link

dotenv.config();
const app = express();

// Enabled open CORS handling to match standard Vercel configurations smoothly
app.use(cors());
app.use(express.json());

// ==========================================
// DATABASE CONNECTION (with timeouts for Vercel serverless)
// ==========================================
const MONGO_URI = process.env.MONGO_URI;
let isConnected = false;

const connectDb = async () => {
    if (isConnected) return true;
    if (mongoose.connection.readyState === 1) {
        isConnected = true;
        return true;
    }
    try {
        // Append database name if not already present
        let uri = MONGO_URI;
        if (uri && !uri.includes('mongodb.net/aurapms')) {
            uri = uri.replace('mongodb.net/', 'mongodb.net/aurapms');
        }
        await mongoose.connect(uri, {
            serverSelectionTimeoutMS: 5000,
            connectTimeoutMS: 5000,
            socketTimeoutMS: 10000,
        });
        isConnected = true;
        console.log('✅ Connected to MongoDB Atlas cluster seamlessly.');
        return true;
    } catch (err) {
        console.error('❌ Database Initialization Fault:', err.message);
        isConnected = false;
        return false;
    }
};

// Monitor disconnections to reset the flag
mongoose.connection.on('disconnected', () => { isConnected = false; });

// Database middleware — only applied to /api/ routes (not root or health)
app.use('/api', async (req, res, next) => {
    // Skip DB connection for health check
    if (req.path === '/health') return next();
    const connected = await connectDb();
    if (!connected) {
        return res.status(503).json({ error: 'Database unavailable. Please try again in a moment.' });
    }
    next();
});

// Global schedule window pointer matching Section 2.3 criteria
let GLOBAL_ACTIVE_PERIOD = "Phase 1 — Goal Setting";

// ==========================================
// A. CORE SITE ROOT & SYSTEM HEALTH
// ==========================================
// Added root routing handling mechanism to provide a valid return handshake for direct browser views
app.get('/', (req, res) => {
    res.status(200).send("AuraPMS Core Production API Engine operating securely inside Vercel Serverless Gateway Core.");
});

app.get('/api/health', (req, res) => {
    res.status(200).json({ message: 'AtomQuest Core System API layer online and fully operational! 🚀' });
});

// ==========================================
// B. PHASE 1: SUBMIT AND LOCK INITIAL PORTFOLIO
// ==========================================
app.post('/api/goalsheets', async (req, res) => {
    try {
        const { goals, totalWeightage } = req.body;
        
        if (Math.round(Number(totalWeightage)) !== 100) return res.status(400).json({ error: 'System Exception: Combined total weightage must equal exactly 100%.' });
        if (goals.length > 8) return res.status(400).json({ error: 'System Exception: Maximum ceiling of 8 goals allowed per profile.' });
        if (goals.some(g => Number(g.weightage) < 10)) return res.status(400).json({ error: 'System Exception: Minimum floor weightage per metric is 10%.' });

        const newSheet = new GoalSheet({
            goals, 
            totalWeightage, 
            employeeId: 'emp-123', 
            employeeName: 'Vipransh Kaushik', 
            quarter: GLOBAL_ACTIVE_PERIOD
        });
        const savedSheet = await newSheet.save();
        res.status(201).json({ message: 'Goal Portfolio locked and transmitted to L1 Queue!', data: savedSheet });
    } catch (error) {
        console.error('POST /api/goalsheets error:', error);
        res.status(500).json({ error: 'Failed to process initialization sequence.', details: error.message });
    }
});

// ==========================================
// C. PHASE 1: RE-TRANSMIT MODIFIED SLATE AFTER REWORK
// ==========================================
app.put('/api/goalsheets/:id/resubmit', async (req, res) => {
    try {
        const { goals, totalWeightage } = req.body;
        if (Number(totalWeightage) !== 100) return res.status(400).json({ error: 'Combined total weightage must equal exactly 100%.' });
        
        const updatedSheet = await GoalSheet.findByIdAndUpdate(
            req.params.id,
            { goals, totalWeightage: Number(totalWeightage), approvalStatus: 'Pending' },
            { new: true }
        );
        res.status(200).json({ message: 'Goal Sheet re-routed into Pending L1 status successfully!', data: updatedSheet });
    } catch (error) {
        res.status(500).json({ error: 'Failed to re-transmit portfolio parameters.' });
    }
});

// ==========================================
// D. PHASE 1: READ ORGANIZATIONAL PROFILE RECORDS
// ==========================================
app.get('/api/goalsheets', async (req, res) => {
    try {
        const sheets = await GoalSheet.find().sort({ createdAt: -1 });
        res.status(200).json(sheets);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch enterprise profiles.' });
    }
});

// ==========================================
// E. PHASE 1: MANAGER APPROVAL GATEWAY
// ==========================================
app.put('/api/goalsheets/:id/approve', async (req, res) => {
    try {
        const updatedSheet = await GoalSheet.findByIdAndUpdate(
            req.params.id,
            { approvalStatus: 'Approved', isLocked: true },
            { new: true }
        );
        res.status(200).json({ message: 'Goal Sheet verified, signed off, and freeze-frame locked!', data: updatedSheet });
    } catch (error) {
        res.status(500).json({ error: 'Failed to finalize L1 approval loop.' });
    }
});

// ==========================================
// F. PHASE 1: MANAGER ROLLBACK REWORK TRIGGER
// ==========================================
app.put('/api/goalsheets/:id/rework', async (req, res) => {
    try {
        const updatedSheet = await GoalSheet.findByIdAndUpdate(
            req.params.id,
            { approvalStatus: 'Returned', isLocked: false },
            { new: true }
        );
        res.status(200).json({ message: 'Sheet safely returned to employee workspace drafting deck.', data: updatedSheet });
    } catch (error) {
        res.status(500).json({ error: 'Failed to execute structural rollback.' });
    }
});

// ==========================================
// G. PHASE 1: MANAGER INLINE METRICS CORRECTIONS
// ==========================================
app.put('/api/goalsheets/:id/adjust', async (req, res) => {
    try {
        const { adjustedGoals } = req.body;
        const totalWeightage = adjustedGoals.reduce((sum, g) => sum + Number(g.weightage), 0);
        if (totalWeightage !== 100) return res.status(400).json({ error: 'Adjusted sum total must equal exactly 100%.' });

        const updatedSheet = await GoalSheet.findByIdAndUpdate(
            req.params.id,
            { goals: adjustedGoals, totalWeightage },
            { new: true }
        );
        res.status(200).json({ message: 'Manager inline parameter changes persistent!', data: updatedSheet });
    } catch (error) {
        res.status(500).json({ error: 'Failed to write structural inline adjustments.' });
    }
});

// ==========================================
// H. PHASE 2: GLOBAL CORPORATE MANDATE CASCADER
// ==========================================
app.post('/api/goalsheets/push-shared', async (req, res) => {
    try {
        const { title, uom, target, defaultWeightage, primaryOwnerName, sharedGoalId } = req.body;
        const sheets = await GoalSheet.find();

        for (let sheet of sheets) {
            const isOwner = sheet.employeeName.toLowerCase().trim() === primaryOwnerName.toLowerCase().trim();
            const sharedKpiInstance = {
                title, 
                uom, 
                target, 
                weightage: Number(defaultWeightage),
                actualAchievement: "0", 
                status: "Not Started", 
                isShared: true, 
                sharedGoalId, 
                isPrimaryOwner: isOwner
            };
            
            const exists = sheet.goals.some(g => g.sharedGoalId === sharedGoalId);
            if (!exists && sheet.goals.length < 8) {
                sheet.goals.push(sharedKpiInstance);
                sheet.totalWeightage = sheet.goals.reduce((sum, g) => sum + Number(g.weightage), 0);
                await sheet.save();
            }
        }
        res.status(200).json({ message: 'Corporate Departmental KPI broadcast successfully distributed!' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to map systemic cascade vectors.' });
    }
});

// ==========================================
// I. PHASE 2: SUBMIT MID-QUARTER PROGRESS DATA
// ==========================================
app.put('/api/goalsheets/:id/checkin', async (req, res) => {
    try {
        const sheetId = req.params.id;
        const { updatedGoals } = req.body;

        const currentSheet = await GoalSheet.findById(sheetId);
        if (!currentSheet || !currentSheet.isLocked) return res.status(400).json({ error: 'Workspace target block is not active or locked.' });

        currentSheet.goals = updatedGoals;
        await currentSheet.save();

        for (let goal of updatedGoals) {
            if (goal.isShared && goal.isPrimaryOwner) {
                await GoalSheet.updateMany(
                    { "goals.sharedGoalId": goal.sharedGoalId },
                    { $set: { "goals.$.actualAchievement": goal.actualAchievement, "goals.$.status": goal.status } }
                );
            }
        }
        res.status(200).json({ message: 'Progress check-in entries committed and synchronized successfully!', data: currentSheet });
    } catch (error) {
        res.status(500).json({ error: 'Failed to write transaction checkpoints.' });
    }
});

// ==========================================
// J. PHASE 2: APPEND DIALOGUE NOTE FEEDBACK TRACE
// ==========================================
app.put('/api/goalsheets/:id/discussion', async (req, res) => {
    try {
        const { checkInComment } = req.body;
        if (!checkInComment || !checkInComment.trim()) {
            return res.status(400).json({ error: 'Dialogue log comment content string cannot be blank.' });
        }

        const updatedSheet = await GoalSheet.findByIdAndUpdate(
            req.params.id,
            { $push: { checkInDiscussions: { comment: checkInComment, timestamp: new Date() } } },
            { new: true }
        );

        if (!updatedSheet) return res.status(404).json({ error: 'Target document profile missing.' });
        res.status(200).json({ message: 'Global check-in narrative appended successfully!', data: updatedSheet });
    } catch (error) {
        res.status(500).json({ error: 'Failed to record narrative trace.' });
    }
});

// ==========================================
// K. SECTION 2.3: GET GLOBAL WORKFLOW TIMELINE STATUS
// ==========================================
app.get('/api/admin/active-period', (req, res) => {
    res.status(200).json({ activePeriod: GLOBAL_ACTIVE_PERIOD });
});

// ==========================================
// L. SECTION 2.3: SHIFT ACTIVE TIMELINE WINDOW OVERRIDE
// ==========================================
app.put('/api/admin/active-period', async (req, res) => {
    try {
        const { newPeriod } = req.body;
        GLOBAL_ACTIVE_PERIOD = newPeriod;

        await GoalSheet.updateMany({}, { $set: { quarter: newPeriod } });
        res.status(200).json({ message: `System window shifted`, activePeriod: GLOBAL_ACTIVE_PERIOD });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update calendar timeline configuration.' });
    }
});

// ==========================================
// M. PHASE 4: GET ABSOLUTE AUDIT FEED TRAIL
// ==========================================
app.get('/api/admin/audit-logs', async (req, res) => {
    try {
        const logs = await AuditLog.find().sort({ createdAt: -1 });
        res.status(200).json(logs);
    } catch (error) {
        res.status(500).json({ error: 'Failed to pull absolute governance trail metrics.' });
    }
});

// ==========================================
// N. PHASE 3: ADMIN PRIVILEGE FORCE UNLOCK CONTROL
// ==========================================
app.put('/api/goalsheets/:id/admin-force-unlock', async (req, res) => {
    try {
        const currentSheet = await GoalSheet.findById(req.params.id);
        if (!currentSheet) return res.status(404).json({ error: 'Target portfolio missing.' });

        const updatedSheet = await GoalSheet.findByIdAndUpdate(
            req.params.id,
            { approvalStatus: 'Pending', isLocked: false },
            { new: true }
        );

        const governanceLog = new AuditLog({
            employeeName: currentSheet.employeeName,
            actionType: 'ADMIN_FORCE_UNLOCK',
            changedBy: 'System Compliance Board',
            details: `Broke system configuration lock constraints. Reverted approval state from [${currentSheet.approvalStatus}] to [Pending]. Operational editing fields exposed.`
        });
        await governanceLog.save();

        res.status(200).json({ message: 'ADMIN OVERRIDE COMPLETION SUCCESS', data: updatedSheet });
    } catch (error) {
        res.status(500).json({ error: 'Exception handling sequence failure.' });
    }
});

// ==========================================
// O. PHASE 4: COMPILE TABULAR DATA EXPORT SPREADSHEET
// ==========================================
app.get('/api/admin/export-csv', async (req, res) => {
    try {
        const sheets = await GoalSheet.find();
        let csvContent = "Employee Profile,Quarter Window,Overall Configuration State,Goal Metric Title,Unit of Measure (UoM),Planned Target Framework,Actual Achievement Record,Current Execution Status\n";
        
        sheets.forEach(sheet => {
            sheet.goals.forEach(goal => {
                const escapedTitle = (goal.title || '').replace(/,/g, ' ');
                csvContent += `"${sheet.employeeName}","${sheet.quarter}","${sheet.approvalStatus}","${escapedTitle}","${goal.uom}","${goal.target}","${goal.actualAchievement || 0}","${goal.status || 'Not Started'}"\n`;
            });
        });
        
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=Enterprise_Goal_Achievement_Report.csv');
        return res.status(200).send(csvContent);
    } catch (error) {
        res.status(500).json({ error: 'Failed to construct and compile tabular CSV export document.' });
    }
});

// ==========================================
// P. SECTION 5.3: AUTOMATED TIME INTERVAL EVALUATOR & NOTIFICATION CHAIN
// ==========================================
app.post('/api/admin/evaluate-escalations', async (req, res) => {
    try {
        const sheets = await GoalSheet.find();
        const currentDate = new Date();

        for (let sheet of sheets) {
            const daysSinceUpdate = Math.max(Math.floor((currentDate - new Date(sheet.updatedAt)) / (1000 * 60 * 60 * 24)), 4);

            if (sheet.approvalStatus === 'Returned' || sheet.approvalStatus === 'Pending') {
                let currentChainState = 'Employee Alert Sent';
                if (daysSinceUpdate > 7) currentChainState = 'Manager Alert Sent';
                if (daysSinceUpdate > 14) currentChainState = 'Skip-Level / HR Core Escalated';

                const activeEscalation = await Escalation.findOne({ employeeName: sheet.employeeName, status: 'Active' });
                
                if (!activeEscalation) {
                    const newLog = new Escalation({
                        employeeName: sheet.employeeName,
                        violationType: sheet.approvalStatus === 'Pending' ? 'APPROVAL_DELAY' : 'SUBMISSION_DELAY',
                        daysOverdue: daysSinceUpdate,
                        notificationChainState: currentChainState
                    });
                    await newLog.save();
                } else {
                    activeEscalation.daysOverdue = daysSinceUpdate;
                    activeEscalation.notificationChainState = currentChainState;
                    await activeEscalation.save();
                }
            }
        }

        const currentLogs = await Escalation.find().sort({ createdAt: -1 });
        res.status(200).json({ message: 'Compliance metrics checked.', escalations: currentLogs });
    } catch (error) {
        res.status(500).json({ error: 'Timeline interval check failure.' });
    }
});

// ==========================================
// Q. SECTION 5.3: EXPLICIT RESOLUTION ENGINE
// ==========================================
app.put('/api/admin/escalations/:id/resolve', async (req, res) => {
    try {
        const { resolutionComment } = req.body;
        if (!resolutionComment || !resolutionComment.trim()) {
            return res.status(400).json({ error: 'A valid tracking resolution comment is required.' });
        }

        const resolvedEscalation = await Escalation.findByIdAndUpdate(
            req.params.id,
            { status: 'Resolved', resolutionComment: resolutionComment },
            { new: true }
        );

        res.status(200).json({ message: 'Violation cleared.', data: resolvedEscalation });
    } catch (error) {
        res.status(500).json({ error: 'Failed to process item resolution.' });
    }
});

app.get('/api/admin/escalations', async (req, res) => {
    try {
        const logs = await Escalation.find().sort({ status: 1, createdAt: -1 });
        res.status(200).json(logs);
    } catch (error) {
        res.status(500).json({ error: 'Failed to retrieve logs.' });
    }
});

// ==========================================
// R. SECTION 5.4: PRODUCTION ANALYTICS BREAKDOWN AGGREGATOR
// ==========================================
app.get('/api/admin/analytics', async (req, res) => {
    try {
        const sheets = await GoalSheet.find();
        
        let thrustAreaBreakdown = { "Business Growth": 0, "Operational Excellence": 0, "Technology & Innovation": 0, "Compliance & Risk Management": 0 };
        let uomBreakdown = { "Numeric": 0, "%": 0, "Timeline": 0, "Zero-based": 0 };
        let statusBreakdown = { "Not Started": 0, "On Track": 0, "Completed": 0 };

        sheets.forEach(sheet => {
            (sheet.goals || []).forEach(goal => {
                const area = goal.thrustArea || "Operational Excellence";
                const unit = goal.uom || "Numeric";
                const state = goal.status || "Not Started";

                if (thrustAreaBreakdown[area] !== undefined) thrustAreaBreakdown[area]++;
                if (uomBreakdown[unit] !== undefined) uomBreakdown[unit]++;
                if (statusBreakdown[state] !== undefined) statusBreakdown[state]++;
            });
        });

        res.status(200).json({ thrustAreaBreakdown, uomBreakdown, statusBreakdown });
    } catch (error) {
        res.status(500).json({ error: 'Analytics failure.' });
    }
});

// (Database connection middleware moved to top of file, before route handlers)

// Fallback port listener execution only during standalone terminal operations
if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => console.log(`🚀 Standing node app executing on http://localhost:${PORT}`));
}

export default app;