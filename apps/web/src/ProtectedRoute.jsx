import React from 'react';
import { Navigate } from 'react-router-dom';

export default function ProtectedRoute({ children, allowedRole }) {
  const currentRole = localStorage.getItem('atomquest_role');

  // If they aren't logged in, or if they have the wrong role, kick them to login
  if (!currentRole || currentRole !== allowedRole) {
    return <Navigate to="/" replace />;
  }

  // If their role matches, let them in!
  return children;
}