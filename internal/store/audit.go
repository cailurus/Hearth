package store

// AuditEntry captures a single admin-side event for the audit_log table.
// All fields are optional except Time, Action, and Result; the schema fills
// missing string fields with the empty string so callers don't have to.
type AuditEntry struct {
	Time       int64
	UserID     string
	Username   string
	Action     string // e.g. "docker.start"
	TargetType string // e.g. "docker_container"
	TargetID   string
	TargetName string
	RemoteIP   string
	Result     string // "ok" | "denied" | "error"
	ErrorMsg   string
}

// WriteAudit appends a row to audit_log. The write is intentionally fire-and-forget
// from the caller's perspective: returning an error here only happens when SQLite
// itself fails, which already surfaces via Ping/health.
func (s *Store) WriteAudit(e AuditEntry) error {
	_, err := s.db.Exec(
		`INSERT INTO audit_log (ts, user_id, username, action, target_type, target_id, target_name, remote_ip, result, error_msg)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		e.Time, e.UserID, e.Username, e.Action, e.TargetType, e.TargetID, e.TargetName, e.RemoteIP, e.Result, e.ErrorMsg,
	)
	return err
}
