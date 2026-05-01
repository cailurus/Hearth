package server

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"sort"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/morezhou/hearth/internal/docker"
	"github.com/morezhou/hearth/internal/store"
)

// Group kind constants.
const (
	GroupKindSystem   = "system"
	GroupKindApp      = "app"
	GroupKindBookmark = "bookmark"
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
	labelApps := s.labelAppsFn()
	merged := mergeGroupsWithDocker(gs, labelApps)
	writeJSON(w, http.StatusOK, merged)
}

func (s *Server) handleCreateGroup(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
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
	switch kind {
	case GroupKindSystem, GroupKindBookmark:
		// keep as-is
	default:
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
	if isDockerManagedID(id) {
		writeError(w, http.StatusForbidden, "the docker virtual group cannot be modified")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
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
	if isDockerManagedID(id) {
		writeError(w, http.StatusForbidden, "the docker virtual group cannot be deleted")
		return
	}
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
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
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
	manual, err := s.store.ListApps()
	if err != nil {
		slog.Error("failed to list apps", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to list apps")
		return
	}
	groups, err := s.store.ListGroups()
	if err != nil {
		slog.Error("failed to list groups for app merge", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to list apps")
		return
	}
	labelApps := s.labelAppsFn()
	merged := mergeAppsWithDocker(manual, labelApps, groups)
	writeJSON(w, http.StatusOK, merged)
}

func (s *Server) handleCreateApp(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
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
	if isDockerManagedID(id) {
		writeError(w, http.StatusForbidden, "docker-discovered apps are managed via labels")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
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
	if isDockerManagedID(id) {
		writeError(w, http.StatusForbidden, "docker-discovered apps are managed via labels")
		return
	}
	if err := s.store.DeleteApp(id); err != nil {
		slog.Error("failed to delete app", "error", err, "id", id)
		writeError(w, http.StatusInternalServerError, "failed to delete app")
		return
	}
	slog.Info("app deleted", "id", id)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleReorderApps(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	var req struct {
		GroupID *string  `json:"groupId"`
		IDs     []string `json:"ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}
	if req.GroupID != nil && isDockerManagedID(*req.GroupID) {
		writeError(w, http.StatusForbidden, "the docker virtual group cannot be reordered")
		return
	}
	if err := s.store.ReorderApps(req.GroupID, req.IDs); err != nil {
		slog.Error("failed to reorder apps", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to reorder apps")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// isDockerManagedID reports whether the given app or group ID was
// synthesized by the docker label discovery layer. Mutation handlers
// refuse these IDs because docker-compose labels are the source of
// truth — UI edits would be silently overwritten on the next scan.
func isDockerManagedID(id string) bool {
	return strings.HasPrefix(id, dockerAppIDPrefix)
}

// dockerVirtualGroupID is the synthetic ID of the in-memory "Docker"
// group that holds label-discovered apps with no matching user group.
const dockerVirtualGroupID = "docker:"

// dockerVirtualGroupName is the display name of the synthetic group.
const dockerVirtualGroupName = "Docker"

// dockerAppIDPrefix is prepended to a container's short ID to form the
// AppItem.ID for label-discovered apps. The prefix doubles as the
// "this app is docker-managed" marker for the mutation handlers.
const dockerAppIDPrefix = "docker:"

// mergeAppsWithDocker appends label-discovered apps (one per LabelApp)
// to the manual app list. Group placement: case-insensitive exact
// match against existing user groups; on miss, falls into the
// dockerVirtualGroupID synthetic group. Output order = manual apps
// first (preserving DB order), docker apps last in container-name
// (Name) lexicographic order — keeps React keys stable across renders
// and gives users a predictable display.
func mergeAppsWithDocker(manual []store.AppItem, labelApps []docker.LabelApp, groups []store.Group) []store.AppItem {
	if len(labelApps) == 0 {
		return manual
	}

	// Index user groups by lowercased name for case-insensitive lookup.
	groupIDByName := make(map[string]string, len(groups))
	for _, g := range groups {
		groupIDByName[strings.ToLower(g.Name)] = g.ID
	}

	// Stable sort of label apps by Name so SortOrder is deterministic.
	sorted := make([]docker.LabelApp, len(labelApps))
	copy(sorted, labelApps)
	sort.SliceStable(sorted, func(i, j int) bool {
		return sorted[i].Name < sorted[j].Name
	})

	out := make([]store.AppItem, 0, len(manual)+len(sorted))
	out = append(out, manual...)
	for i, la := range sorted {
		var groupID *string
		if la.Group != "" {
			if id, ok := groupIDByName[strings.ToLower(la.Group)]; ok {
				gid := id
				groupID = &gid
			}
		}
		if groupID == nil {
			vid := dockerVirtualGroupID
			groupID = &vid
		}
		shortID := la.ContainerID
		if len(shortID) > 12 {
			shortID = shortID[:12]
		}
		var iconPath, iconSource *string
		if la.Icon != "" {
			ic := la.Icon
			iconPath = &ic
			src := "docker"
			iconSource = &src
		}
		var description *string
		if la.Description != "" {
			d := la.Description
			description = &d
		}
		out = append(out, store.AppItem{
			ID:          dockerAppIDPrefix + shortID,
			GroupID:     groupID,
			Name:        la.Name,
			Description: description,
			URL:         la.Href,
			IconPath:    iconPath,
			IconSource:  iconSource,
			// SortOrder offset so docker apps follow manual apps consistently.
			SortOrder: 100000 + i,
			CreatedAt: 0,
			Source:    "docker",
		})
	}
	return out
}

// mergeGroupsWithDocker injects a virtual "Docker" group into the
// returned groups slice if (and only if) at least one label app is
// going to land in it. Otherwise the slice is returned untouched.
func mergeGroupsWithDocker(manual []store.Group, labelApps []docker.LabelApp) []store.Group {
	if len(labelApps) == 0 {
		return manual
	}
	groupIDByName := make(map[string]bool, len(manual))
	for _, g := range manual {
		groupIDByName[strings.ToLower(g.Name)] = true
	}
	needVirtual := false
	for _, la := range labelApps {
		if la.Group == "" || !groupIDByName[strings.ToLower(la.Group)] {
			needVirtual = true
			break
		}
	}
	if !needVirtual {
		return manual
	}
	out := make([]store.Group, 0, len(manual)+1)
	out = append(out, manual...)
	out = append(out, store.Group{
		ID:        dockerVirtualGroupID,
		Name:      dockerVirtualGroupName,
		Kind:      GroupKindApp,
		// Push the virtual group to the end; user groups keep their order.
		SortOrder: 1 << 30,
		CreatedAt: 0,
	})
	return out
}
