package server

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
)

func (s *Server) handleListNotes(w http.ResponseWriter, r *http.Request) {
	notes, err := s.store.ListNotes()
	if err != nil {
		slog.Error("failed to list notes", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to list notes")
		return
	}
	writeJSON(w, http.StatusOK, notes)
}

func (s *Server) handleCreateNote(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	var req struct {
		Title   string `json:"title"`
		Content string `json:"content"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}
	if req.Title == "" {
		writeError(w, http.StatusBadRequest, "title required")
		return
	}
	note, err := s.store.CreateNote(req.Title, req.Content)
	if err != nil {
		slog.Error("failed to create note", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to create note")
		return
	}
	writeJSON(w, http.StatusCreated, note)
}

func (s *Server) handleUpdateNote(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	var req struct {
		Title   string `json:"title"`
		Content string `json:"content"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}
	if req.Title == "" {
		writeError(w, http.StatusBadRequest, "title required")
		return
	}
	if err := s.store.UpdateNote(id, req.Title, req.Content); err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleDeleteNote(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := s.store.DeleteNote(id); err != nil {
		slog.Error("failed to delete note", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to delete note")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
