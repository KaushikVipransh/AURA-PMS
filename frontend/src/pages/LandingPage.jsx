import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function LandingPage() {
  const navigate = useNavigate();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handlePersonaLogin = (role) => {
    setDropdownOpen(false);
    if (role === 'Employee') {
      localStorage.setItem('atomquest_role', 'employee');
      navigate('/employee-dashboard');
    } else if (role === 'Manager') {
      localStorage.setItem('atomquest_role', 'manager');
      navigate('/manager-workspace');
    } else if (role === 'Admin') {
      localStorage.setItem('atomquest_role', 'admin');
      navigate('/admin-panel');
    }
  };

  return (
    <div className="min-h-screen bg-[#F7F5F0] font-sans antialiased text-[#1C1917]">

      {/* HEADER */}
      <header className="sticky top-0 z-50 bg-[#F7F5F0]/85 backdrop-blur-xl border-b border-[#E8E4DD]">
        <div className="max-w-7xl mx-auto px-6 h-[72px] flex items-center justify-between">
          <div className="flex items-center gap-3 cursor-pointer group" onClick={() => navigate('/')}>
            <div className="w-10 h-10 rounded-xl bg-[#3D5A47] flex items-center justify-center shadow-warm-sm group-hover:shadow-warm transition-shadow duration-200">
              <span className="text-[#F7F5F0] text-lg font-bold">A</span>
            </div>
            <span className="text-xl font-bold tracking-tight text-[#1C1917]">AuraPMS</span>
          </div>

          <div className="relative" ref={dropdownRef}>
            <Button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="bg-[#3D5A47] hover:bg-[#4A6B55] text-[#F7F5F0] font-semibold rounded-xl px-5 h-10 shadow-warm-sm hover:shadow-warm flex items-center gap-2"
            >
              Secure Login
              <svg className={`w-3.5 h-3.5 transition-transform duration-200 ${dropdownOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
            </Button>

            {dropdownOpen && (
              <div className="absolute right-0 mt-2 w-60 rounded-xl bg-white border border-[#E8E4DD] p-1.5 shadow-warm-lg animate-slide-down z-50">
                <div className="px-3 py-2 text-[10px] font-bold text-[#A8A29E] uppercase tracking-wider border-b border-[#F0ECE4] mb-1">Select Portal Role</div>
                <button onClick={() => handlePersonaLogin('Employee')} className="w-full text-left px-3 py-2.5 text-sm font-medium rounded-lg text-[#44403C] hover:bg-[#F0ECE4] hover:text-[#3D5A47] transition-colors flex items-center gap-2.5">
                  <span className="w-7 h-7 rounded-lg bg-[#F0ECE4] flex items-center justify-center text-xs">👤</span> Login as Employee
                </button>
                <button onClick={() => handlePersonaLogin('Manager')} className="w-full text-left px-3 py-2.5 text-sm font-medium rounded-lg text-[#44403C] hover:bg-[#F0ECE4] hover:text-[#3D5A47] transition-colors flex items-center gap-2.5">
                  <span className="w-7 h-7 rounded-lg bg-[#F0ECE4] flex items-center justify-center text-xs">👥</span> Login as Manager
                </button>
                <button onClick={() => handlePersonaLogin('Admin')} className="w-full text-left px-3 py-2.5 text-sm font-medium rounded-lg text-[#44403C] hover:bg-[#1C1917] hover:text-white transition-colors flex items-center gap-2.5">
                  <span className="w-7 h-7 rounded-lg bg-[#F0ECE4] flex items-center justify-center text-xs">🛡️</span> Login as HR / Admin
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* HERO */}
      <main className="max-w-7xl mx-auto px-6 pt-20 pb-24 grid grid-cols-1 lg:grid-cols-12 gap-16 items-center">
        <div className="lg:col-span-7 space-y-7 text-center lg:text-left animate-slide-up">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[rgba(61,90,71,0.06)] border border-[rgba(61,90,71,0.12)] text-xs font-semibold text-[#3D5A47]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#3D5A47] animate-pulse"></span>
            Enterprise Performance Management Suite
          </div>
          <h1 className="font-display text-4xl sm:text-5xl lg:text-[3.5rem] text-[#1C1917] leading-[1.12]">
            Evolve Your Performance. <br />
            <span className="text-[#3D5A47]">Align Your Enterprise.</span>
          </h1>
          <p className="text-[#78716C] text-base sm:text-lg max-w-xl mx-auto lg:mx-0 leading-relaxed">
            Unlock potential. Direct achievement. A seamless Performance Management System
            engineered for modern corporate alignment, rule-based auditing, and precise scorecard analytics.
          </p>
          <div className="flex flex-wrap gap-3 justify-center lg:justify-start pt-1">
            <Button onClick={() => setDropdownOpen(true)} className="h-11 px-6 text-sm">Get Started →</Button>
          </div>
        </div>

        {/* Terminal Graphic */}
        <div className="lg:col-span-5 relative flex justify-center animate-slide-up animate-delay-2">
          <div className="w-full max-w-[400px] aspect-square rounded-2xl bg-[#1C1917] p-7 shadow-warm-lg relative overflow-hidden border border-[#332F2B]">
            <div className="absolute -top-16 -right-16 w-48 h-48 rounded-full bg-[#3D5A47]/8 blur-3xl"></div>
            <div className="absolute -bottom-12 -left-12 w-36 h-36 rounded-full bg-[#C68B59]/6 blur-3xl"></div>
            <div className="h-full w-full border border-[#332F2B] rounded-xl p-5 flex flex-col justify-between bg-[#242220]/50">
              <div className="flex items-center justify-between border-b border-[#332F2B] pb-3.5">
                <span className="text-[10px] font-mono tracking-widest text-[#78716C] uppercase font-bold">System Status</span>
                <span className="w-2 h-2 rounded-full bg-[#6B9E7A] animate-pulse"></span>
              </div>
              <div className="space-y-3.5 my-auto py-4">
                <div className="h-1.5 w-1/4 bg-[#332F2B] rounded-full"></div>
                <div className="h-7 w-full bg-gradient-to-r from-[#3D5A47]/15 to-transparent border-l-2 border-[#6B9E7A] rounded-r flex items-center px-3 text-[10px] font-mono text-[#6B9E7A] font-semibold">&gt; Aggregating multi-formula scorecards...</div>
                <div className="h-1.5 w-3/5 bg-[#332F2B] rounded-full"></div>
                <div className="h-7 w-4/5 bg-gradient-to-r from-[#C68B59]/10 to-transparent border-l-2 border-[#C68B59]/50 rounded-r flex items-center px-3 text-[10px] font-mono text-[#C68B59] font-semibold">&gt; Compliance interval: verified</div>
                <div className="h-1.5 w-2/5 bg-[#332F2B] rounded-full"></div>
              </div>
              <div className="pt-3.5 border-t border-[#332F2B] flex justify-between items-center text-[10px] font-mono text-[#57534E] font-semibold">
                <span>KPI CASCADER: ACTIVE</span>
                <span className="text-[#6B9E7A]">v3.0.26</span>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* FEATURES */}
      <section className="bg-white border-y border-[#E8E4DD] py-14">
        <div className="max-w-7xl mx-auto px-6 grid grid-cols-1 md:grid-cols-3 gap-8">
          {[
            { icon: '🎯', title: 'Aligned Objectives', desc: 'Enforce strict systemic constraints ensuring combined goal weightages equal exactly 100% ceiling allocations.', color: '61,90,71' },
            { icon: '📊', title: 'Real-time Tracking', desc: 'Dynamic mathematical progress calculation engines mapping Min, Max (inverse), and Zero-based target parameters.', color: '198,139,89' },
            { icon: '🔄', title: 'Seamless Feedback Loops', desc: 'Cascading shared departmental KPIs combined with a structured conversation logger for mid-quarter check-ins.', color: '91,140,90' },
          ].map((f, i) => (
            <div key={i} className={`flex items-start gap-4 p-5 rounded-xl hover:bg-[#FAFAF7] transition-colors duration-200 animate-slide-up animate-delay-${i + 1}`}>
              <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 text-lg`} style={{ background: `rgba(${f.color},0.07)`, border: `1px solid rgba(${f.color},0.12)` }}>{f.icon}</div>
              <div>
                <h3 className="font-semibold text-[#1C1917] text-sm">{f.title}</h3>
                <p className="text-[#78716C] text-xs mt-1.5 leading-relaxed">{f.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* PERSONA CARDS */}
      <section className="max-w-7xl mx-auto px-6 py-24 space-y-12">
        <div className="text-center max-w-lg mx-auto space-y-3">
          <h2 className="font-display text-3xl text-[#1C1917]">Persona Quick Access</h2>
          <p className="text-[#78716C] text-sm leading-relaxed">Select your organizational profile to log into your specialized dashboard environment.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          <Card className="bg-white border-[#E8E4DD] hover:border-[#3D5A47]/25 hover:shadow-warm-md transition-all duration-300 group flex flex-col justify-between animate-slide-up animate-delay-1">
            <CardHeader className="pb-4">
              <div className="w-11 h-11 rounded-xl bg-[rgba(61,90,71,0.07)] border border-[rgba(61,90,71,0.1)] text-lg flex items-center justify-center mb-3 group-hover:scale-105 transition-transform">👤</div>
              <CardTitle className="text-lg text-[#1C1917] font-semibold">Employee Workspace</CardTitle>
              <CardDescription className="text-xs leading-relaxed">Draft goals, modify corporate shared metric allocations, and enter active mid-quarter actual performance achievements.</CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <Button onClick={() => handlePersonaLogin('Employee')} variant="outline" className="w-full group-hover:bg-[rgba(61,90,71,0.04)] group-hover:border-[#3D5A47]/20 group-hover:text-[#3D5A47] font-semibold text-xs h-9">Access Employee Dashboard →</Button>
            </CardContent>
          </Card>

          <Card className="bg-white border-[#E8E4DD] hover:border-[#C68B59]/25 hover:shadow-warm-md transition-all duration-300 group flex flex-col justify-between animate-slide-up animate-delay-2">
            <CardHeader className="pb-4">
              <div className="w-11 h-11 rounded-xl bg-[rgba(198,139,89,0.08)] border border-[rgba(198,139,89,0.12)] text-lg flex items-center justify-center mb-3 group-hover:scale-105 transition-transform">👥</div>
              <CardTitle className="text-lg text-[#1C1917] font-semibold">Manager L1 Suite</CardTitle>
              <CardDescription className="text-xs leading-relaxed">Review submitted team profiles, perform inline weight corrections, sign off approvals, and log structured check-in alignment summaries.</CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <Button onClick={() => handlePersonaLogin('Manager')} variant="outline" className="w-full group-hover:bg-[rgba(198,139,89,0.04)] group-hover:border-[#C68B59]/20 group-hover:text-[#C68B59] font-semibold text-xs h-9">Access Manager Console →</Button>
            </CardContent>
          </Card>

          <Card className="bg-[#1C1917] border-[#332F2B] hover:border-[#57534E] shadow-warm-md transition-all duration-300 sm:col-span-2 lg:col-span-1 group flex flex-col justify-between animate-slide-up animate-delay-3">
            <CardHeader className="pb-4">
              <div className="w-11 h-11 rounded-xl bg-[#242220] border border-[#332F2B] text-white text-lg flex items-center justify-center mb-3 group-hover:scale-105 transition-transform">🛡️</div>
              <CardTitle className="text-lg text-[#F5F2ED] font-semibold">HR Governance & Admin</CardTitle>
              <CardDescription className="text-xs text-[#78716C] leading-relaxed">Execute rule-based timeline escalation checkers, view global distribution heatmaps, download Excel/CSV asset reports, and deploy force-unlock overrides.</CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <Button onClick={() => handlePersonaLogin('Admin')} className="w-full bg-[#242220] hover:bg-[#332F2B] border border-[#332F2B] text-[#A8A29E] hover:text-[#F5F2ED] font-semibold text-xs h-9 shadow-none">Access L3 Compliance Board →</Button>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-[#E8E4DD] bg-white py-8 text-center">
        <div className="max-w-7xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <span className="text-xs text-[#A8A29E] font-medium">© 2026 AuraPMS Enterprise Solutions Inc. All tracking structures certified.</span>
          <div className="flex gap-6 text-xs font-medium text-[#78716C]">
            <span className="hover:text-[#3D5A47] transition-colors cursor-pointer">Security Architecture</span>
            <span className="hover:text-[#3D5A47] transition-colors cursor-pointer">Compliance Auditing</span>
            <span className="hover:text-[#3D5A47] transition-colors cursor-pointer">System Logs</span>
          </div>
        </div>
      </footer>
    </div>
  );
}