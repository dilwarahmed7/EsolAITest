import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import "./Login.css";

const API_ORIGIN = process.env.REACT_APP_API_ORIGIN || 'http://localhost:5144';
const API_BASE = `${API_ORIGIN}/api/auth`;

const ResetPassword = () => {
  const [searchParams] = useSearchParams();
  const token = useMemo(() => searchParams.get("token") || "", [searchParams]);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setStatus("");

    if (!token) {
      setError("Missing reset token. Please use the link from your email.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          newPassword,
          confirmPassword,
        }),
      });

      const contentType = res.headers.get("content-type") || "";
      const data = contentType.includes("application/json") ? await res.json() : null;

      if (!res.ok) {
        const message = data?.message || (await res.text().catch(() => "")) || "Unable to reset password.";
        setError(message);
        setLoading(false);
        return;
      }

      setStatus("Password reset successfully. You can now log in.");
    } catch (err) {
      console.error(err);
      setError("Unable to connect to the server. Please try again later.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="register-page">
      <div className="register-content">
        <div className="register-card">
          <h2 className="register-title">Reset password</h2>

          {error && <div className="error-message">{error}</div>}
          {status && <div className="success-message">{status}</div>}

          <form onSubmit={handleSubmit} className="register-form">
            <input
              type="password"
              placeholder="New password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
            />

            <input
              type="password"
              placeholder="Confirm new password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />

            <button type="submit" className="register-btn" disabled={loading}>
              {loading ? "Resetting..." : "Reset password"}
            </button>
          </form>

          <button type="button" className="auth-link" onClick={() => navigate("/login")}>
            Back to login
          </button>
        </div>

        <div className="register-placeholder">
          <img src="/images/EsolAI.png" alt="EsolAI Logo" className="logo" />
          <h2>Set a new password</h2>
          <p>Choose a strong password you have not used before.</p>
        </div>
      </div>
    </div>
  );
};

export default ResetPassword;
