import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function AdminPanel() {
  const navigate = useNavigate();
  const [sheets, setSheets] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [escalationLogs, setEscalationLogs] = useState([]);
  const [resolutionText, setResolutionText] = useState({});
  const [loading, setLoading] = useState(true);
  const [activePeriod, setActivePeriod] = useState("Phase 1 — Goal Setting");

  const [analytics, setAnalytics] = useState({
    thrustAreaBreakdown: { "Business Growth": 0, "Operational Excellence": 0, "Technology & Innovation": 0, "Compliance & Risk Management": 0 },
    uomBreakdown: { "Numeric": 0, "%": 0, "Timeline": 0, "Zero-based": 0 },
    statusBreakdown: { "Not Started": 0, "On Track": 0, "Completed": 0 }
  });

  const [sharedKpi, setSharedKpi] = useState({
    title: '', uom: 'Numeric', target: '', defaultWeightage: '15', primaryOwnerName: ''
  });

  useEffect(() => {
    fetchInitialAdminData();
  }, []);

  // --- HANDSHAKE LOGIC POINT A: GATHER INITIAL CLUSTER DATA ---
  const fetchInitialAdminData = async () => {
    try {
      const sheetsResponse = await fetch('https://aurapms-backend.vercel.app/api/goalsheets');
      const sheetsData = await sheetsResponse.json();
      setSheets(Array.isArray(sheetsData) ? sheetsData : []);

      const logsResponse = await fetch('https://aurapms-backend.vercel.app/api/admin/audit-logs');
      const logsData = await logsResponse.json();
      setAuditLogs(Array.isArray(logsData) ? logsData : []);

      const escResponse = await fetch('https://aurapms-backend.vercel.app/api/admin/escalations');
      const escData = await escResponse.json();
      setEscalationLogs(Array.isArray(escData) ? escData : []);

      const analyticsResponse = await fetch('https://aurapms-backend.vercel.app/api/admin/analytics');
      const analyticsData = await analyticsResponse.json();
      if (analyticsData && !analyticsData.error) setAnalytics(analyticsData);

      const periodResponse = await fetch('https://aurapms-backend.vercel.app/api/admin/active-period');
      const periodData = await periodResponse.json();
      if (periodData?.activePeriod) setActivePeriod(periodData.activePeriod);

      if (sheetsData && sheetsData.length > 0) {
        setSharedKpi(prev => ({ ...prev, primaryOwnerName: sheetsData[0].employeeName }));
      }

      setLoading(false);
    } catch (error) {
      console.error("Gather error:", error);
      setLoading(false);
    }
  };

  // --- HANDSHAKE LOGIC POINT B: GLOBAL CYCLE SCHEDULER VECTOR ---
  const handlePeriodWindowChange = async (newPeriod) => {
    try {
      const response = await fetch('https://aurapms-backend.vercel.app/api/admin/active-period', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPeriod })
      });
      if (response.ok) {
        alert(`🚨 SYSTEM TIMELINE UPDATE:\nCorporate window successfully transitioned to [${newPeriod}]. All sheets synced.`);
        setActivePeriod(newPeriod);
        fetchInitialAdminData(); 
      }
    } catch (error) {
      console.error(error);
    }
  };

  // --- HANDSHAKE LOGIC POINT C: EXECUTE BACKGROUND INTERVAL RECKONER ---
  const handleRunComplianceEvaluation = async () => {
    try {
      const response = await fetch('https://aurapms-backend.vercel.app/api/admin/evaluate-escalations', { method: 'POST' });
      const data = await response.json();
      if (response.ok) {
        alert("⚙️ Compliance Engine Execution Finished!\nScanned sheets and evaluated current notification chain states.");
        setEscalationLogs(data.escalations || []);
        fetchInitialAdminData();
      }
    } catch (error) { 
      console.error(error); 
    }
  };

  // --- HANDSHAKE LOGIC POINT D: COMPLIANCE RESOLUTION COMPILER ---
  const handleResolveLogItem = async (id) => {
    const text = resolutionText[id];
    if (!text || !text.trim()) return alert("Please input a tracking resolution note.");

    try {
      const response = await fetch(`https://aurapms-backend.vercel.app/api/admin/escalations/${id}/resolve`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolutionComment: text })
      });
      if (response.ok) {
        alert("✅ Escalation logged as resolved.");
        setResolutionText(prev => ({ ...prev, [id]: '' }));
        fetchInitialAdminData();
      }
    } catch (error) { 
      console.error(error); 
    }
  };

  // --- HANDSHAKE LOGIC POINT E: SECURITY BYPASS LOCK BREAKER ---
  const handleAdminForceUnlock = async (sheetId) => {
    const confirmation = window.confirm("SECURITY OVERRIDE WARNING:\nYou are choosing to break a system lock. Proceed?");
    if (!confirmation) return;

    try {
      const response = await fetch(`https://aurapms-backend.vercel.app/api/goalsheets/${sheetId}/admin-force-unlock`, { method: 'PUT' });
      if (response.ok) {
        alert('🔓 SECURITY OVERRIDE COMPLETED: Goal sheet unlocked.');
        fetchInitialAdminData(); 
      }
    } catch (error) {
      console.error(error);
    }
  };

  // --- HANDSHAKE LOGIC POINT F: DEPLOY CORPORATE KPI BROADCAST ---
  const handlePushSharedGoal = async () => {
    if (!sharedKpi.title || !sharedKpi.target || !sharedKpi.primaryOwnerName) {
      return alert("Please ensure Title, Target, and a Sync Owner profile are active before broadcast distribution.");
    }
    try {
      const response = await fetch('https://aurapms-backend.vercel.app/api/goalsheets/push-shared', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...sharedKpi, sharedGoalId: "cluster-" + Date.now().toString() })
      });
      if (response.ok) {
        alert(`🎉 CORPORATE BROADCAST COMPLETED:\nMandatory KPI successfully distributed!`);
        setSharedKpi({ title: '', uom: 'Numeric', target: '', defaultWeightage: '15', primaryOwnerName: sheets[0]?.employeeName || '' });
        fetchInitialAdminData();
      }
    } catch (error) {
      console.error(error);
    }
  };

  // --- HANDSHAKE LOGIC POINT G: DOWNLOAD STRUCTURAL DATA RELEASES ---
  const handleExportCSV = () => {
    const link = document.createElement('a');
    link.href = 'https://aurapms-backend.vercel.app/api/admin/export-csv';
    link.setAttribute('download', 'Enterprise_Goal_Achievement_Report.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // --- DEMO LIFECYCLE CONTROLLER: RESET AND SYSTEM PURGE ---
  const handleResetDemoData = async () => {
    const confirmFlush = window.confirm("🚨 DEMO DATA PURGE WARNING:\nAre you sure you want to flush all database collections back to a blank zero-state for live evaluation testing?");
    if (!confirmFlush) return;

    try {
      const response = await fetch('https://aurapms-backend.vercel.app/api/admin/reset-demo', { method: 'DELETE' });
      if (response.ok) {
        alert("🧹 Database collections successfully purged! The system is now a complete blank slate for your user journey testing.");
        fetchInitialAdminData();
      } else {
        alert("Failed to reset database layer parameters cleanly.");
      }
    } catch (error) {
      console.error("Reset trace error:", error);
      alert("Network timeout fault parsing reset commands.");
    }
  };

  const totalProfiles = sheets.length;
  const totalCompletedCheckins = sheets.filter(s => s.goals?.every(g => g.status === 'Completed' || g.status === 'On Track')).length;
  const pendingCheckinsCount = totalProfiles - totalCompletedCheckins;
  const uniqueEmployeesList = Array.from(new Set(sheets.map(s => s.employeeName)));

  return (
    <div className="min-h-screen bg-[#1A1816] text-[#E7E5E0] page-enter scrollbar-warm" style={{ fontFamily: "'DM Sans', system-ui, sans-serif" }}>
      <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        
        {/* Header Structure */}
        <div className="flex items-center justify-between border-b border-[#332F2B] pb-5">
          <div>
            <h1 className="font-display text-2xl sm:text-3xl text-[#F5F2ED] flex items-center gap-2.5">
              🛡️ Governance & Audit Portal <span className="text-[10px] font-mono font-bold bg-[#B54D4D]/15 text-[#E07A5F] border border-[#B54D4D]/20 px-2 py-0.5 rounded-md ml-1">HR Core L3</span>
            </h1>
            <p className="text-[#78716C] mt-1 text-sm">Export organizational achievements, track compliance ratios, and view absolute audit changes.</p>
          </div>
          <div className="flex gap-3">
            {/* INJECTED SYSTEM RESET INTERFACE TRIGGER */}
            <Button onClick={handleResetDemoData} className="bg-[#B54D4D] hover:bg-[#963E3E] text-white text-xs font-semibold px-4 shadow-warm-sm">
              🧹 Reset System Demo
            </Button>
            <Button onClick={handleExportCSV} className="bg-[#5B8C5A] hover:bg-[#4A7A49] text-white text-xs font-semibold px-4 shadow-warm-sm">
              📥 Export Report (CSV)
            </Button>
            <Button variant="outline" className="text-[#A8A29E] border-[#332F2B] hover:bg-[#242220] hover:text-[#F5F2ED] hover:border-[#44403C]" onClick={() => {
              localStorage.removeItem('atomquest_role');
              navigate('/');
            }}>Sign Out</Button>
          </div>
        </div>

        {/* Dynamic Aggregated Metrics Box Metrics Row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 animate-slide-up">
          <div className="p-4 bg-[#242220] border border-[#332F2B] rounded-xl">
            <span className="text-[10px] uppercase font-bold tracking-wider text-[#78716C] block">Total Active Profiles</span>
            <span className="text-2xl font-bold text-[#F5F2ED] block mt-1">{totalProfiles} Records</span>
          </div>
          <div className="p-4 bg-[#242220] border border-[#332F2B] rounded-xl">
            <span className="text-[10px] uppercase font-bold tracking-wider text-[#6B9E7A] block">Completed / Active Check-ins</span>
            <span className="text-2xl font-bold text-[#6B9E7A] block mt-1">{totalCompletedCheckins} Staff Members</span>
          </div>
          <div className="p-4 bg-[#242220] border border-[#332F2B] rounded-xl">
            <span className="text-[10px] uppercase font-bold tracking-wider text-[#C68B59] block">Pending Check-in Activity</span>
            <span className="text-2xl font-bold text-[#C68B59] block mt-1">{pendingCheckinsCount} Profiles Running</span>
          </div>
        </div>

        {/* Section 5.4 High Speed Analytics Arrays Analytics Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 border-b border-[#332F2B] pb-6 animate-slide-up animate-delay-1">
          {[
            { title: 'Thrust Area Distribution', data: analytics.thrustAreaBreakdown, color: '#C68B59' },
            { title: 'Unit of Measure Allocations', data: analytics.uomBreakdown, color: '#6B9E7A' },
            { title: 'Goal Execution Status', data: analytics.statusBreakdown, color: '#D4A06A' },
          ].map((card, ci) => (
            <Card key={ci} className="bg-[#242220] border-[#332F2B] text-[#E7E5E0]">
              <CardHeader className="py-3">
                <CardTitle className="text-[10px] uppercase tracking-wider font-mono font-bold" style={{ color: card.color }}>{card.title}</CardTitle>
              </CardHeader>
              <CardContent className="text-xs space-y-2 font-mono">
                {Object.entries(card.data).map(([key, val]) => (
                  <div key={key} className="flex justify-between border-b border-[#332F2B] pb-1.5 text-[#A8A29E]"><span>{key}:</span><b className="text-[#F5F2ED]">{val} goals</b></div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Content Operations Panel layout Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="col-span-1 space-y-4 animate-slide-up animate-delay-2">
            {/* Timeline Scheduler Matrix */}
            <Card className="bg-[#242220] border-[#332F2B] text-[#E7E5E0] border-l-4 border-l-[#C68B59]">
              <CardHeader className="pb-2">
                <CardTitle className="text-base text-[#F5F2ED] font-semibold">Global Cycle Schedule</CardTitle>
                <CardDescription className="text-[#78716C] text-xs">Simulate dynamic calendar tracking windows.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                <Label className="text-[#78716C] block uppercase font-bold tracking-wider text-[10px] mb-1">Active Corporate Period</Label>
                <select 
                  className="select-warm-dark text-sm"
                  value={activePeriod}
                  onChange={(e) => handlePeriodWindowChange(e.target.value)}
                >
                  <option value="Phase 1 — Goal Setting">Phase 1 — Goal Setting (Window: 1st May)</option>
                  <option value="Q1 Check-in">Q1 Check-in (Window: July)</option>
                  <option value="Q2 Check-in">Q2 Check-in (Window: October)</option>
                  <option value="Q3 Check-in">Q3 Check-in (Window: January)</option>
                  <option value="Q4 / Annual Achievement">Q4 / Annual Achievement (Window: March/April)</option>
                </select>
              </CardContent>
            </Card>

            {/* Core Department KPI Form Container */}
            <Card className="bg-[#242220] border-[#332F2B] text-[#E7E5E0]">
              <CardHeader className="pb-2">
                <CardTitle className="text-base text-[#A8A29E] font-semibold">Deploy Global Framework</CardTitle>
                <CardDescription className="text-[#57534E] text-xs">Inject mandatory linked frameworks across sheets.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3.5 text-xs">
                <div>
                  <Label className="text-[#78716C] font-semibold">Goal Metric Title</Label>
                  <Input className="bg-[#1A1816] border-[#332F2B] mt-1 h-9 text-[#F5F2ED] placeholder:text-[#57534E] focus-visible:border-[#6B9E7A] focus-visible:ring-[rgba(107,158,122,0.15)]" placeholder="e.g., Infrastructure Optimization" value={sharedKpi.title} onChange={(e) => setSharedKpi({...sharedKpi, title: e.target.value})} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-[#78716C] font-semibold">Target Value</Label>
                    <Input className="bg-[#1A1816] border-[#332F2B] mt-1 h-9 text-[#F5F2ED] placeholder:text-[#57534E] focus-visible:border-[#6B9E7A] focus-visible:ring-[rgba(107,158,122,0.15)]" placeholder="e.g., 100" value={sharedKpi.target} onChange={(e) => setSharedKpi({...sharedKpi, target: e.target.value})} />
                  </div>
                  <div>
                    <Label className="text-[#78716C] font-semibold">UoM</Label>
                    <select className="select-warm-dark h-9 text-xs mt-1" value={sharedKpi.uom} onChange={(e) => setSharedKpi({...sharedKpi, uom: e.target.value})}><option value="Numeric">Numeric</option><option value="%">Percentage (%)</option><option value="Timeline">Timeline</option><option value="Zero-based">Zero-based</option></select>
                  </div>
                </div>
                <div>
                  <Label className="text-[#78716C] font-semibold">Default Weightage (%)</Label>
                  <Input type="number" className="bg-[#1A1816] border-[#332F2B] mt-1 h-9 text-[#F5F2ED] focus-visible:border-[#6B9E7A] focus-visible:ring-[rgba(107,158,122,0.15)]" value={sharedKpi.defaultWeightage} onChange={(e) => setSharedKpi({...sharedKpi, defaultWeightage: e.target.value})} />
                </div>
                <div>
                  <Label className="text-[#78716C] font-semibold">Primary Sync Owner</Label>
                  <select 
                    className="select-warm-dark h-9 text-xs font-semibold text-[#F5F2ED] mt-1"
                    value={sharedKpi.primaryOwnerName} 
                    onChange={(e) => setSharedKpi({...sharedKpi, primaryOwnerName: e.target.value})}
                  >
                    {uniqueEmployeesList.length === 0 ? (
                      <option value="">No active profiles loaded</option>
                    ) : (
                      uniqueEmployeesList.map((empName, idx) => (
                        <option key={idx} value={empName}>{empName}</option>
                      ))
                    )}
                  </select>
                </div>
                <Button className="w-full bg-[#C68B59] hover:bg-[#B57A48] font-semibold text-white mt-1 h-9 shadow-warm-sm" onClick={handlePushSharedGoal}>Broadcast Framework</Button>
              </CardContent>
            </Card>
          </div>

          <div className="lg:col-span-2 space-y-6">
            {/* Sheets List */}
            <div className="space-y-3 animate-slide-up animate-delay-3">
              <h2 className="text-base font-semibold text-[#A8A29E]">System Activity Logs</h2>
              {loading ? (
                <p className="text-[#57534E] text-xs animate-fade-in">Accessing data fields...</p>
              ) : sheets.length === 0 ? (
                <div className="p-6 text-center text-xs font-mono border border-dashed border-[#332F2B] rounded-xl text-[#57534E] bg-[#242220]">
                  No operational metrics loaded. System ready for seed injection routines.
                </div>
              ) : (
                sheets.map((sheet) => (
                  <div key={sheet._id} className="p-4 bg-[#242220] border border-[#332F2B] rounded-xl flex items-center justify-between hover:border-[#44403C] transition-colors">
                    <div>
                      <h4 className="font-semibold text-[#F5F2ED] text-sm">{sheet.employeeName}'s Portfolio Sheet</h4>
                      <p className="text-xs text-[#78716C] mt-1">Window: <span className="font-mono text-[#6B9E7A] font-semibold">[{sheet.quarter}]</span> &nbsp;|&nbsp; Status: <span className="font-mono text-[#C68B59] font-semibold">{sheet.approvalStatus}</span></p>
                    </div>
                    <Button variant="outline" size="sm" className="border-[#332F2B] text-[#78716C] text-xs hover:bg-[#332F2B] hover:text-[#F5F2ED] hover:border-[#44403C]" onClick={() => handleAdminForceUnlock(sheet._id)}>Force Unlock</Button>
                  </div>
                ))
              )}
            </div>

            {/* Cryptographic Governance Feed Audit Trail */}
            <div className="space-y-3">
              <h2 className="text-base font-semibold text-[#A8A29E] border-t border-[#332F2B] pt-4">🔒 Audit Logs</h2>
              <div className="bg-[#242220] border border-[#332F2B] rounded-xl p-4 max-h-48 overflow-y-auto space-y-2 font-mono text-xs scrollbar-warm">
                {auditLogs.length === 0 ? (
                  <p className="text-[#57534E] italic text-center py-2">No security lock breaks recorded.</p>
                ) : (
                  auditLogs.map((log, idx) => (
                    <div key={idx} className="p-2.5 bg-[#1A1816] border border-[#332F2B] rounded-lg text-[#A8A29E]">
                      <span className="text-[#E07A5F] font-bold">[{log.actionType}]</span> <span className="text-[#57534E] ml-1">{new Date(log.timestamp).toLocaleDateString()}</span>
                      <p className="text-[#78716C] mt-0.5">Target: {log.employeeName} | Delta: {log.details}</p>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Section 5.3 Automated Rule Escalation Board */}
            <div className="space-y-4 border-t border-[#332F2B] pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-semibold text-[#A8A29E]">⚠️ Escalation Control Board</h2>
                  <p className="text-xs text-[#57534E] mt-0.5">Enforce interval alerts and track notification chains.</p>
                </div>
                <Button onClick={handleRunComplianceEvaluation} className="bg-[#C68B59] hover:bg-[#B57A48] text-white font-semibold text-xs h-8 px-3 shadow-warm-sm">
                  ⚙️ Run Compliance Checker
                </Button>
              </div>

              <div className="grid grid-cols-1 gap-2.5">
                {escalationLogs.length === 0 ? (
                  <div className="p-4 text-center text-xs text-[#57534E] bg-[#242220] border border-[#332F2B] rounded-xl">No active deadline delays found.</div>
                ) : (
                  escalationLogs.map((log) => (
                    <div key={log._id} className={`p-3.5 rounded-xl border bg-[#242220] flex flex-col md:flex-row justify-between gap-3 ${log.status === 'Resolved' ? 'border-[#332F2B] opacity-60' : 'border-[#C68B59]/30'}`}>
                      <div className="space-y-1 flex-1 text-xs">
                        <div className="flex items-center gap-2">
                          <span className={`text-[9px] uppercase font-mono font-bold px-1.5 py-0.5 rounded-md ${log.status === 'Resolved' ? 'bg-[#332F2B] text-[#78716C]' : 'bg-[#B54D4D]/12 text-[#E07A5F] border border-[#B54D4D]/20'}`}>{log.status}</span>
                          <h4 className="font-semibold text-[#F5F2ED] text-sm">{log.employeeName}</h4>
                        </div>
                        <p className="text-[#78716C] mt-0.5">Violation: <b className="text-[#A8A29E]">{log.violationType}</b> &nbsp;|&nbsp; Overdue: <b className="text-[#C68B59]">{log.daysOverdue} Days</b></p>
                        <div className="pt-1 flex items-center gap-1.5 text-[#78716C]">
                          <span>Chain State:</span>
                          <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-[#3D5A47]/15 text-[#6B9E7A] border border-[#3D5A47]/20">{log.notificationChainState}</span>
                        </div>
                        {log.status === 'Resolved' && <p className="text-[#6B9E7A] bg-[#1A1816] p-2.5 rounded-lg border border-[#332F2B] mt-2"><b>Resolution:</b> "{log.resolutionComment}"</p>}
                      </div>
                      {log.status === 'Active' && (
                        <div className="flex items-center gap-2 self-end md:self-center shrink-0">
                          <Input placeholder="Action resolution note..." className="bg-[#1A1816] border-[#332F2B] text-xs h-8 w-44 text-[#F5F2ED] placeholder:text-[#57534E] focus-visible:border-[#6B9E7A] focus-visible:ring-[rgba(107,158,122,0.15)]" value={resolutionText[log._id] || ''} onChange={(e) => setResolutionText({ ...resolutionText, [log._id]: e.target.value })} />
                          <Button onClick={() => handleResolveLogItem(log._id)} size="sm" className="bg-[#5B8C5A] hover:bg-[#4A7A49] text-white font-semibold h-8 text-xs shadow-warm-sm">Resolve</Button>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}