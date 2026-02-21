import { useState } from "react";
import { useNavigate } from "react-router-dom";
import "./Login.css";

const API_ORIGIN = process.env.REACT_APP_API_ORIGIN || 'http://localhost:5144';
const API_BASE = `${API_ORIGIN}/api/auth`;

const Login = ({ setRole }) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    const payload = { email, password };

    try {
      const res = await fetch(`${API_BASE}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorText = await res.text().catch(() => "");
        let message = "Something went wrong. Please try again.";

        if (res.status === 401) {
          message = errorText.toLowerCase().includes("invalid credentials")
            ? "Invalid email or password."
            : errorText || "Invalid email or password.";
        } else if (res.status === 400) {
          message = errorText || "Bad request. Please check your input.";
        } else if (res.status >= 500) {
          message = "Server error. Please try again later.";
        }

        setError(message);
        setLoading(false);
        return;
      }

      const data = await res.json();

      localStorage.setItem(
        "user",
        JSON.stringify({
          token: data.token,
          role: data.role.toLowerCase(),
          profile: data.profile,
        })
      );

      sessionStorage.setItem("role", data.role.toLowerCase());
      sessionStorage.setItem("token", data.token);

      if (setRole) setRole(data.role.toLowerCase());

      setLoading(false);
      navigate("/");
    } catch (err) {
      console.error(err);
      setError("Unable to connect to the server. Please try again later.");
      setLoading(false);
    }
  };

  return (
    <div className="register-page">
      <div className="register-content">
        <div className="register-card">
          <h2 className="register-title">Login</h2>

          {error && <div className="error-message">{error}</div>}

          <form onSubmit={handleSubmit} className="register-form">
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />

            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />

            <button type="submit" className="register-btn" disabled={loading}>
              {loading ? "Logging in..." : "Log In"}
            </button>

            <button
              type="button"
              className="auth-link"
              onClick={() => navigate("/forgot-password")}
            >
              Forgot password?
            </button>

            <p className="register-footer">
              Don't have an account? <a href="/register">Create one here</a>
            </p>
          </form>
        </div>

        <div className="register-placeholder">
          <img src="/images/EsolAI.png" alt="EsolAI Logo" className="logo" />
          <h2>Welcome Back!</h2>
          <p>
            Enter your credentials and continue your journey to mastering
            English.
          </p>
        </div>
      </div>
    </div>
  );
};

export default Login;
