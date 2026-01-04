package server

import "net/http"

func (s *Server) handleAdminReset(w http.ResponseWriter, r *http.Request) {
    if err := s.store.ResetAll(); err != nil {
        writeError(w, http.StatusInternalServerError, "failed")
        return
    }
    if err := s.ensureDefaultSystemTools(); err != nil {
        writeError(w, http.StatusInternalServerError, "failed")
        return
    }
    writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
