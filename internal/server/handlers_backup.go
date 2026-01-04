package server

import (
	"io"
	"net/http"
)

func (s *Server) handleExport(w http.ResponseWriter, r *http.Request) {
	b, err := s.store.ExportJSON()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(b)
}

func (s *Server) handleImport(w http.ResponseWriter, r *http.Request) {
	b, err := io.ReadAll(io.LimitReader(r.Body, 5<<20))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid")
		return
	}
	if err := s.store.ImportJSON(b); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
