package server

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
)

// Group kind constants.
const (
	GroupKindSystem = "system"
	GroupKindApp    = "app"
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
		slog.Error("failed to list groups", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to list groups")
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
	if kind != GroupKindSystem {
		kind = GroupKindApp
	}
	if kind == GroupKindSystem {
		if ok, err := s.store.HasSystemGroup(); err != nil {
			slog.Error("failed to check system group", "error", err)
			writeError(w, http.StatusInternalServerError, "failed to check system group")
			return
		} else if ok {
			writeError(w, http.StatusBadRequest, "system group already exists")
			return
		}
	}
	g, err := s.store.CreateGroup(req.Name, kind)
	if err != nil {
		slog.Error("failed to create group", "error", err, "name", req.Name)
		writeError(w, http.StatusInternalServerError, "failed to create group")
		return
	}
	slog.Info("group created", "id", g.ID, "name", g.Name, "kind", kind)
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
	// Delete all apps in the group first
	if err := s.store.DeleteAppsByGroupID(id); err != nil {
		slog.Warn("failed to delete apps in group", "groupId", id, "error", err)
	}
	if err := s.store.DeleteGroup(id); err != nil {
		slog.Error("failed to delete group", "error", err, "id", id)
		writeError(w, http.StatusInternalServerError, "failed to delete group")
		return
	}
	slog.Info("group deleted with all apps", "id", id)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleReorderGroups(w http.ResponseWriter, r *http.Request) {
	var req reorderRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}
	if err := s.store.ReorderGroups(req.IDs); err != nil {
		slog.Error("failed to reorder groups", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to reorder groups")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleListApps(w http.ResponseWriter, r *http.Request) {
	apps, err := s.store.ListApps()
	if err != nil {
		slog.Error("failed to list apps", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to list apps")
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
			slog.Error("failed to get group kind", "error", err, "groupId", *req.GroupID)
			writeError(w, http.StatusInternalServerError, "failed to validate group")
			return
		}
		if !ok {
			writeError(w, http.StatusBadRequest, "invalid group")
			return
		}
		if kind == GroupKindSystem && !isWidget {
			writeError(w, http.StatusBadRequest, "system group only allows widgets")
			return
		}
		if kind != GroupKindSystem && isWidget {
			writeError(w, http.StatusBadRequest, "app group does not allow widgets")
			return
		}
	}
	app, err := s.store.CreateApp(req.GroupID, req.Name, req.Description, req.URL, req.IconPath, req.IconSource)
	if err != nil {
		slog.Error("failed to create app", "error", err, "name", req.Name)
		writeError(w, http.StatusInternalServerError, "failed to create app")
		return
	}
	slog.Info("app created", "id", app.ID, "name", app.Name)
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
			slog.Error("failed to get group kind", "error", err, "groupId", *req.GroupID)
			writeError(w, http.StatusInternalServerError, "failed to validate group")
			return
		}
		if !ok {
			writeError(w, http.StatusBadRequest, "invalid group")
			return
		}
		if kind == GroupKindSystem && !isWidget {
			writeError(w, http.StatusBadRequest, "system group only allows widgets")
			return
		}
		if kind != GroupKindSystem && isWidget {
			writeError(w, http.StatusBadRequest, "app group does not allow widgets")
			return
		}
	}
	if err := s.store.UpdateApp(id, req.GroupID, req.Name, req.Description, req.URL, req.IconPath, req.IconSource); err != nil {
		slog.Warn("failed to update app", "error", err, "id", id)
		writeError(w, http.StatusNotFound, "app not found")
		return
	}
	slog.Info("app updated", "id", id, "name", req.Name)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleDeleteApp(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := s.store.DeleteApp(id); err != nil {
		slog.Error("failed to delete app", "error", err, "id", id)
		writeError(w, http.StatusInternalServerError, "failed to delete app")
		return
	}
	slog.Info("app deleted", "id", id)
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
		slog.Error("failed to reorder apps", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to reorder apps")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
