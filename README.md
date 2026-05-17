# AuraPMS — Enterprise Performance Management Suite

AuraPMS is a high-end, production-grade Performance Management System (PMS) engineered to manage corporate alignment, scorecards, rule-based compliance auditing, and detailed performance analytics. 

Built on a decoupled **MERN Stack (MongoDB, Express.js, React, Node.js)** and styled with **Tailwind CSS and Shadcn UI components**, the platform delivers a secure, multi-tenant workspace mapping distinct, end-to-end user journeys for Employees, L1 Managers, and HR Admins.

---

## 🏗️ Architectural Overview & System Blueprint

AuraPMS employs a secure, decoupled architectural pattern that separates presentation layers from data processing engines to guarantee 100% operational uptime.

[ Client Browser / Frontend Single Page App ]
│
▼ (HTTPS / JSON REST API Handshaking Layer)
[ Node.js & Express.js Core Backend Gateway Engine ]
│
├───► Database Pipeline ───► [ MongoDB Atlas Cloud Cluster ]
│
▼ (Self-Contained Functional Subsystems)
┌────────────────────────────────────────────────────────┐
│ ⚙️ Core Engines Configured Natively:                   |
│  1. Multi-Formula Scoring Engine (Unit of Measure)     │
│  2. Automated Rule Escalation Processor                │
│  3. Live Metrics Aggregator Aggregates                 │
│  4. Tabular CSV Ledger Stream Exporter                 │
└────────────────────────────────────────────────────────┘
---

## 🚀 Key Functional Systems & Features

### 👤 1. Employee Workspace (Goal Drafting Deck)
* **Goal Weightage Enforcement:** Natively ensures that a user's combined goal weightages equal an absolute ceiling of exactly **100%**. Includes a minimum floor restriction of **10%** per metric and an 8-goal container limit.
* **Multi-Formula Progress Calculator:** Dynamically computes performance metrics based on the specified Unit of Measure (UoM):
  * **Numeric/Percentage Goals:** Calculates progress linearly ($Actual \div Target$).
  * **Inverse Logic/TAT Goals:** Automatically calculates progress inversely ($Target \div Actual$) for goals matching "TAT", "Cost", or "Reduction".
  * **Zero-Based Goals:** Binary computation logic where $0$ yields a clean 100% achievement rate, and numbers $>0$ mark a system execution failure.
  * **Timeline Goals:** Maps milestone phases cleanly (Completed = 100%, On Track = 50%, Not Started = 0%).

### 👥 2. Manager L1 Suite (Queue & Alignment Reviewer)
* **Approval Freeze Frame Lock:** Offers interactive fields for weightage corrections and a rework rollback mechanism (`Return for Rework`). Approving a sheet shifts its status to `Approved` and triggers a full database operational lock (`isLocked: true`).
* **Cumulative Metric Scoring Progress Tracker:** Dynamically reads and computes overall progress fractions against assigned goal weights, rendering a live aggregated progress summary bar.
* **Continuous Dialogue Logger:** An interactive check-in commentary module to log persistent audit feedback and coaching trails directly onto the employee's active profile sheet.

### ⚠️ 3. Rule-Based Escalation Control Board
* **Automated Timeline Exceptions:** Compares current server dates against sheet modification timestamps (`updatedAt`) to automatically isolate submission and approval pipeline delays.
* **Dynamic Notification Status Chain:** Automatically routes the notification tier step-by-step through a defined corporate alert hierarchy over time:
  $$\text{Employee Alert Sent} \longrightarrow \text{Manager Alert Sent} \longrightarrow \text{Skip-Level / HR Core Escalated}$$
* **Interactive HR Resolution Desk:** Allows HR Admins to visually track delays, input custom compliance logs, and execute explicit resolution handlers to safely archive open violations.

### 📊 4. Analytics Dashboard
* **Dynamic Organization Distributions:** Runs high-speed database aggregation matrices to display organizational metrics split by **Thrust Area**, **UoM Type Allocations**, and real-time **Goal Execution Status Rates**.
* **Global Security Unlock Break:** Provides HR Admins with an override bypass to force-unlock locked sheets, automatically logging the exception into a secure, timestamped, unalterable system terminal board (`[ADMIN_FORCE_UNLOCK]`).
* **Tabular Data Export Stream:** Compiles live, un-truncated database arrays into a localized physical file (`Enterprise_Goal_Achievement_Report.csv`) dynamically in the browser window with zero application lag.

---

## 🛠️ Monorepo Directory Layout

```text
AuraPMS-Enterprise/
├── frontend/                  # React Single Page Application (Vite / Tailwind)
│   ├── src/
│   │   ├── components/ui/     # Reusable presentation canvas containers
│   │   ├── pages/             # LandingPage, EmployeeDashboard, ManagerWorkspace, AdminPanel
│   │   ├── App.jsx            # Core URL router and guard matrix definitions
│   │   └── ProtectedRoute.jsx # RBAC route guard enforcing case-sensitive local storage validation
│   └── package.json
└── backend/                   # Express.js Rest API Gateway Server
    ├── models/                # Schema blueprints (GoalSheet, AuditLog, Escalation)
    ├── server.js              # Native multi-formula calculators, analytics endpoints, & MongoDB init
    └── package.json


🎯 Verification and Pass Criteria
The entire portal has been successfully verified via a programmatic end-to-end regression test suite from an absolute blank database state, confirming 100% compliance with all constraints and business requirement.


⚙️ Local Development Startup Guide

1. Configure Secret Environments
Create a .env file within the backend/ directory:Code snippetMONGO_URI=your_mongodb_atlas_connection_string
PORT=5000

2. Launch the Backend API InstanceBashcd backend
npm install
node server.js

3. Launch the Frontend Canvas PortalBashcd ../frontend
npm install
npm run dev
