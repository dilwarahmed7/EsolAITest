import { useState } from "react";
import { useNavigate } from "react-router-dom";
import "./Login.css";

const API_ORIGIN = process.env.REACT_APP_API_ORIGIN || 'http://localhost:5144';
const API_BASE = `${API_ORIGIN}/api/auth`;

const ForgotPassword = () => {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("");
  const [resetUrl, setResetUrl] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setStatus("");
    setResetUrl("");
    setLoading(true);

    try {
      const res = await fetch(`${API_BASE}/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const contentType = res.headers.get("content-type") || "";
      const data = contentType.includes("application/json") ? await res.json() : null;

      if (!res.ok) {
        const message = data?.message || (await res.text().catch(() => "")) || "Unable to submit request.";
        setError(message);
        setLoading(false);
        return;
      }

      setStatus(
        data?.message ||
          "If an account exists for that email, we have sent password reset instructions."
      );
      if (data?.resetUrl) {
        setResetUrl(data.resetUrl);
      }
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
          <h2 className="register-title">Forgot password</h2>

          {error && <div className="error-message">{error}</div>}
          {status && <div className="success-message">{status}</div>}

          <form onSubmit={handleSubmit} className="register-form">
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />

            <button type="submit" className="register-btn" disabled={loading}>
              {loading ? "Sending..." : "Send reset email"}
            </button>
          </form>

          {resetUrl ? (
            <div className="dev-note">
              Dev reset link:{" "}
              <a href={resetUrl} className="dev-link">
                {resetUrl}
              </a>
            </div>
          ) : null}

          <button type="button" className="auth-link" onClick={() => navigate("/login")}>
            Back to login
          </button>
        </div>

        <div className="register-placeholder">
          <img src="/images/EsolAI.png" alt="EsolAI Logo" className="logo" />
          <h2>Reset your password</h2>
          <p>We will email you a secure link to set a new password.</p>
        </div>
      </div>
    </div>
  );
};

export default ForgotPassword;
