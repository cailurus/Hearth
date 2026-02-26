package server

import (
	"encoding/json"
	"log/slog"
	"net/http"
)

func (s *Server) handleAdminReset(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	var body struct {
		Confirm bool `json:"confirm"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || !body.Confirm {
		writeError(w, http.StatusBadRequest, "confirmation required: send {\"confirm\": true}")
		return
	}

	slog.Warn("admin reset initiated", "remote", r.RemoteAddr)

	if err := s.store.ResetAll(); err != nil {
		writeError(w, http.StatusInternalServerError, "failed")
		return
	}
	if err := s.ensureDefaultSystemTools(); err != nil {
		writeError(w, http.StatusInternalServerError, "failed")
		return
	}

	slog.Info("admin reset completed")
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
