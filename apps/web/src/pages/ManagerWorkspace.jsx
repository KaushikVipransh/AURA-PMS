import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";

export default function ManagerWorkspace() {
  const navigate = useNavigate();
  const [goalSheets, setGoalSheets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingSheetId, setEditingSheetId] = useState(null);
  const [discussionInputs, setDiscussionInputs] = useState({}); 

  const [sharedKpi, setSharedKpi] = useState({
    title: '', 
    uom: 'Numeric', 
    target: '', 
    defaultWeightage: '15', 
    primaryOwnerName: ''
  });

  useEffect(() => {
    fetchGoalSheets();
  }, []);

  // --- HANDSHAKE LOGIC POINT A: FETCH ABSOLUTE ENTERPRISE SHEETS ---
  const fetchGoalSheets = async () => {
    try {
      const response = await fetch('https://aurapms-backend.vercel.app/api/goalsheets');
      const data = await response.json();
      setGoalSheets(Array.isArray(data) ? data : []);
      
      if (data && data.length > 0) {
        setSharedKpi(prev => ({ ...prev, primaryOwnerName: data[0].employeeName }));
      }
      
      setLoading(false);
    } catch (error) {
      console.error("Failed to fetch goal sheets:", error);
      setLoading(false);
    }
  };

  const calculateSheetProgress = (goals) => {
    if (!goals || !Array.isArray(goals) || goals.length === 0) return 0;
    let totalScore = 0;
    
    goals.forEach(goal => {
      const actual = Number(goal.actualAchievement) || 0;
      const target = Number(goal.target) || 1;
      const weight = Number(goal.weightage) || 0;
      const uom = goal.uom || 'Numeric';
      
      let progressFraction = 0;

      if (uom === 'Zero-based') {
        progressFraction = actual === 0 ? 1 : 0;
      } else if (uom === 'Timeline') {
        progressFraction = goal.status === 'Completed' ? 1 : goal.status === 'On Track' ? 0.5 : 0;
      } else if (goal.title.toLowerCase().includes('tat') || goal.title.toLowerCase().includes('cost') || goal.title.toLowerCase().includes('reduction')) {
        progressFraction = actual > 0 ? (target / actual) : 0;
      } else {
        progressFraction = actual / target;
      }

      const cappedProgress = Math.min(Math.max(progressFraction, 0), 1);
      totalScore += cappedProgress * weight;
    });
    
    return Math.round(totalScore);
  };

  // --- HANDSHAKE LOGIC POINT B: TRANSMIT MANDATORY CASCADE BROADCAST ---
  const handlePushSharedGoal = async () => {
    if (!sharedKpi.title || !sharedKpi.target || !sharedKpi.primaryOwnerName) {
      return alert("Please ensure Title, Target, and a valid Primary Sync Owner are selected before broadcasting.");
    }
    try {
      const response = await fetch('https://aurapms-backend.vercel.app/api/goalsheets/push-shared', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...sharedKpi, sharedGoalId: "cluster-" + Date.now().toString() })
      });
      if (response.ok) {
        alert(`🎉 CORPORATE BROADCAST COMPLETED:\nMandatory KPI successfully linked and synchronized with ${sharedKpi.primaryOwnerName} as the primary sync driver!`);
        setSharedKpi({ title: '', uom: 'Numeric', target: '', defaultWeightage: '15', primaryOwnerName: goalSheets[0]?.employeeName || '' });
        fetchGoalSheets();
      }
    } catch (error) {
      console.error(error);
    }
  };

  // --- HANDSHAKE LOGIC POINT C: SIGN OFF AND FREEZE PROFILE ---
  const handleApprove = async (sheetId) => {
    try {
      const response = await fetch(`https://aurapms-backend.vercel.app/api/goalsheets/${sheetId}/approve`, { method: 'PUT' });
      if (response.ok) {
        alert('✅ Goal Sheet Approved and Locked System-Wide!');
        fetchGoalSheets();
      }
    } catch (error) {
      console.error(error);
    }
  };

  // --- HANDSHAKE LOGIC POINT D: TRIGGER STRUCTURAL ROLLBACK ---
  const handleRework = async (sheetId) => {
    try {
      const response = await fetch(`https://aurapms-backend.vercel.app/api/goalsheets/${sheetId}/rework`, { method: 'PUT' });
      if (response.ok) {
        alert('Sheet successfully returned to employee tracking queue.');
        fetchGoalSheets();
      }
    } catch (error) {
      console.error(error);
    }
  };

  // --- HANDSHAKE LOGIC POINT E: WRITE DIALOGUE COMMENT NARRATIVE ---
  const handlePostDiscussionNote = async (sheetId) => {
    const textEntry = discussionInputs[sheetId];
    if (!textEntry || !textEntry.trim()) return alert("Please type a check-in comment to document the discussion.");

    try {
      const response = await fetch(`https://aurapms-backend.vercel.app/api/goalsheets/${sheetId}/discussion`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checkInComment: textEntry })
      });
      if (response.ok) {
        alert("💬 Check-In Discussion Comment appended successfully!");
        setDiscussionInputs({ ...discussionInputs, [sheetId]: '' });
        fetchGoalSheets();
      }
    } catch (error) {
      console.error(error);
    }
  };

  const uniqueEmployeesList = Array.from(new Set(goalSheets.map(s => s.employeeName)));

  return (
    <div className="min-h-screen bg-[#F7F5F0] page-enter">
      <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        
        {/* Header */}
        <div className="dash-header">
          <div>
            <h1 className="font-display text-2xl sm:text-3xl text-[#1C1917]">Manager Workspace</h1>
            <p className="text-[#78716C] text-sm mt-1">View performance metrics and log global mid-quarter check-in discussions.</p>
          </div>
          <Button variant="outline" onClick={() => {
            localStorage.removeItem('atomquest_role');
            navigate('/');
          }} className="text-sm">Sign Out</Button>
        </div>

        {/* Main Layout Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* LEFT SIDEBAR: CORPORATE BROADCAST MODIFIER */}
          <div className="col-span-1 space-y-1 animate-slide-up">
            <Card className="border-l-4 border-l-[#C68B59]">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold text-[#1C1917]">Deploy Departmental KPI</CardTitle>
                <CardDescription className="text-[11px] text-[#A8A29E] leading-tight">Broadcast mandatory linked operational frameworks across team sets.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3.5 text-xs">
                <div>
                  <Label className="font-semibold text-[#78716C] text-xs">Goal Title</Label>
                  <Input className="mt-1 h-9" placeholder="e.g., Optimize Infrastructure Security" value={sharedKpi.title} onChange={(e) => setSharedKpi({...sharedKpi, title: e.target.value})} />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="font-semibold text-[#78716C] text-xs">Target Value</Label>
                    <Input className="mt-1 h-9" placeholder="e.g., 100" value={sharedKpi.target} onChange={(e) => setSharedKpi({...sharedKpi, target: e.target.value})} />
                  </div>
                  <div>
                    <Label className="font-semibold text-[#78716C] text-xs">Measure Unit</Label>
                    <select 
                      className="select-warm h-9 text-xs mt-1"
                      value={sharedKpi.uom} 
                      onChange={(e) => setSharedKpi({...sharedKpi, uom: e.target.value})}
                    >
                      <option value="Numeric">Numeric</option>
                      <option value="%">Percentage (%)</option>
                      <option value="Timeline">Timeline</option>
                      <option value="Zero-based">Zero-based</option>
                    </select>
                  </div>
                </div>

                <div>
                  <Label className="font-semibold text-[#78716C] text-xs">Default Weightage (%)</Label>
                  <Input type="number" className="mt-1 h-9" value={sharedKpi.defaultWeightage} onChange={(e) => setSharedKpi({...sharedKpi, defaultWeightage: e.target.value})} />
                </div>

                <div>
                  <Label className="font-semibold text-[#78716C] text-xs">Primary Sync Owner Profile</Label>
                  <select 
                    className="select-warm h-9 text-xs font-semibold text-[#1C1917] mt-1"
                    value={sharedKpi.primaryOwnerName}
                    onChange={(e) => setSharedKpi({...sharedKpi, primaryOwnerName: e.target.value})}
                  >
                    {uniqueEmployeesList.length === 0 ? (
                      <option value="">No active profiles loaded</option>
                    ) : (
                      uniqueEmployeesList.map((empName, eIdx) => (
                        <option key={eIdx} value={empName}>{empName}</option>
                      ))
                    )}
                  </select>
                </div>

                <Button className="w-full bg-[#C68B59] hover:bg-[#B57A48] text-white font-semibold h-9 shadow-warm-sm mt-1" onClick={handlePushSharedGoal}>
                  Broadcast Shared Goal
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* RIGHT VIEW: REVIEW QUEUE METRICS ARRAYS */}
          <div className="lg:col-span-2 space-y-4">
            {loading ? (
              <div className="text-center py-12 animate-fade-in">
                <p className="text-[#78716C] text-sm">Scanning organization records...</p>
              </div>
            ) : goalSheets.length === 0 ? (
              <div className="text-center py-16 text-[#A8A29E] border border-dashed border-[#E8E4DD] rounded-xl bg-white text-sm">
                No operational employee goal sheets found in database stack.
              </div>
            ) : (
              goalSheets.map((sheet, sIdx) => (
                <Card key={sheet._id} className={`border-l-4 shadow-warm animate-slide-up ${
                  sheet.approvalStatus === 'Approved' ? 'border-l-[#5B8C5A]' :
                  sheet.approvalStatus === 'Returned' ? 'border-l-[#B54D4D]' : 'border-l-[#C68B59]'
                }`} style={{ animationDelay: `${sIdx * 80}ms` }}>
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle className="text-lg font-semibold text-[#1C1917]">{sheet.employeeName}'s Goal Sheet</CardTitle>
                        <CardDescription className="text-xs font-mono text-[#A8A29E] mt-0.5">Active Window Phase: {sheet.quarter}</CardDescription>
                      </div>
                      <span className={`badge-status ${
                        sheet.approvalStatus === 'Approved' ? 'badge-approved' :
                        sheet.approvalStatus === 'Returned' ? 'badge-returned' : 'badge-pending'
                      }`}>{sheet.approvalStatus}</span>
                    </div>
                  </CardHeader>
                  
                  <CardContent className="space-y-4">
                    {sheet.approvalStatus === 'Approved' && (
                      <div className="p-3.5 bg-[#FAFAF7] rounded-lg border border-[#F0ECE4] text-xs">
                        <div className="flex justify-between font-semibold text-[#44403C]">
                          <span>Computed Progress Tracker Matrix:</span>
                          <span className="text-[#1C1917] text-sm font-bold">{calculateSheetProgress(sheet.goals)}%</span>
                        </div>
                        <Progress value={calculateSheetProgress(sheet.goals)} className="h-2 mt-2" />
                      </div>
                    )}

                    <div className="rounded-lg p-3 space-y-2.5 border border-[#E8E4DD] bg-[#FAFAF7]">
                      {(sheet.goals || []).map((goal, gIdx) => (
                        <div key={gIdx} className={`p-3.5 border rounded-lg text-xs bg-white transition-shadow hover:shadow-warm-sm ${goal.isShared ? 'border-l-4 border-l-[#C68B59]' : 'border-[#E8E4DD]'}`}>
                          <div className="flex justify-between font-semibold text-[#1C1917] mb-1.5">
                            <div>
                              <span className="text-[10px] text-[#A8A29E] block tracking-wider uppercase font-bold">{goal.thrustArea || "Operational Execution"}</span>
                              <span className="text-sm font-semibold text-[#1C1917] mt-0.5 block">{goal.title}</span>
                            </div>
                            <span className="bg-[#F0ECE4] h-fit px-2.5 py-0.5 rounded-md text-[#44403C] font-mono text-[10px] font-bold">Weight: {goal.weightage}%</span>
                          </div>
                          
                          <div className="grid grid-cols-3 gap-2 bg-[#FAFAF7] p-2.5 rounded-lg text-[#78716C] font-medium border border-[#F0ECE4]">
                            <div>Target: <b className="text-[#44403C]">{goal.target} <span className="text-[10px] text-[#A8A29E]">({goal.uom})</span></b></div>
                            <div>Actual: <b className="text-[#1C1917]">{goal.actualAchievement || '0'}</b></div>
                            <div>Status: <span className={`font-semibold ${goal.status === 'Completed' ? 'text-[#5B8C5A]' : goal.status === 'On Track' ? 'text-[#3D5A47]' : 'text-[#78716C]'}`}>{goal.status || 'Not Started'}</span></div>
                          </div>
                        </div>
                      ))}
                    </div>

                    {sheet.approvalStatus === 'Pending' && (
                      <div className="flex justify-end gap-2.5 pt-2 border-t border-[#E8E4DD]">
                        <Button variant="outline" size="sm" className="text-[#B54D4D] hover:bg-[rgba(181,77,77,0.05)] border-[#E8E4DD] font-semibold" onClick={() => handleRework(sheet._id)}>Return for Rework</Button>
                        <Button size="sm" className="bg-[#5B8C5A] hover:bg-[#4A7A49] text-white font-semibold shadow-warm-sm" onClick={() => handleApprove(sheet._id)}>Approve & Lock Goals</Button>
                      </div>
                    )}

                    {sheet.approvalStatus === 'Approved' && (
                      <div className="border-t border-[#E8E4DD] pt-3.5 space-y-3">
                        <Label className="text-xs font-bold uppercase tracking-wider text-[#A8A29E]">Add Structured Check-In Comment</Label>
                        <div className="flex gap-2">
                          <textarea 
                            className="flex-1 h-14 p-2.5 text-xs bg-white border border-[#E8E4DD] rounded-lg focus:outline-none focus:border-[#3D5A47] focus:ring-2 focus:ring-[rgba(61,90,71,0.1)] resize-none text-[#1C1917] placeholder:text-[#A8A29E] transition-all" 
                            placeholder="Document performance alignments, appraisal notes, or meeting summaries..." 
                            value={discussionInputs[sheet._id] || ''} 
                            onChange={(e) => setDiscussionInputs({ ...discussionInputs, [sheet._id]: e.target.value })} 
                          />
                          <Button size="sm" className="bg-[#1C1917] hover:bg-[#332F2B] text-white font-semibold h-14 px-4 shadow-warm-sm" onClick={() => handlePostDiscussionNote(sheet._id)}>Log Comment</Button>
                        </div>

                        {/* Continuous Dialogue Discussion Log History */}
                        {sheet.checkInDiscussions && sheet.checkInDiscussions.length > 0 && (
                          <div className="mt-2 space-y-1.5 max-h-44 overflow-y-auto rounded-lg border border-[#F0ECE4] bg-[#FAFAF7] p-3">
                            <span className="text-[10px] uppercase font-bold tracking-wider text-[#A8A29E] block mb-2">Discussion History ({sheet.checkInDiscussions.length})</span>
                            {sheet.checkInDiscussions.map((entry, dIdx) => (
                              <div key={dIdx} className="p-2.5 bg-white border border-[#E8E4DD] rounded-lg text-xs flex items-start gap-2.5">
                                <div className="w-6 h-6 rounded-md bg-[rgba(61,90,71,0.07)] border border-[rgba(61,90,71,0.1)] flex items-center justify-center shrink-0 text-[10px] font-bold text-[#3D5A47]">
                                  {dIdx + 1}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-[#1C1917] font-medium leading-relaxed break-words">{entry.comment}</p>
                                  <span className="text-[10px] text-[#A8A29E] font-mono mt-1 block">
                                    {new Date(entry.timestamp).toLocaleString()}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                  </CardContent>
                </Card>
              ))
            )}
          </div>

        </div>
      </div>
    </div>
  );
}