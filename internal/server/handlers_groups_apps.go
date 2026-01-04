package server

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
)

type createGroupRequest struct {
	Name string `json:"name"`
	Kind string `json:"kind"` // system|app
}

type reorderRequest struct {
	IDs []string `json:"ids"`
}

type createAppRequest struct {
	GroupID     *string `json:"groupId"`
	Name        string  `json:"name"`
	Description *string `json:"description"`
	URL         string  `json:"url"`
	IconPath    *string `json:"iconPath"`
	IconSource  *string `json:"iconSource"`
}

func (s *Server) handleListGroups(w http.ResponseWriter, r *http.Request) {
	gs, err := s.store.ListGroups()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed")
		return
	}
	writeJSON(w, http.StatusOK, gs)
}

func (s *Server) handleCreateGroup(w http.ResponseWriter, r *http.Request) {
	var req createGroupRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}
	if req.Name == "" {
		writeError(w, http.StatusBadRequest, "name required")
		return
	}
	kind := strings.ToLower(strings.TrimSpace(req.Kind))
	if kind != "system" {
		kind = "app"
	}
	if kind == "system" {
		if ok, err := s.store.HasSystemGroup(); err != nil {
			writeError(w, http.StatusInternalServerError, "failed")
			return
		} else if ok {
			writeError(w, http.StatusBadRequest, "system group already exists")
			return
		}
	}
	g, err := s.store.CreateGroup(req.Name, kind)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed")
		return
	}
	writeJSON(w, http.StatusCreated, g)
}

func (s *Server) handleUpdateGroup(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req createGroupRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}
	if req.Name == "" {
		writeError(w, http.StatusBadRequest, "name required")
		return
	}
	if err := s.store.UpdateGroup(id, req.Name); err != nil {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleDeleteGroup(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	// PRD: delete group -> move apps to ungrouped
	_ = s.store.MoveGroupAppsToUngrouped(id)
	if err := s.store.DeleteGroup(id); err != nil {
		writeError(w, http.StatusInternalServerError, "failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleReorderGroups(w http.ResponseWriter, r *http.Request) {
	var req reorderRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}
	if err := s.store.ReorderGroups(req.IDs); err != nil {
		writeError(w, http.StatusInternalServerError, "failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleListApps(w http.ResponseWriter, r *http.Request) {
	apps, err := s.store.ListApps()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed")
		return
	}
	writeJSON(w, http.StatusOK, apps)
}

func (s *Server) handleCreateApp(w http.ResponseWriter, r *http.Request) {
	var req createAppRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}
	if req.Name == "" || req.URL == "" {
		writeError(w, http.StatusBadRequest, "name and url required")
		return
	}
	isWidget := strings.HasPrefix(req.URL, "widget:")
	if req.GroupID == nil {
		if isWidget {
			writeError(w, http.StatusBadRequest, "widgets must be in system group")
			return
		}
	} else {
		kind, ok, err := s.store.GroupKindByID(*req.GroupID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed")
			return
		}
		if !ok {
			writeError(w, http.StatusBadRequest, "invalid group")
			return
		}
		if kind == "system" && !isWidget {
			writeError(w, http.StatusBadRequest, "system group only allows widgets")
			return
		}
		if kind != "system" && isWidget {
			writeError(w, http.StatusBadRequest, "app group does not allow widgets")
			return
		}
	}
	app, err := s.store.CreateApp(req.GroupID, req.Name, req.Description, req.URL, req.IconPath, req.IconSource)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed")
		return
	}
	writeJSON(w, http.StatusCreated, app)
}

func (s *Server) handleUpdateApp(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req createAppRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}
	if req.Name == "" || req.URL == "" {
		writeError(w, http.StatusBadRequest, "name and url required")
		return
	}
	isWidget := strings.HasPrefix(req.URL, "widget:")
	if req.GroupID == nil {
		if isWidget {
			writeError(w, http.StatusBadRequest, "widgets must be in system group")
			return
		}
	} else {
		kind, ok, err := s.store.GroupKindByID(*req.GroupID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed")
			return
		}
		if !ok {
			writeError(w, http.StatusBadRequest, "invalid group")
			return
		}
		if kind == "system" && !isWidget {
			writeError(w, http.StatusBadRequest, "system group only allows widgets")
			return
		}
		if kind != "system" && isWidget {
			writeError(w, http.StatusBadRequest, "app group does not allow widgets")
			return
		}
	}
	if err := s.store.UpdateApp(id, req.GroupID, req.Name, req.Description, req.URL, req.IconPath, req.IconSource); err != nil {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleDeleteApp(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := s.store.DeleteApp(id); err != nil {
		writeError(w, http.StatusInternalServerError, "failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleReorderApps(w http.ResponseWriter, r *http.Request) {
	var req struct {
		GroupID *string  `json:"groupId"`
		IDs     []string `json:"ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}
	if err := s.store.ReorderApps(req.GroupID, req.IDs); err != nil {
		writeError(w, http.StatusInternalServerError, "failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
