package server

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/morezhou/hearth/internal/store"
)

func (s *Server) handleGetDocker(w http.ResponseWriter, r *http.Request) {
	resp := s.dockerClient.Collect(r.Context())
	writeJSON(w, http.StatusOK, resp)
}

func (s *Server) handleDockerAction(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	action := chi.URLParam(r, "action")

	switch action {
	case "start", "stop", "restart":
	default:
		writeError(w, http.StatusBadRequest, "invalid action: must be start, stop, or restart")
		return
	}

	// Resolve identity + container name up-front so the audit row is informative
	// regardless of which branch we exit through. Failures here are non-fatal:
	// we still record the action with empty fields.
	userID, _ := userIDFromContext(r)
	username, _ := s.auth.UsernameByID(userID)
	containerName, _ := s.dockerClient.ContainerName(r.Context(), id)

	entry := store.AuditEntry{
		Time:       time.Now().Unix(),
		UserID:     userID,
		Username:   username,
		Action:     "docker." + action,
		TargetType: "docker_container",
		TargetID:   id,
		TargetName: containerName,
		RemoteIP:   r.RemoteAddr,
	}

	// Optional allow-list. Match against the resolved container name; if we
	// couldn't resolve a name (rare — Docker daemon offline, etc.), refuse
	// rather than fall through, since the patterns can't be honored.
	if len(s.dockerAllowPatterns) > 0 {
		if containerName == "" {
			entry.Result = "denied"
			entry.ErrorMsg = "container name unknown; allow-list cannot be evaluated"
			s.recordAudit(entry)
			writeError(w, http.StatusForbidden, "container not allowed")
			return
		}
		matched := false
		for _, re := range s.dockerAllowPatterns {
			if re.MatchString(containerName) {
				matched = true
				break
			}
		}
		if !matched {
			entry.Result = "denied"
			entry.ErrorMsg = "container not in HEARTH_DOCKER_ALLOW_PATTERNS"
			s.recordAudit(entry)
			writeError(w, http.StatusForbidden, "container not allowed")
			return
		}
	}

	if err := s.dockerClient.ContainerAction(r.Context(), id, action); err != nil {
		entry.Result = "error"
		entry.ErrorMsg = err.Error()
		s.recordAudit(entry)
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	entry.Result = "ok"
	s.recordAudit(entry)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// recordAudit writes a row to the audit_log. It logs the SQLite error path
// (rather than bubbling it) because failing to audit shouldn't break a
// successful container action.
func (s *Server) recordAudit(e store.AuditEntry) {
	if err := s.store.WriteAudit(e); err != nil {
		slog.Warn("audit write failed",
			"action", e.Action,
			"target_id", e.TargetID,
			"target_name", e.TargetName,
			"result", e.Result,
			"error", err,
		)
	}
}
