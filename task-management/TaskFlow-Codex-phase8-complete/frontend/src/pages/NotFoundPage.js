import { Link } from "react-router-dom";

export default function NotFoundPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg, #0d0d0f)",
        color: "var(--text, #f0f0f2)",
        textAlign: "center",
        padding: "20px",
      }}
    >
      <div
        style={{
          fontFamily: "Syne, sans-serif",
          fontSize: "72px",
          fontWeight: 800,
          color: "var(--accent, #7c6aff)",
          lineHeight: 1,
          marginBottom: "16px",
        }}
      >
        404
      </div>
      <h1
        style={{
          fontSize: "24px",
          fontWeight: 700,
          marginBottom: "8px",
          fontFamily: "Syne, sans-serif",
        }}
      >
        Page Not Found
      </h1>
      <p
        style={{
          color: "var(--text-2, #a0a0aa)",
          fontSize: "14px",
          maxWidth: "400px",
          marginBottom: "24px",
          lineHeight: 1.5,
        }}
      >
        The page you are looking for does not exist or has been moved.
      </p>
      <Link
        to="/dashboard"
        className="btn btn-primary"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "8px",
          padding: "10px 20px",
          fontSize: "14px",
          textDecoration: "none",
        }}
      >
        Back to Dashboard
      </Link>
    </div>
  );
}
