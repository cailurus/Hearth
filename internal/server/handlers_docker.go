package server

import (
	"net/http"

	"github.com/go-chi/chi/v5"
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

	if err := s.dockerClient.ContainerAction(r.Context(), id, action); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
