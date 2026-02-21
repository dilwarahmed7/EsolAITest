import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useToast } from "../../Components/ToastProvider";
import "./Register.css";

const API_ORIGIN = process.env.REACT_APP_API_ORIGIN || 'http://localhost:5144';
const API_BASE = `${API_ORIGIN}/api/auth`;

const Register = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState("Student");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [firstLanguage, setFirstLanguage] = useState("");
  const [level, setLevel] = useState("");

  const languageOptions = useMemo(() => {
    try {
      if (typeof Intl !== "undefined" && Intl.DisplayNames && Intl.supportedValuesOf) {
        const codes = Intl.supportedValuesOf("language");
        const displayNames = new Intl.DisplayNames(["en"], { type: "language" });
        const seen = new Set();
        const names = [];

        codes.forEach((code) => {
          const name = displayNames.of(code);
          if (name && !seen.has(name)) {
            seen.add(name);
            names.push(name);
          }
        });

        return names.sort((a, b) => a.localeCompare(b));
      }
    } catch (err) {
      console.warn("Falling back to default language list", err);
    }

    return [
      "English",
      "Spanish",
      "French",
      "Chinese",
      "Arabic",
      "Hindi",
      "Portuguese",
      "Bengali",
      "Russian",
      "German",
      "Japanese",
      "Other",
    ];
  }, []);

  const levelOptions = useMemo(() => ["A1", "A2", "B1", "B2", "C1", "C2"], []);

  const navigate = useNavigate();
  const toast = useToast();

  const handleSubmit = async (e) => {
    e.preventDefault();

    const payload = { email, password, fullName, role };
    if (role === "Student") {
      payload.dateOfBirth = dateOfBirth;
      payload.firstLanguage = firstLanguage;
      payload.level = level;
    }

    try {
      const res = await fetch(`${API_BASE}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorText = await res.text().catch(() => "");
        toast.error(errorText || "Registration failed.");
      } else {
        toast.success("User registered successfully!");
        navigate("/login");
      }
    } catch (err) {
      console.error(err);
      toast.error("Something went wrong.");
    }
  };

  return (
    <div className="register-page">
      <div className="register-content">
        <div className="register-card">
          <h2 className="register-title">Register {role}</h2>

          <div className="role-switch">
            <label className={role === "Teacher" ? "active" : ""}>
              <input
                type="radio"
                name="role"
                value="Teacher"
                checked={role === "Teacher"}
                onChange={() => setRole("Teacher")}
              />
              Teacher
            </label>
            <label className={role === "Student" ? "active" : ""}>
              <input
                type="radio"
                name="role"
                value="Student"
                checked={role === "Student"}
                onChange={() => setRole("Student")}
              />
              Student
            </label>
          </div>

          <form onSubmit={handleSubmit} className="register-form">
            <input
              type="text"
              placeholder="Full Name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
            />
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

            {role === "Student" && (
              <>
                <input
                  type="date"
                  placeholder="Date of Birth"
                  value={dateOfBirth}
                  onChange={(e) => setDateOfBirth(e.target.value)}
                  required
                />
                <input
                  list="language-options"
                  placeholder="First Language"
                  value={firstLanguage}
                  onChange={(e) => setFirstLanguage(e.target.value)}
                  required
                />
                <datalist id="language-options">
                  {languageOptions.map((lang) => (
                    <option key={lang} value={lang} />
                  ))}
                </datalist>
                <select
                  value={level}
                  onChange={(e) => setLevel(e.target.value)}
                  required
                >
                  <option value="">Select Level</option>
                  {levelOptions.map((lvl) => (
                    <option key={lvl} value={lvl}>
                      {lvl}
                    </option>
                  ))}
                </select>
              </>
            )}

            <button type="submit" className="register-btn">Register</button>
            <p className="register-footer">
              Already have an account? <a href="/login">Login here</a>
            </p>
          </form>
        </div>

        <div className="register-placeholder">
          <img src="/images/EsolAI.png" alt="EsolAI Logo" className="logo" />
          <h2>Welcome to EsolAI</h2>
          <p>Explore our platform and start your journey to mastering English.</p>
        </div>
      </div>
    </div>
  );
};

export default Register;
