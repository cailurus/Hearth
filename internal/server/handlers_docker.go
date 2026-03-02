package server

import "net/http"

func (s *Server) handleGetDocker(w http.ResponseWriter, r *http.Request) {
	resp := s.dockerClient.Collect(r.Context())
	writeJSON(w, http.StatusOK, resp)
}
