import React, { useState, useEffect } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";

import Register from './Pages/Auth/Register';
import Login from './Pages/Auth/Login';
import EditProfile from './Pages/Auth/EditProfile';
import ForgotPassword from './Pages/Auth/ForgotPassword';
import ResetPassword from './Pages/Auth/ResetPassword';
import ScrollToTop from './Components/ScrollToTop';
import ToastProvider from './Components/ToastProvider';

import StudentDashboard from './Pages/Student/StudentDashboard';
import MyLessons from './Pages/Student/MyLessons';
import Progress from './Pages/Student/Progress';
import Practice from './Pages/Student/Practice';
import PracticeCommonErrors from './Pages/Student/PracticeCommonErrors';

import TeacherDashboard from './Pages/Teacher/TeacherDashboard';
import Lessons from './Pages/Teacher/Lessons';
import Students from './Pages/Teacher/Students';
import Review from "./Pages/Teacher/Review";

function App() {
  const [role, setRole] = useState(() => {
    const sessionRole = sessionStorage.getItem("role");
    if (sessionRole) return sessionRole.toLowerCase();
    return null;
  });

  useEffect(() => {
    const legacyRole = localStorage.getItem("role");
    const legacyToken = localStorage.getItem("token");

    if (!sessionStorage.getItem("role") && legacyRole) {
      sessionStorage.setItem("role", legacyRole);
      setRole(legacyRole.toLowerCase());
      localStorage.removeItem("role");
    }

    if (!sessionStorage.getItem("token") && legacyToken) {
      sessionStorage.setItem("token", legacyToken);
      localStorage.removeItem("token");
    }
  }, []);
  
  useEffect(() => {
    if (role) {
      sessionStorage.setItem("role", role);
    } else {
      sessionStorage.removeItem("role");
    }
  }, [role]);

  return (
    <Router>
      <ToastProvider>
        <ScrollToTop />
        <Routes>
        {/* Auth routes */}
        <Route path="/login" element={<Login setRole={setRole} />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />

        {/* Protected routes for student */}
        {role === "student" && (
          <>
            <Route path="/" element={<StudentDashboard role={role} />} />
            <Route path="/my-lessons" element={<MyLessons role={role} />} />
            <Route path="/practice" element={<Practice role={role} />} />
            <Route path="/practice/common-errors" element={<PracticeCommonErrors role={role} />} />
            <Route path="/progress" element={<Progress role={role} />} />
            <Route path="/profile" element={<EditProfile role={role} />} />
          </>
        )}

        {/* Protected routes for teacher */}
        {role === "teacher" && (
          <>
            <Route path="/" element={<TeacherDashboard role={role} />} />
            <Route path="/lessons" element={<Lessons role={role} />} />
            <Route path="/students" element={<Students role={role} />} />
            <Route path="/review" element={<Review role={role} />} />
            <Route path="/profile" element={<EditProfile role={role} />} />
          </>
        )}

        {/* Redirect any unknown path */}
        <Route path="*" element={<Navigate to={role ? "/" : "/login"} replace />} />
        </Routes>
      </ToastProvider>
    </Router>
  );
}

export default App;
