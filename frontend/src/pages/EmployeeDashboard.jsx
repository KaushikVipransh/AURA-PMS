import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";

export default function EmployeeDashboard() {
  const navigate = useNavigate();
  const [goals, setGoals] = useState([]);
  
  const [newGoal, setNewGoal] = useState({ 
    title: '', 
    thrustArea: 'Operational Excellence', 
    uom: 'Numeric', 
    target: '', 
    weightage: '' 
  });
  
  const [existingSheet, setExistingSheet] = useState(null);
  const [isCheckingIn, setIsCheckingIn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editingGoalId, setEditingGoalId] = useState(null);

  useEffect(() => {
    fetchActiveSheet();
  }, []);

  // --- HANDSHAKE LOGIC POINT A: FETCH PASSIVE/ACTIVE SLATE ---
  const fetchActiveSheet = async () => {
    try {
      const response = await fetch('https://aurapms-backend.vercel.app/api/goalsheets');
      const data = await response.json();
      
      if (data && data.length > 0) {
        const active = data[0];
        setExistingSheet(active);
        if (active.goals) setGoals(active.goals);
      } else {
        setGoals([]);
      }
      setLoading(false);
    } catch (error) {
      console.error("Error fetching sheet:", error);
      setLoading(false);
    }
  };

  const totalWeightage = goals.reduce((sum, goal) => sum + Number(goal.weightage), 0);

  const calculateOverallProgress = () => {
    if (!goals || goals.length === 0) return 0;
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

  const handleAddGoal = () => {
    const weight = Number(newGoal.weightage);
    if (goals.length >= 8) return alert("Maximum 8 goals allowed per employee profile.");
    if (weight < 10) return alert("System Validation Error: Minimum weightage per individual metric is 10%.");
    if (totalWeightage + weight > 100) return alert("System Validation Error: Combined weightage aggregate cannot exceed 100%.");
    if (!newGoal.title || !newGoal.target) return alert("Please fill out all operational fields.");

    const localId = "local-" + Date.now().toString();
    setGoals([...goals, { 
      ...newGoal, id: localId, isShared: false, actualAchievement: '0', status: 'Not Started'
    }]);
    
    setNewGoal({ 
      title: '', 
      thrustArea: 'Operational Excellence', 
      uom: 'Numeric', 
      target: '', 
      weightage: '' 
    });
  };

  const removeGoal = (id) => {
    const targetGoal = goals.find(g => (g._id === id || g.id === id));
    if (targetGoal && targetGoal.isShared) {
      return alert("🚫 Access Denied: Departmental Shared KPIs are corporate mandates.");
    }
    setGoals(goals.filter(goal => (goal._id !== id && goal.id !== id)));
    if (editingGoalId === id) setEditingGoalId(null);
  };

  const handleInlineGoalFieldChange = (index, field, value) => {
    const updated = [...goals];
    updated[index][field] = value;
    setGoals(updated);
  };

  // --- HANDSHAKE LOGIC POINT B: TRANSMIT AND LOCK SYSTEMIC TRANSACTION PAYLOAD ---
  const handleSubmitSheet = async () => {
    try {
      const isReturned = existingSheet && (existingSheet.approvalStatus === 'Returned' || existingSheet.approvalStatus === 'Pending' || existingSheet.approvalStatus === 'Unlock Requested');
      const url = isReturned 
        ? `https://aurapms-backend.vercel.app/api/goalsheets/${existingSheet._id}/resubmit`
        : 'https://aurapms-backend.vercel.app/api/goalsheets';
      
      const sanitizedGoals = goals.map(g => {
        const cleanGoal = { ...g };
        if (cleanGoal.id && cleanGoal.id.startsWith("local-")) {
          delete cleanGoal.id;
          delete cleanGoal._id;
        }
        if (!cleanGoal.actualAchievement) cleanGoal.actualAchievement = '0';
        if (!cleanGoal.status) cleanGoal.status = 'Not Started';
        return cleanGoal;
      });

      const response = await fetch(url, {
        method: isReturned ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goals: sanitizedGoals, totalWeightage })
      });
      
      if (response.ok) {
        alert('🎉 Goal Sheet locked and submitted successfully for L1 Verification Review!');
        localStorage.removeItem('atomquest_role');
        navigate('/');
      }
    } catch (error) {
      console.error(error);
    }
  };

  // --- HANDSHAKE LOGIC POINT C: UPDATE MID-QUARTER CHECK-IN DATA MATRIX ---
  const handleSaveCheckIn = async () => {
    try {
      const response = await fetch(`https://aurapms-backend.vercel.app/api/goalsheets/${existingSheet._id}/checkin`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updatedGoals: goals })
      });
      if (response.ok) {
        alert('🎉 Mid-quarter progress checkpoint matrix synchronized successfully!');
        setIsCheckingIn(false);
        fetchActiveSheet();
      }
    } catch (error) {
      alert('❌ Failed to save tracking checkpoints.');
    }
  };

  if (loading) return (
    <div className="min-h-screen bg-[#F7F5F0] flex items-center justify-center">
      <div className="text-center space-y-3 animate-fade-in">
        <div className="w-10 h-10 rounded-xl bg-[#3D5A47] flex items-center justify-center mx-auto shadow-warm-sm">
          <span className="text-[#F7F5F0] text-lg font-bold">A</span>
        </div>
        <p className="text-[#78716C] text-sm font-medium">Loading Workspace Portal...</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#F7F5F0] page-enter">
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        
        {/* Header Layout Structure */}
        <div className="dash-header">
          <div>
            <h1 className="font-display text-2xl sm:text-3xl text-[#1C1917]">My Goal Sheet</h1>
            <p className="text-[#78716C] text-sm mt-1">Draft your quarterly objectives portfolio or update operational achievements.</p>
          </div>
          <Button variant="outline" onClick={() => {
            localStorage.removeItem('atomquest_role');
            navigate('/');
          }} className="text-sm">Sign Out</Button>
        </div>

        {existingSheet && existingSheet.isLocked ? (
          <div className="space-y-6 animate-slide-up">
            {/* Progress Score Card */}
            <Card className="border-l-4 border-l-[#3D5A47]">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-semibold text-[#78716C] uppercase tracking-wider">
                  System-Computed Tracking Progress Score
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-3xl font-bold text-[#1C1917]">{calculateOverallProgress()}%</span>
                  <span className="badge-status badge-approved">Tracking Progress Matrix</span>
                </div>
                <Progress value={calculateOverallProgress()} className="h-2.5" />
              </CardContent>
            </Card>

            {/* Check-In Table Framework Component */}
            <Card className="shadow-warm">
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-lg font-semibold">Quarterly Progress Check-In</CardTitle>
                  <CardDescription className="text-xs">Log real-world achievements based on custom formula metrics arrays.</CardDescription>
                </div>
                {!isCheckingIn ? (
                  <Button onClick={() => setIsCheckingIn(true)} className="bg-[#3D5A47] hover:bg-[#4A6B55] text-white font-semibold text-xs shadow-warm-sm">
                    Update Check-In Data
                  </Button>
                ) : (
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => { setIsCheckingIn(false); fetchActiveSheet(); }}>Cancel</Button>
                    <Button onClick={handleSaveCheckIn} size="sm" className="bg-[#5B8C5A] hover:bg-[#4A7A49] text-white font-semibold shadow-warm-sm">Save Progress</Button>
                  </div>
                )}
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="overflow-x-auto rounded-lg border border-[#E8E4DD]">
                  <table className="w-full text-sm text-left table-warm">
                    <thead>
                      <tr>
                        <th className="px-5 py-3">Thrust Area / Goal</th>
                        <th className="px-5 py-3">Target Framework</th>
                        <th className="px-5 py-3">Weightage</th>
                        <th className="px-5 py-3">Actual Achievement</th>
                        <th className="px-5 py-3">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {goals.map((goal, index) => (
                        <tr key={index} className={goal.isShared ? '!bg-[rgba(198,139,89,0.04)]' : ''}>
                          <td className="px-5 py-4 font-medium text-[#1C1917] max-w-sm">
                            <span className="text-[10px] uppercase font-bold text-[#A8A29E] tracking-wider block mb-0.5">{goal.thrustArea || "General Operational"}</span>
                            <span className="block font-semibold text-[#1C1917] text-sm">{goal.title}</span>
                          </td>
                          <td className="px-5 py-4 font-medium text-[#44403C]">{goal.target} <span className="text-xs text-[#A8A29E] font-mono">({goal.uom})</span></td>
                          <td className="px-5 py-4 font-bold text-[#44403C]">{goal.weightage}%</td>
                          <td className="px-5 py-4">
                            {isCheckingIn ? (
                              goal.isShared && !goal.isPrimaryOwner ? (
                                <span className="font-medium text-[#A8A29E] italic text-xs">Auto-cascades via owner</span>
                              ) : (
                                <Input type="text" className="w-32 h-8 bg-white text-sm" value={goal.actualAchievement || ''} onChange={(e) => handleInlineGoalFieldChange(index, 'actualAchievement', e.target.value)} />
                              )
                            ) : (
                              <span className="font-bold text-[#1C1917]">{goal.actualAchievement || '0'}</span>
                            )}
                          </td>
                          <td className="px-5 py-4">
                            {isCheckingIn ? (
                              goal.isShared && !goal.isPrimaryOwner ? (
                                <span className="text-xs text-[#A8A29E] italic font-medium">{goal.status}</span>
                              ) : (
                                <select 
                                  className="select-warm h-8 w-32 text-xs font-semibold"
                                  value={goal.status || 'Not Started'}
                                  onChange={(e) => handleInlineGoalFieldChange(index, 'status', e.target.value)}
                                >
                                  <option value="Not Started">Not Started</option>
                                  <option value="On Track">On Track</option>
                                  <option value="Completed">Completed</option>
                                </select>
                              )
                            ) : (
                              <span className={`badge-status ${
                                goal.status === 'Completed' ? 'badge-completed' : 
                                goal.status === 'On Track' ? 'badge-ontrack' : 'badge-notstarted'
                              }`}>
                                {goal.status || 'Not Started'}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>
        ) : (
          <>
            {/* Weightage Validation Compliance Meter */}
            <Card className="animate-slide-up">
              <CardHeader className="pb-3"><CardTitle className="text-xs font-semibold text-[#78716C] uppercase tracking-wider">Total Weightage Metric Validation</CardTitle></CardHeader>
              <CardContent>
                <div className="flex items-center justify-between mb-2">
                  <span className={`font-bold text-sm ${totalWeightage === 100 ? 'text-[#5B8C5A]' : 'text-[#B54D4D]'}`}>{totalWeightage}% / 100% Shared Ceiling</span>
                </div>
                <Progress value={totalWeightage} className="h-2.5" />
              </CardContent>
            </Card>

            {/* Goal Builder Workplace Suite */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 animate-slide-up animate-delay-1">
              <Card className="col-span-1 border-l-4 border-l-[#3D5A47]">
                <CardHeader><CardTitle className="text-lg font-semibold">Construct Personal Goal</CardTitle></CardHeader>
                <CardContent className="space-y-4 text-sm">
                  <div className="space-y-1.5">
                    <Label className="font-semibold text-xs text-[#78716C] uppercase">Thrust Area Assignment</Label>
                    <select className="select-warm" value={newGoal.thrustArea} onChange={(e) => setNewGoal({...newGoal, thrustArea: e.target.value})}><option value="Business Growth">Business Growth</option><option value="Operational Excellence">Operational Excellence</option><option value="Technology & Innovation">Technology & Innovation</option><option value="Compliance & Risk Management">Compliance & Risk Management</option></select>
                  </div>
                  <div className="space-y-1.5"><Label className="font-semibold text-xs text-[#78716C] uppercase">Goal Metric Title</Label><Input placeholder="e.g., Optimize Uptime" value={newGoal.title} onChange={(e) => setNewGoal({...newGoal, title: e.target.value})} /></div>
                  <div className="space-y-1.5">
                    <Label className="font-semibold text-xs text-[#78716C] uppercase">Unit of Measurement (UoM)</Label>
                    <select className="select-warm" value={newGoal.uom} onChange={(e) => setNewGoal({...newGoal, uom: e.target.value})}><option value="Numeric">Numeric</option><option value="%">Percentage (%)</option><option value="Timeline">Timeline</option><option value="Zero-based">Zero-based</option></select>
                  </div>
                  <div className="space-y-1.5"><Label className="font-semibold text-xs text-[#78716C] uppercase">Target Threshold</Label><Input placeholder="e.g., 99.95" value={newGoal.target} onChange={(e) => setNewGoal({...newGoal, target: e.target.value})} /></div>
                  <div className="space-y-1.5"><Label className="font-semibold text-xs text-[#78716C] uppercase">Weightage Allocation (%)</Label><Input type="number" placeholder="Min 10%" value={newGoal.weightage} onChange={(e) => setNewGoal({...newGoal, weightage: e.target.value})} /></div>
                  <Button className="w-full mt-2" onClick={handleAddGoal} disabled={totalWeightage >= 100 || goals.length >= 8}>Inject into Portfolio List</Button>
                </CardContent>
              </Card>

              <Card className="col-span-2 shadow-warm">
                <CardHeader><CardTitle className="text-lg font-semibold">Portfolio Goal Sheet Drafting Slate</CardTitle></CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {goals.map((goal, idx) => (
                      <div key={idx} className="p-4 border border-[#E8E4DD] rounded-xl shadow-warm-sm space-y-3 bg-white hover:shadow-warm transition-shadow duration-200">
                        <div className="flex justify-between items-start">
                          <div>
                            <span className="text-[10px] uppercase font-bold text-[#3D5A47] bg-[rgba(61,90,71,0.06)] border border-[rgba(61,90,71,0.1)] px-2 py-0.5 rounded-full">{goal.thrustArea}</span>
                            <h4 className="font-semibold text-[#1C1917] text-sm block pt-1.5">{goal.title}</h4>
                          </div>
                          <Button variant="ghost" size="sm" onClick={() => removeGoal(goal._id || goal.id)} className="text-[#B54D4D] hover:text-[#B54D4D] hover:bg-[rgba(181,77,77,0.06)] h-7 text-xs">Delete</Button>
                        </div>
                        <div className="grid grid-cols-2 gap-4 text-xs bg-[#FAFAF7] p-3 rounded-lg border border-[#F0ECE4]">
                          <div className="text-[#78716C]">Target Frame: <span className="font-bold text-[#44403C]">{goal.target} ({goal.uom})</span></div>
                          <div className="text-[#78716C]">Weight: <span className="font-bold text-[#1C1917]">{goal.weightage}%</span></div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-6 pt-6 border-t border-[#E8E4DD] flex justify-end">
                    <Button size="lg" onClick={handleSubmitSheet} disabled={totalWeightage !== 100 || editingGoalId !== null} className={totalWeightage === 100 ? 'bg-[#5B8C5A] hover:bg-[#4A7A49] text-white font-semibold shadow-warm-sm' : 'bg-[#E8E4DD] text-[#A8A29E] shadow-none'}>Lock and Transmit Goal Sheet to L1</Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </div>
    </div>
  );
}