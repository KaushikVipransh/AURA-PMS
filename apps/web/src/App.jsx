import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import LandingPage from './pages/LandingPage';
import EmployeeDashboard from './pages/EmployeeDashboard';
import ManagerWorkspace from './pages/ManagerWorkspace';
import AdminPanel from './pages/AdminPanel';
import ProtectedRoute from './ProtectedRoute'; // <-- Import the guard

function App() {
  return (
    <Router>
      <Routes>
        {/* Public Route (Login) */}
        <Route path="/" element={<LandingPage />} />

        {/* Protected Employee Route */}
        <Route 
          path="/employee-dashboard" 
          element={
            <ProtectedRoute allowedRole="employee">
              <EmployeeDashboard />
            </ProtectedRoute>
          } 
        />

        {/* Protected Manager Route */}
        <Route 
          path="/manager-workspace" 
          element={
            <ProtectedRoute allowedRole="manager">
              <ManagerWorkspace />
            </ProtectedRoute>
          } 
        />

        {/* Protected Admin Route */}
        <Route 
          path="/admin-panel" 
          element={
            <ProtectedRoute allowedRole="admin">
              <AdminPanel />
            </ProtectedRoute>
          } 
        />
      </Routes>
    </Router>
  );
}

export default App;