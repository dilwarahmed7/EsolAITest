import React, { useEffect, useState } from 'react';
import PageLayout from '../../Components/PageLayout';
import './EditProfile.css';

function EditProfile({ role }) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [age, setAge] = useState('');
  const [firstLanguage, setFirstLanguage] = useState('');
  const [level, setLevel] = useState('');
  const [status, setStatus] = useState({ type: '', message: '' });
  const [showPasswordFields, setShowPasswordFields] = useState(false);
  const [passwords, setPasswords] = useState({
    current: '',
    next: '',
    confirm: '',
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const token = sessionStorage.getItem('token');
    if (!token) {
      setStatus({ type: 'error', message: 'No token found. Please log in again.' });
      return;
    }

    const loadProfile = async () => {
      setLoading(true);
      try {
        const res = await fetch('http://localhost:5144/api/auth/me', {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!res.ok) {
          const errorText = await res.text();
          throw new Error(errorText || 'Unable to load profile.');
        }

        const data = await res.json();
        setFullName(data.fullName || data.FullName || '');
        setEmail(data.email || data.Email || '');
        if (role === 'student') {
          setAge(data.age ?? '');
          setFirstLanguage(data.firstLanguage || data.FirstLanguage || '');
          setLevel(data.level || data.Level || '');
        }
        setStatus({ type: '', message: '' });
      } catch (err) {
        console.error(err);
        setStatus({ type: 'error', message: 'Unable to load profile.' });
      } finally {
        setLoading(false);
      }
    };

    loadProfile();
  }, [role]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setStatus({ type: '', message: '' });

    const token = sessionStorage.getItem('token');
    if (!token) {
      setStatus({ type: 'error', message: 'No token found. Please log in again.' });
      return;
    }

    try {
      setLoading(true);
      const messages = [];

      const profileRes = await fetch('http://localhost:5144/api/auth/me', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          fullName,
          age: role === 'student' ? Number(age) || undefined : undefined,
          firstLanguage: role === 'student' ? firstLanguage : undefined,
          level: role === 'student' ? level : undefined,
        }),
      });

      if (!profileRes.ok) {
        const errorText = await profileRes.text();
        throw new Error(errorText || 'Failed to update profile.');
      }

      const profileData = await profileRes.json();
      setFullName(profileData.fullName || profileData.FullName || fullName);
      messages.push('Profile updated.');

      const wantsPasswordChange =
        showPasswordFields || passwords.current || passwords.next || passwords.confirm;

      if (wantsPasswordChange) {
        if (!passwords.current || !passwords.next || !passwords.confirm) {
          setStatus({ type: 'error', message: 'Please complete all password fields.' });
          setLoading(false);
          return;
        }
        if (passwords.next !== passwords.confirm) {
          setStatus({ type: 'error', message: 'New passwords do not match.' });
          setLoading(false);
          return;
        }
        if (passwords.next === passwords.current) {
          setStatus({ type: 'error', message: 'New password cannot match current password.' });
          setLoading(false);
          return;
        }

        const passRes = await fetch('http://localhost:5144/api/auth/change-password', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            currentPassword: passwords.current,
            newPassword: passwords.next,
            confirmPassword: passwords.confirm,
          }),
        });

        if (!passRes.ok) {
          const errorText = await passRes.text();
          throw new Error(errorText || 'Failed to update password.');
        }

        messages.push('Password updated.');
        setPasswords({ current: '', next: '', confirm: '' });
        setShowPasswordFields(false);
      }

      setStatus({ type: 'success', message: messages.join(' ') });
    } catch (err) {
      console.error(err);
      setStatus({ type: 'error', message: err.message || 'Failed to save changes.' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <PageLayout title="Edit Profile" role={role}>
      <div className="edit-profile-page">
        <div className="edit-profile">
          <form className="edit-profile__form" onSubmit={handleSubmit}>
            <div className="edit-profile__field">
              <label htmlFor="fullName">Full Name</label>
              <input
                id="fullName"
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Enter your full name"
                required
              />
            </div>

            <div className="edit-profile__field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                value={email}
                disabled
                placeholder="Email"
              />
            </div>

            {role === 'student' && (
              <>
                <div className="edit-profile__field">
                  <label htmlFor="age">Age</label>
                  <input
                    id="age"
                    type="number"
                    min="1"
                    max="120"
                    value={age}
                    readOnly
                    placeholder="Age is calculated from your DOB"
                  />
                </div>

                <div className="edit-profile__field">
                  <label htmlFor="firstLanguage">First Language</label>
                  <input
                    id="firstLanguage"
                    type="text"
                    value={firstLanguage}
                    readOnly
                    placeholder="First language"
                  />
                </div>

                <div className="edit-profile__field">
                  <label htmlFor="level">Level</label>
                  <input
                    id="level"
                    type="text"
                    value={level}
                    readOnly
                    placeholder="Level"
                  />
                </div>
              </>
            )}

            <div className="edit-profile__field">
              <label>Change Password</label>
              {!showPasswordFields ? (
                <button
                  type="button"
                  className="edit-profile__secondary"
                  onClick={() => setShowPasswordFields(true)}
                >
                  Change Password
                </button>
              ) : (
                <div className="edit-profile__password-fields">
                  <input
                    id="currentPassword"
                    type="password"
                    value={passwords.current}
                    onChange={(e) => setPasswords((prev) => ({ ...prev, current: e.target.value }))}
                    placeholder="Current password"
                    required
                  />
                  <input
                    id="newPassword"
                    type="password"
                    value={passwords.next}
                    onChange={(e) => setPasswords((prev) => ({ ...prev, next: e.target.value }))}
                    placeholder="New password"
                    required
                  />
                  <input
                    id="confirmPassword"
                    type="password"
                    value={passwords.confirm}
                    onChange={(e) => setPasswords((prev) => ({ ...prev, confirm: e.target.value }))}
                    placeholder="Confirm new password"
                    required
                  />
                </div>
              )}
            </div>

            {status.message && (
              <div className={`edit-profile__status ${status.type}`}>
                {status.message}
              </div>
            )}

            <div className="edit-profile__actions">
              <button type="submit" className="edit-profile__primary" disabled={loading}>
                {loading ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </PageLayout>
  );
}

export default EditProfile;
