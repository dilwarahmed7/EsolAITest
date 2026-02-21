import React from 'react';
import './Hero.css';

function Hero({
  eyebrow,
  title,
  subtitle,
  icon,
  meta = [],
  action,
  variant = '',
}) {
  return (
    <div className={`hero ${variant ? `hero-${variant}` : ''}`.trim()}>
      <div className="hero-left">
        {icon ? <div className="hero-icon">{icon}</div> : null}
        <div className="hero-text">
          {eyebrow ? <p className="hero-eyebrow">{eyebrow}</p> : null}
          {title ? <h2 className="hero-title">{title}</h2> : null}
          {subtitle ? <p className="hero-subtitle">{subtitle}</p> : null}
          {meta.length ? (
            <div className="hero-meta">
              {meta.map((item, idx) => (
                <span
                  key={`${item.label || 'meta'}-${idx}`}
                  className={`hero-pill ${item.tone || ''}`.trim()}
                >
                  {item.icon || null}
                  {item.label}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      {action ? <div className="hero-action">{action}</div> : null}
    </div>
  );
}

export default Hero;
