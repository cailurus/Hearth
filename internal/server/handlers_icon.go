package server

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
)

type resolveIconRequest struct {
	URL     string `json:"url"`
	Refresh bool   `json:"refresh,omitempty"` // Force refresh, bypass cache
}

type resolveIconResponse struct {
	Title      string `json:"title"`
	IconURL    string `json:"iconUrl"`
	IconPath   string `json:"iconPath"`
	IconSource string `json:"iconSource"`
}

func (s *Server) handleResolveIcon(w http.ResponseWriter, r *http.Request) {
	var req resolveIconRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}
	if req.URL == "" {
		writeError(w, http.StatusBadRequest, "url required")
		return
	}

	cacheKey := sha256Hex(req.URL)

	// If refresh is requested, delete the existing cache entry
	if req.Refresh {
		_ = s.store.DeleteIconCache(cacheKey)
	} else {
		// Check cache only if not refreshing
		if e, ok, err := s.store.GetIconCache(cacheKey); err == nil && ok {
			full := filepath.Join(s.cfg.DataDir, "icons", e.IconPath)
			if _, err := os.Stat(full); err == nil {
				writeJSON(w, http.StatusOK, resolveIconResponse{
					Title:      "",
					IconURL:    "/assets/icons/" + e.IconPath,
					IconPath:   e.IconPath,
					IconSource: e.IconSource,
				})
				return
			}
		}
	}

	res, err := s.iconResolver.ResolveAndCache(r.Context(), req.URL)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if res.IconPath != "" {
		_ = s.store.SetIconCache(cacheKey, res.IconPath, res.IconSource)
	}

	writeJSON(w, http.StatusOK, resolveIconResponse{
		Title:      res.Title,
		IconURL:    iconURLFromPath(res.IconPath),
		IconPath:   res.IconPath,
		IconSource: res.IconSource,
	})
}

func iconURLFromPath(p string) string {
	if p == "" {
		return ""
	}
	return "/assets/icons/" + p
}

func sha256Hex(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}
