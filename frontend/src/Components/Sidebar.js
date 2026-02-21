import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import './Sidebar.css';
import Profile from './Profile';
import Icon from './Icons';

const API_ORIGIN = process.env.REACT_APP_API_ORIGIN || 'http://localhost:5144';
const API_BASE = `${API_ORIGIN}/api/auth/me`;

function Sidebar({ role = 'student' }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState('');
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    const stored = localStorage.getItem('sidebarCollapsed');
    return stored === 'true';
  });

  const linksByRole = {
    student: [
      { name: 'Dashboard', icon: <Icon.Dashboard />, path: '/' },
      { name: 'My Lessons', icon: <Icon.Book />, path: '/my-lessons' },
      { name: 'Practice', icon: <Icon.Practice />, path: '/practice' },
      { name: 'Progress', icon: <Icon.ChartLine />, path: '/progress' },
    ],
    teacher: [
      { name: 'Dashboard', icon: <Icon.Dashboard />, path: '/' },
      { name: 'Lessons', icon: <Icon.Book />, path: '/lessons' },
      { name: 'Students', icon: <Icon.Users />, path: '/students' },
      { name: 'Review', icon: <Icon.Review />, path: '/review' },
    ],
  };

  const links = linksByRole[role] || [];
  const initials = fullName ? fullName.trim().charAt(0).toUpperCase() : '?';

  const isActive = (path) =>
    path === '/' ? location.pathname === '/' : location.pathname === path || location.pathname.startsWith(`${path}/`);

  useEffect(() => {
    const token = sessionStorage.getItem('token');
    if (!token) return;

    const fetchProfile = async () => {
      try {
        const res = await fetch(API_BASE, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!res.ok) {
          const errorText = await res.text();
          throw new Error(errorText || 'Failed to load profile.');
        }

        const data = await res.json();
        setFullName(data.fullName || data.FullName || '');
      } catch (err) {
        console.error(err);
        setError('Profile unavailable');
      }
    };

    fetchProfile();
  }, []);

  const handleSignOut = () => {
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('role');
    navigate('/login');
  };

  const handleEditProfile = () => {
    navigate('/profile');
  };

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem('sidebarCollapsed', String(next));
      return next;
    });
  };

  return (
    <div className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-header">
        <Link to="/" className="logo-link">
          <img src="/images/EsolAI.png" alt="EsolAI Logo" className="logo" />
        </Link>
      </div>

      <div className="nav-container">
        <div className="nav">
          {links.map((link, idx) => (
            <Link
              to={link.path}
              key={idx}
              className={`nav-link ${isActive(link.path) ? 'active' : ''}`}
              title={collapsed ? link.name : undefined}
            >
              <span className="icon">{link.icon}</span>
              <span className="link-text">{link.name}</span>
            </Link>
          ))}
        </div>
      </div>

      <div className="sidebar-footer">
        <Profile
          name={fullName || error || 'Unknown User'}
          initials={initials}
          onEditProfile={handleEditProfile}
          onSignOut={handleSignOut}
          variant="footer"
        />
      </div>

      <button
        type="button"
        className="collapse-btn collapse-mid"
        onClick={toggleCollapsed}
        aria-label="Toggle sidebar"
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed ? <Icon.ChevronRight /> : <Icon.ChevronLeft />}
      </button>

    </div>
  );
}

export default Sidebar;
